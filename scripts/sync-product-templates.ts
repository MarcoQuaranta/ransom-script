/**
 * Sincronizza i template dei prodotti da Italivio a Moretti Dallas
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
          templateSuffix
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const UPDATE_PRODUCT = `
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        title
        templateSuffix
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

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('='.repeat(80));
  console.log('SINCRONIZZAZIONE TEMPLATE PRODOTTI');
  console.log('='.repeat(80));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  console.log('\n[1] Caricamento prodotti...');
  const sourceProducts = await getAllProducts(sourceClient);
  const targetProducts = await getAllProducts(targetClient);

  console.log(`   Italivio: ${sourceProducts.length} prodotti`);
  console.log(`   Moretti: ${targetProducts.length} prodotti`);

  // Trova prodotti con template diverso
  console.log('\n[2] Verifica template...');

  const toUpdate: { target: any; sourceTemplate: string | null }[] = [];

  for (const sp of sourceProducts) {
    const tp = targetProducts.find(t => t.title === sp.title);

    if (tp) {
      if (sp.templateSuffix !== tp.templateSuffix) {
        toUpdate.push({ target: tp, sourceTemplate: sp.templateSuffix });
        console.log(`   ⚠ "${sp.title}": "${tp.templateSuffix || 'default'}" → "${sp.templateSuffix || 'default'}"`);
      } else {
        console.log(`   ✓ "${sp.title}": "${sp.templateSuffix || 'default'}"`);
      }
    }
  }

  if (toUpdate.length === 0) {
    console.log('\n   ✓ Tutti i prodotti hanno già il template corretto!');
  } else {
    console.log(`\n[3] Aggiornamento ${toUpdate.length} prodotti...`);

    for (const { target, sourceTemplate } of toUpdate) {
      try {
        const result: any = await targetClient.request(UPDATE_PRODUCT, {
          input: {
            id: target.id,
            templateSuffix: sourceTemplate,
          },
        });

        if (result.productUpdate.userErrors?.length > 0) {
          console.log(`   ❌ "${target.title}": ${result.productUpdate.userErrors[0].message}`);
        } else {
          console.log(`   ✓ "${target.title}" → "${sourceTemplate || 'default'}"`);
        }
      } catch (e: any) {
        console.log(`   ❌ "${target.title}": ${e.message?.substring(0, 50)}`);
      }

      await delay(300);
    }
  }

  // Verifica finale
  console.log('\n[4] Verifica finale...');
  const finalProducts = await getAllProducts(targetClient);

  const byTemplate: Map<string, string[]> = new Map();
  for (const p of finalProducts) {
    // Solo prodotti ITALIVIO
    if (!p.title.includes('ITALIVIO') && p.title !== 'Savage Tiger Cap') continue;

    const template = p.templateSuffix || 'default';
    if (!byTemplate.has(template)) {
      byTemplate.set(template, []);
    }
    byTemplate.get(template)!.push(p.title);
  }

  console.log('\n   Template prodotti ITALIVIO su Moretti Dallas:');
  for (const [template, products] of byTemplate) {
    console.log(`\n   📄 ${template} (${products.length} prodotti):`);
    for (const p of products) {
      console.log(`      - ${p.substring(0, 50)}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('COMPLETATO');
  console.log('='.repeat(80));

  await prisma.$disconnect();
}

main().catch(console.error);
