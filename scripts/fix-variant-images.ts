/**
 * Associa immagini alle varianti colore mancanti
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();
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
                title
                selectedOptions {
                  name
                  value
                }
                media(first: 1) {
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
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const VARIANT_APPEND_MEDIA = `
  mutation productVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
    productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
      productVariants { id }
      userErrors { field message }
    }
  }
`;

async function getClient(): Promise<GraphQLClient> {
  const shop = await prisma.shop.findUnique({ where: { shop: TARGET_SHOP } });
  if (!shop) throw new Error('Shop not found');
  return new GraphQLClient(`https://${TARGET_SHOP}/admin/api/2024-01/graphql.json`, {
    headers: {
      'X-Shopify-Access-Token': shop.accessToken,
      'Content-Type': 'application/json',
    },
  });
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function getAllProducts(client: GraphQLClient): Promise<any[]> {
  let products: any[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const result: any = await client.request(PRODUCTS_QUERY, { first: 50, after: cursor });
    products = products.concat(result.products.edges.map((e: any) => e.node));
    hasNextPage = result.products.pageInfo.hasNextPage;
    cursor = result.products.pageInfo.endCursor;
  }

  return products;
}

async function main() {
  console.log('='.repeat(70));
  console.log('ASSOCIAZIONE IMMAGINI ALLE VARIANTI COLORE');
  console.log('='.repeat(70));

  const client = await getClient();
  const products = await getAllProducts(client);

  console.log(`\n${products.length} prodotti trovati\n`);

  let totalFixed = 0;

  for (const product of products) {
    if (!product.title.includes('ITALIVIO') && product.title !== 'Savage Tiger Cap') {
      continue;
    }

    const variants = product.variants.edges.map((e: any) => e.node);
    const media = product.media.edges.map((e: any) => e.node).filter((m: any) => m.id);

    if (media.length === 0) continue;

    // Group variants by color
    const colorGroups: Map<string, any[]> = new Map();

    for (const v of variants) {
      const colorOpt = v.selectedOptions?.find((o: any) => o.name === 'Color');
      if (colorOpt) {
        const color = colorOpt.value;
        if (!colorGroups.has(color)) {
          colorGroups.set(color, []);
        }
        colorGroups.get(color)!.push(v);
      }
    }

    if (colorGroups.size === 0) continue;

    // Find colors without images
    const colorsWithoutImages: string[] = [];
    for (const [color, varis] of colorGroups) {
      const hasImage = varis.some(v => v.media?.edges?.length > 0);
      if (!hasImage) {
        colorsWithoutImages.push(color);
      }
    }

    if (colorsWithoutImages.length === 0) continue;

    console.log(`${product.title.substring(0, 55)}`);
    console.log(`   Colori senza immagini: ${colorsWithoutImages.join(', ')}`);

    // Assign images to colors that don't have them
    const variantMediaInputs: any[] = [];
    let mediaIndex = 0;

    for (const color of colorsWithoutImages) {
      const varis = colorGroups.get(color)!;
      const firstVariant = varis[0];

      if (mediaIndex < media.length) {
        variantMediaInputs.push({
          variantId: firstVariant.id,
          mediaIds: [media[mediaIndex].id],
        });
        mediaIndex++;
      }
    }

    if (variantMediaInputs.length > 0) {
      try {
        const result: any = await client.request(VARIANT_APPEND_MEDIA, {
          productId: product.id,
          variantMedia: variantMediaInputs,
        });

        if (result.productVariantAppendMedia.userErrors.length === 0) {
          console.log(`   ✓ ${variantMediaInputs.length} colori associati a immagini`);
          totalFixed += variantMediaInputs.length;
        } else {
          console.log(`   ! ${result.productVariantAppendMedia.userErrors[0].message}`);
        }
      } catch (e: any) {
        console.log(`   ! Errore: ${e.message?.substring(0, 60)}`);
      }
    }

    console.log('');
    await delay(300);
  }

  console.log('='.repeat(70));
  console.log(`RISULTATO: ${totalFixed} colori associati a immagini`);
  console.log('='.repeat(70));

  await prisma.$disconnect();
}

main().catch(console.error);
