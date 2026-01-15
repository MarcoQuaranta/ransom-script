/**
 * Script per aggiungere le varianti mancanti ai prodotti
 * Le opzioni sono già create, ora aggiungiamo tutte le combinazioni
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

const SOURCE_SHOP = 'usa-shop-8790.myshopify.com';
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com';

// Query per ottenere prodotti con varianti
const PRODUCTS_QUERY = `
  query getProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          title
          options {
            id
            name
            optionValues {
              id
              name
            }
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                price
                compareAtPrice
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

// Bulk create variants
const VARIANTS_BULK_CREATE = `
  mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants {
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

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('='.repeat(70));
  console.log('AGGIUNTA VARIANTI MANCANTI');
  console.log('='.repeat(70));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  // Get products from both shops
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
  console.log(`   Target: ${targetProducts.length} prodotti`);

  // Process each product
  console.log('\n[2] Aggiunta varianti mancanti...\n');

  let totalAdded = 0;

  for (const sourceProduct of sourceProducts) {
    const targetProduct = targetProducts.find(tp => tp.title === sourceProduct.title);

    if (!targetProduct) {
      continue;
    }

    const sourceVariants = sourceProduct.variants.edges.map((e: any) => e.node);
    const targetVariants = targetProduct.variants.edges.map((e: any) => e.node);

    if (sourceVariants.length <= targetVariants.length) {
      continue;
    }

    console.log(`${sourceProduct.title.substring(0, 50)}`);
    console.log(`   Sorgente: ${sourceVariants.length} varianti, Target: ${targetVariants.length} varianti`);

    // Find missing variants
    const existingCombinations = new Set(
      targetVariants.map((v: any) =>
        v.selectedOptions.map((o: any) => `${o.name}:${o.value}`).sort().join('|')
      )
    );

    const missingVariants: any[] = [];

    for (const sv of sourceVariants) {
      const combo = sv.selectedOptions.map((o: any) => `${o.name}:${o.value}`).sort().join('|');

      if (!existingCombinations.has(combo)) {
        // Map option values to target option value IDs
        const optionValues: any[] = [];

        for (const so of sv.selectedOptions) {
          const targetOption = targetProduct.options.find((to: any) => to.name === so.name);
          if (targetOption) {
            const targetValue = targetOption.optionValues.find((v: any) => v.name === so.value);
            if (targetValue) {
              optionValues.push({ optionId: targetOption.id, id: targetValue.id });
            } else {
              // Value doesn't exist, need to use name
              optionValues.push({ optionId: targetOption.id, name: so.value });
            }
          }
        }

        if (optionValues.length === sv.selectedOptions.length) {
          missingVariants.push({
            price: sv.price,
            compareAtPrice: sv.compareAtPrice || undefined,
            optionValues: optionValues,
          });
        }
      }
    }

    console.log(`   Varianti mancanti: ${missingVariants.length}`);

    if (missingVariants.length === 0) {
      continue;
    }

    // Create missing variants in batches
    const batchSize = 20;
    let added = 0;

    for (let i = 0; i < missingVariants.length; i += batchSize) {
      const batch = missingVariants.slice(i, i + batchSize);

      try {
        const result: any = await targetClient.request(VARIANTS_BULK_CREATE, {
          productId: targetProduct.id,
          variants: batch,
        });

        if (result.productVariantsBulkCreate.userErrors.length > 0) {
          console.log(`   ! ${result.productVariantsBulkCreate.userErrors[0].message}`);
        } else {
          added += result.productVariantsBulkCreate.productVariants?.length || 0;
        }
      } catch (e: any) {
        console.log(`   ! Errore: ${e.message?.substring(0, 80)}`);
      }

      await delay(300);
    }

    console.log(`   ✓ ${added} varianti aggiunte\n`);
    totalAdded += added;
  }

  console.log('='.repeat(70));
  console.log(`TOTALE: ${totalAdded} varianti aggiunte`);
  console.log('='.repeat(70));

  await prisma.$disconnect();
}

main().catch(console.error);
