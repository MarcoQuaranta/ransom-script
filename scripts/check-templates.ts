/**
 * Verifica template prodotti su Italivio e Moretti Dallas
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

// Query per ottenere i temi
const THEMES_QUERY = `
  query {
    themes(first: 10) {
      edges {
        node {
          id
          name
          role
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
  console.log('VERIFICA TEMPLATE PRODOTTI');
  console.log('='.repeat(80));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  // Ottieni temi
  console.log('\n[1] Temi attivi...');

  const sourceThemes: any = await sourceClient.request(THEMES_QUERY);
  console.log('\n   ITALIVIO:');
  for (const t of sourceThemes.themes.edges) {
    console.log(`   - ${t.node.name} (${t.node.role}) - ID: ${t.node.id}`);
  }

  const targetThemes: any = await targetClient.request(THEMES_QUERY);
  console.log('\n   MORETTI DALLAS:');
  for (const t of targetThemes.themes.edges) {
    console.log(`   - ${t.node.name} (${t.node.role}) - ID: ${t.node.id}`);
  }

  // Ottieni prodotti
  console.log('\n[2] Prodotti e template...');

  const sourceProducts = await getAllProducts(sourceClient);
  const targetProducts = await getAllProducts(targetClient);

  // Raggruppa per template
  const sourceByTemplate: Map<string, string[]> = new Map();
  for (const p of sourceProducts) {
    const template = p.templateSuffix || '(default)';
    if (!sourceByTemplate.has(template)) {
      sourceByTemplate.set(template, []);
    }
    sourceByTemplate.get(template)!.push(p.title);
  }

  const targetByTemplate: Map<string, string[]> = new Map();
  for (const p of targetProducts) {
    const template = p.templateSuffix || '(default)';
    if (!targetByTemplate.has(template)) {
      targetByTemplate.set(template, []);
    }
    targetByTemplate.get(template)!.push(p.title);
  }

  console.log('\n   ITALIVIO - Template utilizzati:');
  for (const [template, products] of sourceByTemplate) {
    console.log(`\n   📄 ${template}:`);
    for (const p of products) {
      console.log(`      - ${p}`);
    }
  }

  console.log('\n   MORETTI DALLAS - Template utilizzati:');
  for (const [template, products] of targetByTemplate) {
    console.log(`\n   📄 ${template}:`);
    for (const p of products.slice(0, 5)) {
      console.log(`      - ${p}`);
    }
    if (products.length > 5) {
      console.log(`      ... e altri ${products.length - 5}`);
    }
  }

  // Verifica differenze
  console.log('\n[3] Differenze da correggere:');

  for (const sp of sourceProducts) {
    const tp = targetProducts.find(t => t.title === sp.title);
    if (tp && sp.templateSuffix !== tp.templateSuffix) {
      console.log(`   ⚠ "${sp.title}": Italivio="${sp.templateSuffix || 'default'}" vs Moretti="${tp.templateSuffix || 'default'}"`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
