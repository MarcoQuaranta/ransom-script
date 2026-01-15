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
          options {
            name
            values
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                price
                selectedOptions {
                  name
                  value
                }
              }
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

async function checkVariants() {
  console.log('='.repeat(70));
  console.log('CONFRONTO VARIANTI');
  console.log('='.repeat(70));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  // Get products from both shops
  let sourceProducts: any[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const result: any = await sourceClient.request(PRODUCTS_QUERY, { first: 50, after: cursor });
    sourceProducts = sourceProducts.concat(result.products.edges.map((e: any) => e.node));
    hasNextPage = result.products.pageInfo.hasNextPage;
    cursor = result.products.pageInfo.endCursor;
  }

  let targetProducts: any[] = [];
  hasNextPage = true;
  cursor = null;

  while (hasNextPage) {
    const result: any = await targetClient.request(PRODUCTS_QUERY, { first: 50, after: cursor });
    targetProducts = targetProducts.concat(result.products.edges.map((e: any) => e.node));
    hasNextPage = result.products.pageInfo.hasNextPage;
    cursor = result.products.pageInfo.endCursor;
  }

  console.log(`\nITALIVIO: ${sourceProducts.length} prodotti`);
  console.log(`MORETTI DALLAS: ${targetProducts.length} prodotti\n`);

  console.log('PRODOTTO'.padEnd(45) + 'ITALIVIO'.padEnd(12) + 'MORETTI');
  console.log('-'.repeat(70));

  let totalSourceVariants = 0;
  let totalTargetVariants = 0;

  for (const sourceProduct of sourceProducts) {
    const targetProduct = targetProducts.find(tp => tp.title === sourceProduct.title);

    const sourceVarCount = sourceProduct.variants.edges.length;
    totalSourceVariants += sourceVarCount;

    if (targetProduct) {
      const targetVarCount = targetProduct.variants.edges.length;
      totalTargetVariants += targetVarCount;

      const status = sourceVarCount === targetVarCount ? '✓' : '✗';
      const title = sourceProduct.title.substring(0, 43);
      console.log(`${status} ${title.padEnd(43)} ${String(sourceVarCount).padEnd(12)} ${targetVarCount}`);

      if (sourceVarCount !== targetVarCount) {
        // Show options
        console.log(`  Opzioni sorgente: ${sourceProduct.options.map((o: any) => `${o.name}(${o.values.length})`).join(', ')}`);
        if (targetProduct.options) {
          console.log(`  Opzioni target:   ${targetProduct.options.map((o: any) => `${o.name}(${o.values.length})`).join(', ')}`);
        }
      }
    } else {
      console.log(`? ${sourceProduct.title.substring(0, 43).padEnd(43)} ${String(sourceVarCount).padEnd(12)} N/A`);
    }
  }

  console.log('-'.repeat(70));
  console.log(`TOTALE VARIANTI:`.padEnd(45) + `${totalSourceVariants}`.padEnd(12) + `${totalTargetVariants}`);
  console.log('='.repeat(70));

  await prisma.$disconnect();
}

checkVariants().catch(console.error);
