/**
 * Copia TUTTI i metafield, mappando i riferimenti alle immagini
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

async function main() {
  console.log('='.repeat(70));
  console.log('COPIA METAFIELD CON MAPPING IMMAGINI');
  console.log('='.repeat(70));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  console.log('\n[1] Caricamento prodotti...');
  const sourceProducts = await getAllProducts(sourceClient);
  const targetProducts = await getAllProducts(targetClient);
  console.log(`   Sorgente: ${sourceProducts.length}, Target: ${targetProducts.length}`);

  console.log('\n[2] Copia metafield...\n');

  let totalCopied = 0;
  let totalFailed = 0;

  for (const sourceProduct of sourceProducts) {
    const targetProduct = targetProducts.find(tp => tp.title === sourceProduct.title);
    if (!targetProduct) continue;

    const sourceMetafields = sourceProduct.metafields.edges
      .map((e: any) => e.node)
      .filter((m: any) => m.namespace === 'custom'); // Solo custom

    if (sourceMetafields.length === 0) continue;

    console.log(`${sourceProduct.title.substring(0, 55)}`);

    // Build image mapping (source ID -> target ID by position)
    const sourceMedia = sourceProduct.media.edges
      .map((e: any) => e.node)
      .filter((m: any) => m.id);
    const targetMedia = targetProduct.media.edges
      .map((e: any) => e.node)
      .filter((m: any) => m.id);

    const imageMapping: Map<string, string> = new Map();
    for (let i = 0; i < Math.min(sourceMedia.length, targetMedia.length); i++) {
      imageMapping.set(sourceMedia[i].id, targetMedia[i].id);
    }

    // Prepare metafields
    const metafieldsToSet: any[] = [];

    for (const mf of sourceMetafields) {
      let value = mf.value;

      // Replace MediaImage references
      if (value && value.includes('gid://shopify/MediaImage/')) {
        const regex = /gid:\/\/shopify\/MediaImage\/\d+/g;
        const matches = value.match(regex) || [];

        for (const match of matches) {
          const targetId = imageMapping.get(match);
          if (targetId) {
            value = value.replace(match, targetId);
          }
        }
      }

      // Skip if still contains unresolved MediaImage refs
      if (value && value.includes('gid://shopify/MediaImage/')) {
        console.log(`   ! ${mf.key}: immagine non mappata, skip`);
        continue;
      }

      metafieldsToSet.push({
        ownerId: targetProduct.id,
        namespace: mf.namespace,
        key: mf.key,
        value: value,
        type: mf.type,
      });
    }

    if (metafieldsToSet.length === 0) {
      console.log(`   Nessun metafield da copiare\n`);
      continue;
    }

    // Set metafields in batches (max 25 per request)
    const batchSize = 25;
    let copied = 0;
    let failed = 0;

    for (let i = 0; i < metafieldsToSet.length; i += batchSize) {
      const batch = metafieldsToSet.slice(i, i + batchSize);

      try {
        const result: any = await targetClient.request(SET_METAFIELDS, {
          metafields: batch,
        });

        if (result.metafieldsSet.userErrors.length > 0) {
          console.log(`   ! ${result.metafieldsSet.userErrors[0].message}`);
          failed += batch.length;
        } else {
          copied += result.metafieldsSet.metafields?.length || 0;
        }
      } catch (e: any) {
        console.log(`   ! Errore: ${e.message?.substring(0, 60)}`);
        failed += batch.length;
      }

      await delay(200);
    }

    console.log(`   ✓ ${copied} copiati, ${failed} falliti\n`);
    totalCopied += copied;
    totalFailed += failed;
  }

  console.log('='.repeat(70));
  console.log(`RISULTATO: ${totalCopied} metafield copiati, ${totalFailed} falliti`);
  console.log('='.repeat(70));

  await prisma.$disconnect();
}

main().catch(console.error);
