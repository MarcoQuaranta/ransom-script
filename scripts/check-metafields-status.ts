/**
 * Verifica stato metafield tra source e target
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

const SOURCE_SHOP = 'usa-shop-8790.myshopify.com';
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com';

const PRODUCTS_QUERY = `
  query getProducts($first: Int!) {
    products(first: $first) {
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
        }
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

async function main() {
  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  const sourceResult: any = await sourceClient.request(PRODUCTS_QUERY, { first: 50 });
  const targetResult: any = await targetClient.request(PRODUCTS_QUERY, { first: 50 });

  const sourceProducts = sourceResult.products.edges.map((e: any) => e.node);
  const targetProducts = targetResult.products.edges.map((e: any) => e.node);

  console.log('='.repeat(70));
  console.log('VERIFICA METAFIELD');
  console.log('='.repeat(70));

  // Check first product in detail
  const sp = sourceProducts.find((p: any) => p.title.includes('Raincoat'));
  const tp = targetProducts.find((p: any) => p.title.includes('Raincoat'));

  if (sp && tp) {
    console.log(`\nProdotto: ${sp.title}`);

    const sMeta = sp.metafields.edges.map((e: any) => e.node);
    const tMeta = tp.metafields.edges.map((e: any) => e.node);

    console.log(`\nSORGENTE (${sMeta.length} metafields):`);
    for (const m of sMeta.filter((m: any) => m.namespace === 'custom')) {
      const hasImage = m.value?.includes('MediaImage');
      console.log(`   ${m.key}: ${m.value?.substring(0, 50)}${m.value?.length > 50 ? '...' : ''} ${hasImage ? '[IMG]' : ''}`);
    }

    console.log(`\nTARGET (${tMeta.length} metafields):`);
    for (const m of tMeta.filter((m: any) => m.namespace === 'custom')) {
      const hasImage = m.value?.includes('MediaImage');
      console.log(`   ${m.key}: ${m.value?.substring(0, 50)}${m.value?.length > 50 ? '...' : ''} ${hasImage ? '[IMG]' : ''}`);
    }

    // Find missing
    const targetKeys = new Set(tMeta.map((m: any) => `${m.namespace}.${m.key}`));
    const missing = sMeta.filter((m: any) => !targetKeys.has(`${m.namespace}.${m.key}`));

    console.log(`\nMETAFIELD MANCANTI SU TARGET (${missing.length}):`);
    for (const m of missing) {
      const hasImage = m.value?.includes('MediaImage');
      console.log(`   ${m.namespace}.${m.key} ${hasImage ? '[contiene IMG ref]' : ''}`);
    }
  }

  // Summary for all products
  console.log('\n' + '='.repeat(70));
  console.log('RIEPILOGO PER PRODOTTO');
  console.log('='.repeat(70));

  for (const sp of sourceProducts) {
    const tp = targetProducts.find((p: any) => p.title === sp.title);
    if (!tp) continue;

    const sMeta = sp.metafields.edges
      .map((e: any) => e.node)
      .filter((m: any) => m.namespace === 'custom');
    const tMeta = tp.metafields.edges
      .map((e: any) => e.node)
      .filter((m: any) => m.namespace === 'custom');

    const missing = sMeta.filter((sm: any) =>
      !tMeta.some((tm: any) => tm.key === sm.key)
    ).length;

    const status = missing === 0 ? '✓' : `✗ (${missing} mancanti)`;
    console.log(`${sp.title.substring(0, 50).padEnd(50)} S:${sMeta.length} T:${tMeta.length} ${status}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
