/**
 * Verifica che l'immagine apollo sia accessibile su Moretti Dallas
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();
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

async function main() {
  const shop = await prisma.shop.findUnique({ where: { shop: TARGET_SHOP } });
  const client = new GraphQLClient(`https://${TARGET_SHOP}/admin/api/2024-01/graphql.json`, {
    headers: {
      'X-Shopify-Access-Token': shop!.accessToken,
      'Content-Type': 'application/json',
    },
  });

  console.log('Ricerca immagini "general-clothing" su Moretti Dallas...\n');

  let found = false;
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage && !found) {
    const result: any = await client.request(FILES_QUERY, { first: 50, after: cursor });

    for (const edge of result.files.edges) {
      const url = edge.node?.image?.url || '';
      if (url.includes('general-clothing')) {
        console.log('✓ TROVATA:');
        console.log(`  ID: ${edge.node.id}`);
        console.log(`  URL: ${url}`);
        found = true;
        break;
      }
    }

    hasNextPage = result.files.pageInfo.hasNextPage;
    cursor = result.files.pageInfo.endCursor;
  }

  if (!found) {
    console.log('❌ Immagine non trovata!');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
