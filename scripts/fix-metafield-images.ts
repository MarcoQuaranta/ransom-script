/**
 * Script per correggere i metafield che contengono riferimenti a immagini
 * Mappa le immagini dal vecchio shop al nuovo shop
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

const SOURCE_SHOP = 'usa-shop-8790.myshopify.com';
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com';

// Query prodotti con metafield e media
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

// Set metafields
const SET_METAFIELDS = `
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
      }
      userErrors {
        field
        message
      }
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

function extractImageId(gid: string): string {
  // gid://shopify/MediaImage/12345 -> 12345
  const match = gid.match(/MediaImage\/(\d+)/);
  return match ? match[1] : '';
}

async function main() {
  console.log('='.repeat(70));
  console.log('CORREZIONE METAFIELD CON RIFERIMENTI IMMAGINI');
  console.log('='.repeat(70));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  console.log('\n[1] Caricamento prodotti...');
  const sourceProducts = await getAllProducts(sourceClient);
  const targetProducts = await getAllProducts(targetClient);
  console.log(`   Sorgente: ${sourceProducts.length}, Target: ${targetProducts.length}`);

  console.log('\n[2] Elaborazione metafield con immagini...\n');

  let fixed = 0;
  let skipped = 0;

  for (const sourceProduct of sourceProducts) {
    const targetProduct = targetProducts.find(tp => tp.title === sourceProduct.title);
    if (!targetProduct) continue;

    const sourceMetafields = sourceProduct.metafields.edges.map((e: any) => e.node);
    const targetMedia = targetProduct.media.edges
      .map((e: any) => e.node)
      .filter((m: any) => m.image);

    // Find metafields that contain MediaImage references
    const imageMetafields = sourceMetafields.filter(
      (mf: any) => mf.value && mf.value.includes('gid://shopify/MediaImage/')
    );

    if (imageMetafields.length === 0) continue;

    console.log(`${sourceProduct.title.substring(0, 55)}`);
    console.log(`   ${imageMetafields.length} metafield con immagini, ${targetMedia.length} immagini disponibili`);

    // Build source media index by position
    const sourceMedia = sourceProduct.media.edges
      .map((e: any) => e.node)
      .filter((m: any) => m.image);

    // Create mapping from source image ID to target image ID (by position)
    const imageMapping: Map<string, string> = new Map();
    for (let i = 0; i < Math.min(sourceMedia.length, targetMedia.length); i++) {
      const sourceId = sourceMedia[i].id;
      const targetId = targetMedia[i].id;
      imageMapping.set(sourceId, targetId);
    }

    // Fix metafields
    const metafieldsToSet: any[] = [];

    for (const mf of imageMetafields) {
      let newValue = mf.value;
      let replaced = false;

      // Replace all MediaImage references
      const regex = /gid:\/\/shopify\/MediaImage\/\d+/g;
      const matches = mf.value.match(regex) || [];

      for (const match of matches) {
        const targetId = imageMapping.get(match);
        if (targetId) {
          newValue = newValue.replace(match, targetId);
          replaced = true;
        }
      }

      if (replaced) {
        metafieldsToSet.push({
          ownerId: targetProduct.id,
          namespace: mf.namespace,
          key: mf.key,
          value: newValue,
          type: mf.type,
        });
      }
    }

    if (metafieldsToSet.length > 0) {
      try {
        const result: any = await targetClient.request(SET_METAFIELDS, {
          metafields: metafieldsToSet,
        });
        if (result.metafieldsSet.userErrors.length === 0) {
          console.log(`   ✓ ${metafieldsToSet.length} metafield corretti`);
          fixed += metafieldsToSet.length;
        } else {
          console.log(`   ! ${result.metafieldsSet.userErrors[0].message}`);
          skipped += metafieldsToSet.length;
        }
      } catch (e: any) {
        console.log(`   ! Errore: ${e.message?.substring(0, 60)}`);
        skipped += metafieldsToSet.length;
      }
    }

    console.log('');
    await delay(300);
  }

  console.log('='.repeat(70));
  console.log(`RISULTATO: ${fixed} metafield corretti, ${skipped} saltati`);
  console.log('='.repeat(70));

  await prisma.$disconnect();
}

main().catch(console.error);
