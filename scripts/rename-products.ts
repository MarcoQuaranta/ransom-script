import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SHOP_ID = 'cmkfaa57v0000w8qso46m602i'; // moretti dallas
const SEARCH_TERM = 'ITALIVIO';
const REPLACE_WITH = 'MORETTI DALLAS';

async function getShopifyProducts(shop: any) {
  const query = `
    query getProducts($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            title
            handle
          }
        }
      }
    }
  `;

  const allProducts: any[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const response = await fetch(`https://${shop.shop}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': shop.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { first: 50, after: cursor }
      }),
    });

    const data: any = await response.json();

    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      break;
    }

    const products = data.data?.products;
    if (!products) break;

    allProducts.push(...products.edges.map((e: any) => e.node));
    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;
  }

  return allProducts;
}

async function updateProductTitle(shop: any, productId: string, newTitle: string) {
  const mutation = `
    mutation productUpdate($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
          title
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const response = await fetch(`https://${shop.shop}/admin/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': shop.accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: mutation,
      variables: {
        input: {
          id: productId,
          title: newTitle
        }
      }
    }),
  });

  const data: any = await response.json();

  if (data.errors) {
    throw new Error(data.errors.map((e: any) => e.message).join(', '));
  }

  if (data.data?.productUpdate?.userErrors?.length > 0) {
    throw new Error(data.data.productUpdate.userErrors.map((e: any) => e.message).join(', '));
  }

  return data.data?.productUpdate?.product;
}

async function main() {
  console.log('🔄 Connecting to Moretti Dallas shop...\n');

  const shop = await prisma.shop.findUnique({
    where: { id: SHOP_ID }
  });

  if (!shop) {
    console.error('❌ Shop not found');
    return;
  }

  console.log(`✅ Connected to: ${shop.name} (${shop.shop})\n`);

  // Get all products
  console.log('📦 Fetching products...');
  const products = await getShopifyProducts(shop);
  console.log(`   Found ${products.length} total products\n`);

  // Find products with ITALIVIO in title
  const productsToRename = products.filter(p =>
    p.title.toUpperCase().includes(SEARCH_TERM)
  );

  if (productsToRename.length === 0) {
    console.log(`✅ No products found with "${SEARCH_TERM}" in the title.`);
    return;
  }

  console.log(`🔍 Found ${productsToRename.length} products to rename:\n`);
  productsToRename.forEach((p, i) => {
    const newTitle = p.title.replace(new RegExp(SEARCH_TERM, 'gi'), REPLACE_WITH);
    console.log(`${i + 1}. "${p.title}"`);
    console.log(`   → "${newTitle}"\n`);
  });

  // Rename products
  console.log('🔄 Renaming products...\n');

  let successCount = 0;
  let errorCount = 0;

  for (const product of productsToRename) {
    const newTitle = product.title.replace(new RegExp(SEARCH_TERM, 'gi'), REPLACE_WITH);

    try {
      await updateProductTitle(shop, product.id, newTitle);
      console.log(`✅ "${product.title}" → "${newTitle}"`);
      successCount++;
    } catch (error: any) {
      console.error(`❌ Failed to rename "${product.title}": ${error.message}`);
      errorCount++;
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log(`\n========================================`);
  console.log(`✅ Successfully renamed: ${successCount}`);
  if (errorCount > 0) {
    console.log(`❌ Failed: ${errorCount}`);
  }
  console.log(`========================================`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
