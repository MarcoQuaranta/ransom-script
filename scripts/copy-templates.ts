/**
 * Copia template mancanti da Italivio a Moretti Dallas
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
        }
      }
    }
  }
`;

// Query per ottenere il contenuto di un file del tema
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

// Mutation per creare/aggiornare file nel tema
const THEME_FILE_UPSERT = `
  mutation themeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      upsertedThemeFiles {
        filename
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

async function main() {
  console.log('='.repeat(80));
  console.log('COPIA TEMPLATE DA ITALIVIO A MORETTI DALLAS');
  console.log('='.repeat(80));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  // Ottieni temi principali
  console.log('\n[1] Identificazione temi...');

  const sourceThemes: any = await sourceClient.request(THEMES_QUERY);
  const sourceMainTheme = sourceThemes.themes.edges.find((t: any) => t.node.role === 'MAIN');
  console.log(`   Italivio: ${sourceMainTheme?.node.name} (${sourceMainTheme?.node.id})`);

  const targetThemes: any = await targetClient.request(THEMES_QUERY);
  const targetMainTheme = targetThemes.themes.edges.find((t: any) => t.node.role === 'MAIN');
  console.log(`   Moretti: ${targetMainTheme?.node.name} (${targetMainTheme?.node.id})`);

  if (!sourceMainTheme || !targetMainTheme) {
    console.log('Tema non trovato!');
    await prisma.$disconnect();
    return;
  }

  // Template da copiare
  const templatesToCopy = [
    'templates/product.apollo.json',
    'templates/product.non-scontati.json',
  ];

  console.log('\n[2] Lettura template da Italivio...');

  const sourceFiles: any = await sourceClient.request(THEME_FILE_QUERY, {
    themeId: sourceMainTheme.node.id,
    filenames: templatesToCopy,
  });

  const files = sourceFiles.theme.files.edges.map((e: any) => e.node);

  for (const file of files) {
    console.log(`   ✓ ${file.filename} (${file.body?.content?.length || 0} bytes)`);
  }

  // Copia su Moretti Dallas
  console.log('\n[3] Copia template su Moretti Dallas...');

  const filesToUpsert = files.map((f: any) => ({
    filename: f.filename,
    body: {
      type: 'TEXT',
      value: f.body?.content || '{}',
    },
  }));

  if (filesToUpsert.length > 0) {
    try {
      const result: any = await targetClient.request(THEME_FILE_UPSERT, {
        themeId: targetMainTheme.node.id,
        files: filesToUpsert,
      });

      if (result.themeFilesUpsert.userErrors?.length > 0) {
        for (const err of result.themeFilesUpsert.userErrors) {
          console.log(`   ❌ ${err.field}: ${err.message}`);
        }
      } else {
        for (const f of result.themeFilesUpsert.upsertedThemeFiles || []) {
          console.log(`   ✓ ${f.filename} copiato`);
        }
      }
    } catch (e: any) {
      console.log(`   ❌ Errore: ${e.message?.substring(0, 100)}`);
    }
  }

  // Verifica finale
  console.log('\n[4] Verifica...');

  const verifyFiles: any = await targetClient.request(THEME_FILE_QUERY, {
    themeId: targetMainTheme.node.id,
    filenames: templatesToCopy,
  });

  const verifiedFiles = verifyFiles.theme.files.edges.map((e: any) => e.node);

  for (const t of templatesToCopy) {
    const exists = verifiedFiles.some((f: any) => f.filename === t);
    console.log(`   ${exists ? '✓' : '❌'} ${t}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('COMPLETATO');
  console.log('='.repeat(80));

  await prisma.$disconnect();
}

main().catch(console.error);
