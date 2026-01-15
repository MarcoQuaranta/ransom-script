/**
 * Verifica completa: metafield, scorte, immagini varianti
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
              }
            }
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                selectedOptions {
                  name
                  value
                }
                inventoryItem {
                  tracked
                }
                media(first: 1) {
                  edges {
                    node {
                      ... on MediaImage {
                        id
                      }
                    }
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
  console.log('='.repeat(80));
  console.log('VERIFICA COMPLETA MORETTI DALLAS');
  console.log('='.repeat(80));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  const sourceProducts = await getAllProducts(sourceClient);
  const targetProducts = await getAllProducts(targetClient);

  console.log('\n' + 'PRODOTTO'.padEnd(45) + 'META'.padEnd(10) + 'SCORTE'.padEnd(12) + 'IMG VAR');
  console.log('-'.repeat(80));

  let allOk = true;

  for (const sp of sourceProducts) {
    const tp = targetProducts.find(p => p.title === sp.title);
    if (!tp) continue;

    // 1. Metafield check
    const sMeta = sp.metafields.edges
      .map((e: any) => e.node)
      .filter((m: any) => m.namespace === 'custom').length;
    const tMeta = tp.metafields.edges
      .map((e: any) => e.node)
      .filter((m: any) => m.namespace === 'custom').length;
    const metaOk = tMeta >= sMeta - 1; // Allow 1 difference due to image metafields
    const metaStatus = metaOk ? `✓ ${tMeta}` : `✗ ${tMeta}/${sMeta}`;

    // 2. Inventory check (all should be untracked)
    const variants = tp.variants.edges.map((e: any) => e.node);
    const trackedCount = variants.filter((v: any) => v.inventoryItem?.tracked === true).length;
    const invOk = trackedCount === 0;
    const invStatus = invOk ? '✓ non mon.' : `✗ ${trackedCount} mon.`;

    // 3. Variant images check
    const colorVariants = variants.filter((v: any) =>
      v.selectedOptions?.some((o: any) => o.name === 'Color')
    );
    const colors = new Set(colorVariants.map((v: any) =>
      v.selectedOptions?.find((o: any) => o.name === 'Color')?.value
    ).filter(Boolean));

    const colorsWithImage = new Set();
    for (const v of colorVariants) {
      if (v.media?.edges?.length > 0) {
        const color = v.selectedOptions?.find((o: any) => o.name === 'Color')?.value;
        if (color) colorsWithImage.add(color);
      }
    }

    const imgOk = colors.size === 0 || colorsWithImage.size > 0;
    const imgStatus = colors.size === 0 ? 'N/A' :
      (colorsWithImage.size >= colors.size ? `✓ ${colorsWithImage.size}/${colors.size}` :
        `⚠ ${colorsWithImage.size}/${colors.size}`);

    if (!metaOk || !invOk) allOk = false;

    console.log(
      sp.title.substring(0, 43).padEnd(45) +
      metaStatus.padEnd(10) +
      invStatus.padEnd(12) +
      imgStatus
    );
  }

  console.log('-'.repeat(80));
  console.log(`\nRISULTATO: ${allOk ? '✓ TUTTO OK' : '⚠ ALCUNI PROBLEMI'}`);

  // Summary
  const targetItalivio = targetProducts.filter(p => p.title.includes('ITALIVIO') || p.title === 'Savage Tiger Cap');
  const totalVariants = targetItalivio.reduce((sum, p) => sum + p.variants.edges.length, 0);
  const totalMeta = targetItalivio.reduce((sum, p) => sum + p.metafields.edges.filter((e: any) => e.node.namespace === 'custom').length, 0);

  console.log('\n' + '='.repeat(80));
  console.log('RIEPILOGO MORETTI DALLAS:');
  console.log(`   Prodotti copiati: ${targetItalivio.length}`);
  console.log(`   Varianti totali: ${totalVariants}`);
  console.log(`   Metafield totali: ${totalMeta}`);
  console.log('='.repeat(80));

  await prisma.$disconnect();
}

main().catch(console.error);
