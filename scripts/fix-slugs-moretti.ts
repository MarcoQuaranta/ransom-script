import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SHOP_ID = 'cmkfaa57v0000w8qso46m602i'; // moretti dallas

const GET_PRODUCTS_QUERY = `
  query getProducts($cursor: String) {
    products(first: 50, after: $cursor) {
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

const UPDATE_PRODUCT_MUTATION = `
  mutation updateProduct($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

async function shopifyGraphql(shop: any, query: string, variables: any = {}) {
  const response = await fetch(
    `https://${shop.shop}/admin/api/2024-01/graphql.json`,
    {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': shop.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  const data = await response.json();
  if (data.errors) {
    throw new Error(data.errors[0].message);
  }
  return data.data;
}

async function main() {
  console.log('Connecting to Moretti Dallas shop...\n');

  const shop = await prisma.shop.findUnique({ where: { id: SHOP_ID } });
  if (!shop) {
    console.error('Shop not found');
    return;
  }

  console.log(`Connected to: ${shop.name} (${shop.shop})\n`);

  // Fetch all products
  console.log('Fetching products...\n');
  const allProducts: any[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const result: any = await shopifyGraphql(shop, GET_PRODUCTS_QUERY, { cursor });
    const products = result.products.edges.map((e: any) => e.node);
    allProducts.push(...products);
    hasNextPage = result.products.pageInfo.hasNextPage;
    cursor = result.products.pageInfo.endCursor;
  }

  console.log(`Found ${allProducts.length} products\n`);

  // Find products with "italivio" in handle
  const productsToFix = allProducts.filter((p: any) =>
    p.handle.toLowerCase().includes('italivio')
  );

  console.log(`Products with "italivio" in slug: ${productsToFix.length}\n`);

  if (productsToFix.length === 0) {
    console.log('No products need fixing!');
    return;
  }

  console.log('Products to update:');
  productsToFix.forEach((p: any) => {
    const newHandle = p.handle
      .replace(/italivio-/gi, '')
      .replace(/-italivio/gi, '')
      .replace(/italivio/gi, '')
      .replace(/--+/g, '-') // Remove double dashes
      .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
    console.log(`  ${p.handle} -> ${newHandle}`);
  });

  console.log('\nUpdating slugs...\n');

  let successCount = 0;
  let errorCount = 0;

  for (const product of productsToFix) {
    const newHandle = product.handle
      .replace(/italivio-/gi, '')
      .replace(/-italivio/gi, '')
      .replace(/italivio/gi, '')
      .replace(/--+/g, '-')
      .replace(/^-|-$/g, '');

    if (newHandle === product.handle) {
      console.log(`[SKIP] ${product.title}: handle unchanged`);
      continue;
    }

    try {
      const result: any = await shopifyGraphql(shop, UPDATE_PRODUCT_MUTATION, {
        input: {
          id: product.id,
          handle: newHandle,
        },
      });

      if (result.productUpdate.userErrors?.length > 0) {
        console.error(`[ERROR] ${product.title}: ${result.productUpdate.userErrors[0].message}`);
        errorCount++;
      } else {
        console.log(`[OK] ${product.title}: ${product.handle} -> ${result.productUpdate.product.handle}`);
        successCount++;
      }
    } catch (error: any) {
      console.error(`[ERROR] ${product.title}: ${error.message}`);
      errorCount++;
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log('\n========================================');
  console.log(`Updated: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log('========================================');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
