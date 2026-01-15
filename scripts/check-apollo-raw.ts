/**
 * Legge il contenuto raw del template apollo
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';
import * as fs from 'fs';

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
        }
      }
    }
  }
`;

const THEME_FILE_QUERY = `
  query getThemeFile($themeId: ID!, $filenames: [String!]!) {
    theme(id: $themeId) {
      id
      files(first: 10, filenames: $filenames) {
        edges {
          node {
            filename
            body {
              ... on OnlineStoreThemeFileBodyText {
                content
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

  const sourceThemes: any = await sourceClient.request(THEMES_QUERY);
  const sourceMainTheme = sourceThemes.themes.edges.find((t: any) => t.node.role === 'MAIN');

  const targetThemes: any = await targetClient.request(THEMES_QUERY);
  const targetMainTheme = targetThemes.themes.edges.find((t: any) => t.node.role === 'MAIN');

  // Ottieni template apollo da source
  const sourceFile: any = await sourceClient.request(THEME_FILE_QUERY, {
    themeId: sourceMainTheme.node.id,
    filenames: ['templates/product.apollo.json'],
  });

  const targetFile: any = await targetClient.request(THEME_FILE_QUERY, {
    themeId: targetMainTheme.node.id,
    filenames: ['templates/product.apollo.json'],
  });

  const sourceContent = sourceFile.theme.files.edges[0]?.node.body?.content || '';
  const targetContent = targetFile.theme.files.edges[0]?.node.body?.content || '';

  // Salva su file per analisi
  fs.writeFileSync('apollo-italivio.json', sourceContent);
  fs.writeFileSync('apollo-moretti.json', targetContent);

  console.log('File salvati:');
  console.log('  - apollo-italivio.json');
  console.log('  - apollo-moretti.json');

  // Cerca "stop freezing" o "freezing" nel contenuto
  console.log('\nRicerca "freezing" in Italivio:');
  const freezingMatches = sourceContent.match(/.{0,100}freezing.{0,100}/gi) || [];
  for (const match of freezingMatches.slice(0, 3)) {
    console.log(`  ...${match}...`);
  }

  // Cerca riferimenti a immagini vicino a "freezing"
  console.log('\nRicerca immagini in Italivio:');
  const imageMatches = sourceContent.match(/shopify:\/\/shop_images\/[^"]+/g) || [];
  const uniqueImages = [...new Set(imageMatches)];
  for (const img of uniqueImages) {
    console.log(`  - ${img}`);
  }

  console.log('\nRicerca immagini in Moretti:');
  const targetImageMatches = targetContent.match(/shopify:\/\/shop_images\/[^"]+/g) || [];
  const targetUniqueImages = [...new Set(targetImageMatches)];
  for (const img of targetUniqueImages) {
    console.log(`  - ${img}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
