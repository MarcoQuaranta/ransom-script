/**
 * Fix metafield con immagini - usa URL per mappare
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

const SOURCE_SHOP = 'usa-shop-8790.myshopify.com';
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com';

const PRODUCTS_QUERY = `
  query getProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          title
          metafields(first: 100) {
            edges {
              node {
                namespace
                key
                value
                type
              }
            }
          }
          media(first: 50) {
            edges {
              node {
                ... on MediaImage {
                  id
                  image {
                    url
                  }
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const SET_METAFIELDS = `
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key }
      userErrors { field message }
    }
  }
`;

async function getClient(shopDomain: string): Promise<GraphQLClient> {
  const shop = await prisma.shop.findUnique({ where: { shop: shopDomain } });
  if (!shop) throw new Error(`Shop not found: ${shopDomain}`);
  return new GraphQLClient(`https://${shopDomain}/admin/api/2024-01/graphql.json`, {
    headers: {
      'X-Shopify-Access-Token': shop.accessToken,
      'Content-Type': 'application/json',
    },
  });
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function getAllProducts(client: GraphQLClient): Promise<any[]> {
  let products: any[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const result: any = await client.request(PRODUCTS_QUERY, { first: 50, after: cursor });
    products = products.concat(result.products.edges.map((e: any) => e.node));
    hasNextPage = result.products.pageInfo.hasNextPage;
    cursor = result.products.pageInfo.endCursor;
  }

  return products;
}

// Extract filename from Shopify CDN URL
function getImageFilename(url: string): string {
  // https://cdn.shopify.com/.../files/image.jpg?... -> image.jpg
  const match = url.match(/\/files\/([^?]+)/);
  return match ? match[1] : '';
}

async function main() {
  console.log('='.repeat(70));
  console.log('COPIA METAFIELD IMMAGINI (MAPPING PER FILENAME)');
  console.log('='.repeat(70));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  console.log('\n[1] Caricamento prodotti...');
  const sourceProducts = await getAllProducts(sourceClient);
  const targetProducts = await getAllProducts(targetClient);

  console.log('\n[2] Mapping e copia metafield immagini...\n');

  let totalFixed = 0;

  for (const sourceProduct of sourceProducts) {
    const targetProduct = targetProducts.find(tp => tp.title === sourceProduct.title);
    if (!targetProduct) continue;

    // Get image metafields from source
    const imageMetafields = sourceProduct.metafields.edges
      .map((e: any) => e.node)
      .filter((m: any) => m.namespace === 'custom' && m.value?.includes('MediaImage'));

    if (imageMetafields.length === 0) continue;

    console.log(`${sourceProduct.title.substring(0, 55)}`);

    // Build URL-based mapping
    const sourceMedia = sourceProduct.media.edges
      .map((e: any) => e.node)
      .filter((m: any) => m.image?.url);

    const targetMedia = targetProduct.media.edges
      .map((e: any) => e.node)
      .filter((m: any) => m.image?.url);

    // Map by filename
    const imageMapping: Map<string, string> = new Map();

    for (const sm of sourceMedia) {
      const sourceFilename = getImageFilename(sm.image.url);

      // Find matching target by filename
      const tm = targetMedia.find((t: any) =>
        getImageFilename(t.image.url) === sourceFilename
      );

      if (tm) {
        imageMapping.set(sm.id, tm.id);
      }
    }

    // If no matches by filename, map by position
    if (imageMapping.size === 0) {
      for (let i = 0; i < Math.min(sourceMedia.length, targetMedia.length); i++) {
        imageMapping.set(sourceMedia[i].id, targetMedia[i].id);
      }
    }

    console.log(`   Immagini mappate: ${imageMapping.size}/${sourceMedia.length}`);

    // Fix metafields
    const metafieldsToSet: any[] = [];

    for (const mf of imageMetafields) {
      let value = mf.value;
      let allReplaced = true;

      const regex = /gid:\/\/shopify\/MediaImage\/\d+/g;
      const matches = value.match(regex) || [];

      for (const match of matches) {
        const targetId = imageMapping.get(match);
        if (targetId) {
          value = value.replace(match, targetId);
        } else {
          allReplaced = false;
        }
      }

      if (allReplaced) {
        metafieldsToSet.push({
          ownerId: targetProduct.id,
          namespace: mf.namespace,
          key: mf.key,
          value: value,
          type: mf.type,
        });
      } else {
        console.log(`   ! ${mf.key}: alcune immagini non mappate`);
      }
    }

    if (metafieldsToSet.length > 0) {
      try {
        const result: any = await targetClient.request(SET_METAFIELDS, {
          metafields: metafieldsToSet,
        });

        if (result.metafieldsSet.userErrors.length === 0) {
          console.log(`   ✓ ${metafieldsToSet.length} metafield immagini copiati`);
          totalFixed += metafieldsToSet.length;
        } else {
          console.log(`   ! ${result.metafieldsSet.userErrors[0].message}`);
        }
      } catch (e: any) {
        console.log(`   ! Errore: ${e.message?.substring(0, 60)}`);
      }
    }

    console.log('');
    await delay(300);
  }

  console.log('='.repeat(70));
  console.log(`RISULTATO: ${totalFixed} metafield immagini copiati`);
  console.log('='.repeat(70));

  await prisma.$disconnect();
}

main().catch(console.error);
