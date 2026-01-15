/**
 * Verifica le immagini shop_images su entrambi gli shop
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

const SOURCE_SHOP = 'usa-shop-8790.myshopify.com';
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com';

const FILES_QUERY = `
  query getFiles($first: Int!, $after: String) {
    files(first: $first, after: $after, query: "media_type:IMAGE") {
      edges {
        node {
          ... on MediaImage {
            id
            image {
              url
              altText
            }
          }
          ... on GenericFile {
            id
            url
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

async function getAllFiles(client: GraphQLClient): Promise<any[]> {
  let files: any[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    try {
      const result: any = await client.request(FILES_QUERY, { first: 50, after: cursor });
      files = files.concat(result.files.edges.map((e: any) => e.node));
      hasNextPage = result.files.pageInfo.hasNextPage;
      cursor = result.files.pageInfo.endCursor;
    } catch (e) {
      break;
    }
  }

  return files;
}

function extractFilename(url: string): string {
  try {
    const parts = url.split('/');
    return parts[parts.length - 1].split('?')[0];
  } catch {
    return url;
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('VERIFICA IMMAGINI SHOP');
  console.log('='.repeat(80));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  console.log('\n[1] Caricamento file...');
  const sourceFiles = await getAllFiles(sourceClient);
  const targetFiles = await getAllFiles(targetClient);

  console.log(`   Italivio: ${sourceFiles.length} file`);
  console.log(`   Moretti: ${targetFiles.length} file`);

  // Immagini da cercare (dal template apollo)
  const imagesToFind = [
    'Progetto_senza_titolo.png',
    'general-clothing-bold-4.jpg',
  ];

  console.log('\n[2] Ricerca immagini specifiche...');

  for (const imgName of imagesToFind) {
    console.log(`\n   📄 ${imgName}:`);

    // Cerca su Italivio
    const sourceFile = sourceFiles.find(f => {
      const url = f.image?.url || f.url || '';
      return url.includes(imgName);
    });

    if (sourceFile) {
      const url = sourceFile.image?.url || sourceFile.url;
      console.log(`      Italivio: ✓ ${url?.substring(0, 80)}...`);
    } else {
      console.log(`      Italivio: ❌ Non trovata`);
    }

    // Cerca su Moretti
    const targetFile = targetFiles.find(f => {
      const url = f.image?.url || f.url || '';
      return url.includes(imgName);
    });

    if (targetFile) {
      const url = targetFile.image?.url || targetFile.url;
      console.log(`      Moretti:  ✓ ${url?.substring(0, 80)}...`);
    } else {
      console.log(`      Moretti:  ❌ Non trovata`);
    }
  }

  // Mostra tutte le immagini su Moretti Dallas
  console.log('\n[3] Tutte le immagini su Moretti Dallas:');
  for (const f of targetFiles.slice(0, 20)) {
    const url = f.image?.url || f.url || '';
    const filename = extractFilename(url);
    console.log(`   - ${filename}`);
  }
  if (targetFiles.length > 20) {
    console.log(`   ... e altre ${targetFiles.length - 20}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
