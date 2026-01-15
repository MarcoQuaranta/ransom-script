import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

async function verify() {
  const shop = await prisma.shop.findUnique({ where: { shop: 'bc2ywa-ee.myshopify.com' } });
  if (!shop) {
    console.log('Shop non trovato');
    return;
  }

  const client = new GraphQLClient(`https://bc2ywa-ee.myshopify.com/admin/api/2024-01/graphql.json`, {
    headers: {
      'X-Shopify-Access-Token': shop.accessToken,
      'Content-Type': 'application/json',
    },
  });

  const result: any = await client.request(`
    query {
      products(first: 25) {
        edges {
          node {
            title
            status
            imagesCount: images(first: 1) { edges { node { id } } }
            variantsCount: variants(first: 1) { edges { node { id price } } }
          }
        }
        pageInfo { hasNextPage }
      }
    }
  `);

  console.log('\nPRODOTTI SU MORETTI DALLAS (bc2ywa-ee.myshopify.com)');
  console.log('='.repeat(55));

  result.products.edges.forEach((e: any, i: number) => {
    const price = e.node.variantsCount.edges[0]?.node?.price || 'N/A';
    console.log(`${i + 1}. ${e.node.title}`);
    console.log(`   Status: ${e.node.status} | Price: $${price}`);
  });

  console.log('='.repeat(55));
  console.log(`Totale: ${result.products.edges.length}${result.products.pageInfo.hasNextPage ? '+' : ''} prodotti`);

  await prisma.$disconnect();
}

verify().catch(console.error);
