/**
 * Script per:
 * 1. Copiare contenuti metafield mancanti
 * 2. Impostare scorte come non monitorate
 * 3. Associare immagini alle varianti per colore
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

const SOURCE_SHOP = 'usa-shop-8790.myshopify.com';
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com';

// Query prodotti completi
const PRODUCTS_FULL_QUERY = `
  query getProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
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
          variants(first: 100) {
            edges {
              node {
                id
                title
                selectedOptions {
                  name
                  value
                }
                inventoryItem {
                  id
                  tracked
                }
              }
            }
          }
          media(first: 50) {
            edges {
              node {
                ... on MediaImage {
                  id
                  image {
                    url
                    altText
                  }
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

// Set metafields
const SET_METAFIELDS = `
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Update inventory item (disable tracking)
const UPDATE_INVENTORY_ITEM = `
  mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem {
        id
        tracked
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Attach media to variant
const VARIANT_APPEND_MEDIA = `
  mutation productVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
    productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
      productVariants {
        id
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

async function getAllProducts(client: GraphQLClient): Promise<any[]> {
  let products: any[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const result: any = await client.request(PRODUCTS_FULL_QUERY, { first: 50, after: cursor });
    products = products.concat(result.products.edges.map((e: any) => e.node));
    hasNextPage = result.products.pageInfo.hasNextPage;
    cursor = result.products.pageInfo.endCursor;
  }

  return products;
}

async function main() {
  console.log('='.repeat(70));
  console.log('CORREZIONE METAFIELD, SCORTE E IMMAGINI VARIANTI');
  console.log('='.repeat(70));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  // Load products
  console.log('\n[1] Caricamento prodotti...');
  const sourceProducts = await getAllProducts(sourceClient);
  const targetProducts = await getAllProducts(targetClient);
  console.log(`   Sorgente: ${sourceProducts.length}, Target: ${targetProducts.length}`);

  // Stats
  let metafieldsFixed = 0;
  let inventoryFixed = 0;
  let mediaAttached = 0;

  console.log('\n[2] Elaborazione prodotti...\n');

  for (const sourceProduct of sourceProducts) {
    const targetProduct = targetProducts.find(tp => tp.title === sourceProduct.title);
    if (!targetProduct) continue;

    console.log(`${sourceProduct.title.substring(0, 55)}`);

    // --- 1. FIX METAFIELDS ---
    const sourceMetafields = sourceProduct.metafields.edges
      .map((e: any) => e.node)
      .filter((mf: any) => mf.namespace !== 'shopify' && mf.namespace !== 'reviews');

    const targetMetafields = targetProduct.metafields.edges.map((e: any) => e.node);

    // Find missing or different metafields
    const metafieldsToSet: any[] = [];

    for (const smf of sourceMetafields) {
      const tmf = targetMetafields.find(
        (m: any) => m.namespace === smf.namespace && m.key === smf.key
      );

      if (!tmf || tmf.value !== smf.value) {
        metafieldsToSet.push({
          ownerId: targetProduct.id,
          namespace: smf.namespace,
          key: smf.key,
          value: smf.value,
          type: smf.type,
        });
      }
    }

    if (metafieldsToSet.length > 0) {
      try {
        const result: any = await targetClient.request(SET_METAFIELDS, {
          metafields: metafieldsToSet,
        });
        if (result.metafieldsSet.userErrors.length === 0) {
          console.log(`   ✓ ${metafieldsToSet.length} metafields aggiornati`);
          metafieldsFixed += metafieldsToSet.length;
        } else {
          console.log(`   ! Metafields: ${result.metafieldsSet.userErrors[0].message}`);
        }
      } catch (e: any) {
        console.log(`   ! Metafields errore: ${e.message?.substring(0, 60)}`);
      }
      await delay(200);
    } else {
      console.log(`   ✓ Metafields OK`);
    }

    // --- 2. FIX INVENTORY (non monitorato) ---
    const targetVariants = targetProduct.variants.edges.map((e: any) => e.node);
    let inventoryUpdated = 0;

    for (const variant of targetVariants) {
      if (variant.inventoryItem?.tracked === true) {
        try {
          await targetClient.request(UPDATE_INVENTORY_ITEM, {
            id: variant.inventoryItem.id,
            input: { tracked: false },
          });
          inventoryUpdated++;
        } catch (e) {}
      }
    }

    if (inventoryUpdated > 0) {
      console.log(`   ✓ ${inventoryUpdated} varianti -> scorte non monitorate`);
      inventoryFixed += inventoryUpdated;
    } else {
      console.log(`   ✓ Scorte OK`);
    }

    await delay(200);

    // --- 3. ATTACH IMAGES TO COLOR VARIANTS ---
    const targetMedia = targetProduct.media.edges
      .map((e: any) => e.node)
      .filter((m: any) => m.image); // Solo MediaImage

    if (targetMedia.length > 0) {
      // Group variants by color
      const colorVariants: Map<string, any[]> = new Map();

      for (const variant of targetVariants) {
        const colorOpt = variant.selectedOptions?.find((o: any) => o.name === 'Color');
        if (colorOpt) {
          const color = colorOpt.value;
          if (!colorVariants.has(color)) {
            colorVariants.set(color, []);
          }
          colorVariants.get(color)!.push(variant);
        }
      }

      if (colorVariants.size > 0) {
        // Assign images to colors (distribute evenly or by alt text match)
        const colors = Array.from(colorVariants.keys());
        const imagesPerColor = Math.floor(targetMedia.length / colors.length);

        const variantMediaInputs: any[] = [];
        let imageIndex = 0;

        for (const color of colors) {
          const variants = colorVariants.get(color)!;
          const mediaForColor: string[] = [];

          // Take images for this color
          for (let i = 0; i < Math.max(1, imagesPerColor) && imageIndex < targetMedia.length; i++) {
            mediaForColor.push(targetMedia[imageIndex].id);
            imageIndex++;
          }

          // Assign to first variant of this color
          if (mediaForColor.length > 0 && variants.length > 0) {
            variantMediaInputs.push({
              variantId: variants[0].id,
              mediaIds: mediaForColor,
            });
          }
        }

        if (variantMediaInputs.length > 0) {
          try {
            const result: any = await targetClient.request(VARIANT_APPEND_MEDIA, {
              productId: targetProduct.id,
              variantMedia: variantMediaInputs,
            });
            if (result.productVariantAppendMedia.userErrors.length === 0) {
              console.log(`   ✓ Immagini associate a ${variantMediaInputs.length} colori`);
              mediaAttached += variantMediaInputs.length;
            } else {
              console.log(`   ! Media: ${result.productVariantAppendMedia.userErrors[0].message}`);
            }
          } catch (e: any) {
            console.log(`   ! Media errore: ${e.message?.substring(0, 60)}`);
          }
        }
      }
    }

    console.log('');
    await delay(300);
  }

  console.log('='.repeat(70));
  console.log('RIEPILOGO:');
  console.log(`   Metafields aggiornati: ${metafieldsFixed}`);
  console.log(`   Varianti -> scorte non monitorate: ${inventoryFixed}`);
  console.log(`   Colori con immagini associate: ${mediaAttached}`);
  console.log('='.repeat(70));

  await prisma.$disconnect();
}

main().catch(console.error);
