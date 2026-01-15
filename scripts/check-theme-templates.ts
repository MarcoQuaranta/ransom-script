/**
 * Verifica che i template esistano nel tema
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

const SOURCE_SHOP = 'usa-shop-8790.myshopify.com';
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com';

const THEMES_QUERY = `
  query {
    themes(first: 10) {
      edges {
        node {
          id
          name
          role
          files(first: 250, filenames: ["templates/*", "sections/*"]) {
            edges {
              node {
                filename
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
  console.log('='.repeat(80));
  console.log('VERIFICA FILE TEMPLATE NEI TEMI');
  console.log('='.repeat(80));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  // Italivio
  console.log('\n[ITALIVIO] Template prodotto nel tema:');
  const sourceThemes: any = await sourceClient.request(THEMES_QUERY);
  const sourceMainTheme = sourceThemes.themes.edges.find((t: any) => t.node.role === 'MAIN');

  if (sourceMainTheme) {
    const files = sourceMainTheme.node.files.edges.map((e: any) => e.node.filename);
    const productTemplates = files.filter((f: string) => f.includes('product.') || f.includes('product/'));
    console.log(`   Tema: ${sourceMainTheme.node.name}`);
    for (const t of productTemplates.sort()) {
      console.log(`   - ${t}`);
    }
  }

  // Moretti Dallas
  console.log('\n[MORETTI DALLAS] Template prodotto nel tema:');
  const targetThemes: any = await targetClient.request(THEMES_QUERY);
  const targetMainTheme = targetThemes.themes.edges.find((t: any) => t.node.role === 'MAIN');

  if (targetMainTheme) {
    const files = targetMainTheme.node.files.edges.map((e: any) => e.node.filename);
    const productTemplates = files.filter((f: string) => f.includes('product.') || f.includes('product/'));
    console.log(`   Tema: ${targetMainTheme.node.name}`);
    for (const t of productTemplates.sort()) {
      console.log(`   - ${t}`);
    }
  }

  // Confronto
  console.log('\n[CONFRONTO]');
  const sourceFiles = sourceMainTheme?.node.files.edges.map((e: any) => e.node.filename) || [];
  const targetFiles = targetMainTheme?.node.files.edges.map((e: any) => e.node.filename) || [];

  const sourceProductTemplates = sourceFiles.filter((f: string) =>
    f.startsWith('templates/product.') && f.endsWith('.json')
  );
  const targetProductTemplates = targetFiles.filter((f: string) =>
    f.startsWith('templates/product.') && f.endsWith('.json')
  );

  // Template mancanti su Moretti
  const missingTemplates = sourceProductTemplates.filter((t: string) => !targetProductTemplates.includes(t));

  if (missingTemplates.length > 0) {
    console.log('\n   Template MANCANTI su Moretti Dallas:');
    for (const t of missingTemplates) {
      console.log(`   ❌ ${t}`);
    }
  } else {
    console.log('\n   ✓ Tutti i template di Italivio esistono su Moretti Dallas');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
