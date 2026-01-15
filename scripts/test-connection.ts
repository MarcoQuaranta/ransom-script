import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

// Simple read-only query to test Shopify connection
const SHOP_INFO_QUERY = `
  query {
    shop {
      name
      email
      primaryDomain {
        url
        host
      }
      plan {
        displayName
      }
    }
  }
`;

// Get product count (read-only)
const PRODUCTS_COUNT_QUERY = `
  query {
    products(first: 5) {
      edges {
        node {
          id
          title
          status
        }
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

async function testConnection() {
  console.log('='.repeat(60));
  console.log('SHOPAUTO - TEST CONNESSIONE');
  console.log('='.repeat(60));

  try {
    // 1. Test database connection
    console.log('\n[1] Testing database connection...');
    const shops = await prisma.shop.findMany({
      select: {
        id: true,
        name: true,
        shop: true,
        accessToken: true,
        tokenExpiresAt: true,
      }
    });

    console.log(`✓ Database connected! Found ${shops.length} shop(s)`);

    if (shops.length === 0) {
      console.log('\n⚠ No shops configured in database.');
      console.log('You need to connect a Shopify store first via OAuth.');
      return;
    }

    // 2. List all shops
    console.log('\n[2] Configured shops:');
    shops.forEach((shop, i) => {
      const tokenStatus = shop.tokenExpiresAt
        ? (new Date(shop.tokenExpiresAt) > new Date() ? '✓ Valid' : '✗ Expired')
        : '? Unknown';
      console.log(`   ${i + 1}. ${shop.shop} (${shop.name || 'No name'}) - Token: ${tokenStatus}`);
    });

    // 3. Test Shopify API for each shop
    console.log('\n[3] Testing Shopify API connections...');

    for (const shop of shops) {
      console.log(`\n   Testing: ${shop.shop}`);

      const endpoint = `https://${shop.shop}/admin/api/2024-01/graphql.json`;
      const client = new GraphQLClient(endpoint, {
        headers: {
          'X-Shopify-Access-Token': shop.accessToken,
          'Content-Type': 'application/json',
        },
      });

      try {
        // Get shop info
        const shopInfo: any = await client.request(SHOP_INFO_QUERY);
        console.log(`   ✓ Connected to: ${shopInfo.shop.name}`);
        console.log(`   ✓ Domain: ${shopInfo.shop.primaryDomain?.host}`);
        console.log(`   ✓ Plan: ${shopInfo.shop.plan?.displayName}`);

        // Get products count
        const products: any = await client.request(PRODUCTS_COUNT_QUERY);
        const productCount = products.products.edges.length;
        const hasMore = products.products.pageInfo.hasNextPage;
        console.log(`   ✓ Products: ${productCount}${hasMore ? '+' : ''} found`);

        if (productCount > 0) {
          console.log('   Sample products:');
          products.products.edges.forEach((edge: any, i: number) => {
            console.log(`     - ${edge.node.title} (${edge.node.status})`);
          });
        }

      } catch (error: any) {
        console.log(`   ✗ Error: ${error.message}`);
        if (error.response?.errors) {
          error.response.errors.forEach((e: any) => {
            console.log(`     - ${e.message}`);
          });
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('TEST COMPLETATO');
    console.log('='.repeat(60));

  } catch (error: any) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testConnection();
