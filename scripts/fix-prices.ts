/**
 * Script per correggere i prezzi dei prodotti copiati
 */

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
          variants(first: 100) {
            edges {
              node {
                id
                price
                compareAtPrice
                sku
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

// Usa REST API per aggiornare le varianti (più affidabile)
async function updateVariantPrice(shopDomain: string, accessToken: string, variantGid: string, price: string, compareAtPrice?: string) {
  const numericId = variantGid.split('/').pop();
  const url = `https://${shopDomain}/admin/api/2024-01/variants/${numericId}.json`;

  const variantData: any = { price };
  if (compareAtPrice) {
    variantData.compare_at_price = compareAtPrice;
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ variant: variantData }),
  });

  return response.ok;
}

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

async function fixPrices() {
  console.log('='.repeat(60));
  console.log('CORREZIONE PREZZI PRODOTTI');
  console.log('='.repeat(60));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  const sourceShop = await prisma.shop.findUnique({ where: { shop: SOURCE_SHOP } });
  const targetShop = await prisma.shop.findUnique({ where: { shop: TARGET_SHOP } });

  // Get all products from both shops
  console.log('\n[1] Caricamento prodotti...');

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

  console.log(`   Sorgente: ${sourceProducts.length} prodotti`);
  console.log(`   Destinazione: ${targetProducts.length} prodotti`);

  // Match products by title and update prices
  console.log('\n[2] Aggiornamento prezzi...');

  let updated = 0;
  let skipped = 0;

  for (const targetProduct of targetProducts) {
    // Find matching source product
    const sourceProduct = sourceProducts.find(sp => sp.title === targetProduct.title);

    if (!sourceProduct) {
      console.log(`   - ${targetProduct.title.substring(0, 40)}: no match`);
      skipped++;
      continue;
    }

    const targetVariants = targetProduct.variants.edges.map((e: any) => e.node);
    const sourceVariants = sourceProduct.variants.edges.map((e: any) => e.node);

    let variantUpdated = 0;

    for (const targetVar of targetVariants) {
      // Find matching source variant
      let sourceVar: any = null;

      if (sourceVariants.length === 1 && targetVariants.length === 1) {
        sourceVar = sourceVariants[0];
      } else {
        // Match by selectedOptions
        sourceVar = sourceVariants.find((sv: any) => {
          const svOptions = sv.selectedOptions || [];
          const tvOptions = targetVar.selectedOptions || [];
          return tvOptions.every((to: any) =>
            svOptions.some((so: any) => so.name === to.name && so.value === to.value)
          );
        });
      }

      if (sourceVar && sourceVar.price && sourceVar.price !== '0.00') {
        const success = await updateVariantPrice(
          TARGET_SHOP,
          targetShop!.accessToken,
          targetVar.id,
          sourceVar.price,
          sourceVar.compareAtPrice
        );

        if (success) variantUpdated++;
      }
    }

    if (variantUpdated > 0) {
      console.log(`   ✓ ${targetProduct.title.substring(0, 40)}: ${variantUpdated} varianti`);
      updated++;
    } else {
      skipped++;
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n' + '='.repeat(60));
  console.log(`COMPLETATO: ${updated} prodotti aggiornati, ${skipped} saltati`);
  console.log('='.repeat(60));

  await prisma.$disconnect();
}

fixPrices().catch(console.error);
