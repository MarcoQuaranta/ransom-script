/**
 * Confronta il template apollo tra Italivio e Moretti Dallas
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
  console.log('='.repeat(80));
  console.log('CONFRONTO TEMPLATE APOLLO');
  console.log('='.repeat(80));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  // Ottieni temi
  const sourceThemes: any = await sourceClient.request(THEMES_QUERY);
  const sourceMainTheme = sourceThemes.themes.edges.find((t: any) => t.node.role === 'MAIN');

  const targetThemes: any = await targetClient.request(THEMES_QUERY);
  const targetMainTheme = targetThemes.themes.edges.find((t: any) => t.node.role === 'MAIN');

  // Ottieni template apollo
  const sourceFile: any = await sourceClient.request(THEME_FILE_QUERY, {
    themeId: sourceMainTheme.node.id,
    filenames: ['templates/product.apollo.json'],
  });

  const targetFile: any = await targetClient.request(THEME_FILE_QUERY, {
    themeId: targetMainTheme.node.id,
    filenames: ['templates/product.apollo.json'],
  });

  const sourceContent = JSON.parse(sourceFile.theme.files.edges[0]?.node.body?.content || '{}');
  const targetContent = JSON.parse(targetFile.theme.files.edges[0]?.node.body?.content || '{}');

  // Cerca sezioni con "stop freezing" o immagini
  console.log('\n[ITALIVIO] Sezioni con immagini:');

  for (const [key, section] of Object.entries(sourceContent.sections || {})) {
    const s = section as any;
    if (s.settings?.image || s.settings?.image_1 || s.settings?.image_2) {
      console.log(`\n   📄 ${key} (${s.type}):`);
      if (s.settings?.heading) console.log(`      heading: "${s.settings.heading}"`);
      if (s.settings?.title) console.log(`      title: "${s.settings.title}"`);
      if (s.settings?.image) console.log(`      image: ${s.settings.image}`);
      if (s.settings?.image_1) console.log(`      image_1: ${s.settings.image_1}`);
      if (s.settings?.image_2) console.log(`      image_2: ${s.settings.image_2}`);
    }
  }

  console.log('\n\n[MORETTI DALLAS] Sezioni con immagini:');

  for (const [key, section] of Object.entries(targetContent.sections || {})) {
    const s = section as any;
    if (s.settings?.image || s.settings?.image_1 || s.settings?.image_2) {
      console.log(`\n   📄 ${key} (${s.type}):`);
      if (s.settings?.heading) console.log(`      heading: "${s.settings.heading}"`);
      if (s.settings?.title) console.log(`      title: "${s.settings.title}"`);
      if (s.settings?.image) console.log(`      image: ${s.settings.image}`);
      if (s.settings?.image_1) console.log(`      image_1: ${s.settings.image_1}`);
      if (s.settings?.image_2) console.log(`      image_2: ${s.settings.image_2}`);
    }
  }

  // Confronta le differenze
  console.log('\n\n[DIFFERENZE]:');

  for (const [key, sourceSection] of Object.entries(sourceContent.sections || {})) {
    const ss = sourceSection as any;
    const ts = (targetContent.sections || {})[key] as any;

    if (!ts) continue;

    // Confronta immagini
    const imageFields = ['image', 'image_1', 'image_2', 'background_image'];
    for (const field of imageFields) {
      if (ss.settings?.[field] !== ts.settings?.[field]) {
        console.log(`\n   ⚠ Sezione "${key}" - ${field}:`);
        console.log(`      Italivio: ${ss.settings?.[field] || '(vuoto)'}`);
        console.log(`      Moretti:  ${ts.settings?.[field] || '(vuoto)'}`);
      }
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
