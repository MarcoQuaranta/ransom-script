/**
 * Debug del mapping immagini
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();
const SOURCE_SHOP = 'usa-shop-8790.myshopify.com';

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
          media(first: 50) {
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
`;

async function main() {
  const shop = await prisma.shop.findUnique({ where: { shop: SOURCE_SHOP } });
  const client = new GraphQLClient(`https://${SOURCE_SHOP}/admin/api/2024-01/graphql.json`, {
    headers: {
      'X-Shopify-Access-Token': shop!.accessToken,
      'Content-Type': 'application/json',
    },
  });

  const result: any = await client.request(PRODUCTS_QUERY, { first: 5 });
  const product = result.products.edges[0].node;

  console.log(`Prodotto: ${product.title}\n`);

  // Media IDs
  const mediaIds = product.media.edges.map((e: any) => e.node.id).filter(Boolean);
  console.log('Media IDs del prodotto:');
  mediaIds.forEach((id: string) => console.log(`   ${id}`));

  // Metafield image refs
  console.log('\nRiferimenti immagini nei metafield:');
  const imageMeta = product.metafields.edges
    .map((e: any) => e.node)
    .filter((m: any) => m.value?.includes('MediaImage'));

  for (const m of imageMeta) {
    const regex = /gid:\/\/shopify\/MediaImage\/\d+/g;
    const matches = m.value.match(regex) || [];
    console.log(`   ${m.key}:`);
    for (const match of matches) {
      const inMedia = mediaIds.includes(match);
      console.log(`      ${match} ${inMedia ? '✓ (in media)' : '✗ (NOT in media)'}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
