/**
 * Script per ricreare i prodotti con opzioni e varianti
 * Usa productOptionsCreate PRIMA di creare le varianti
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

const SOURCE_SHOP = 'usa-shop-8790.myshopify.com';
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com';

// Query prodotti
const PRODUCTS_FULL_QUERY = `
  query getProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          title
          descriptionHtml
          vendor
          productType
          tags
          status
          templateSuffix
          options {
            name
            values
          }
          variants(first: 100) {
            edges {
              node {
                title
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
          images(first: 50) {
            edges {
              node {
                url
                altText
              }
            }
          }
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
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// Query prodotti target
const TARGET_PRODUCTS_QUERY = `
  query getProducts($first: Int!, $query: String) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
        }
      }
    }
  }
`;

// Elimina prodotto
const DELETE_PRODUCT = `
  mutation productDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) {
      deletedProductId
      userErrors { field message }
    }
  }
`;

// Crea prodotto
const CREATE_PRODUCT = `
  mutation productCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        variants(first: 1) {
          edges {
            node {
              id
            }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

// Crea opzioni
const CREATE_OPTIONS = `
  mutation productOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!) {
    productOptionsCreate(productId: $productId, options: $options) {
      userErrors { field message }
      product {
        id
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
              selectedOptions {
                name
                value
              }
            }
          }
        }
      }
    }
  }
`;

// Aggiorna varianti
const UPDATE_VARIANTS = `
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
      }
      userErrors { field message }
    }
  }
`;

// Delete variant
const DELETE_VARIANT = `
  mutation productVariantDelete($id: ID!) {
    productVariantDelete(id: $id) {
      deletedProductVariantId
      userErrors { field message }
    }
  }
`;

// Media
const CREATE_MEDIA = `
  mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { ... on MediaImage { id } }
      mediaUserErrors { field message }
    }
  }
`;

// Metafields
const SET_METAFIELDS = `
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`;

// Publications
const GET_PUBLICATIONS = `
  query { publications(first: 10) { edges { node { id } } } }
`;

const PUBLISH_PRODUCT = `
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
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
  console.log('RICREAZIONE PRODOTTI CON OPZIONI E VARIANTI');
  console.log('='.repeat(70));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  // 1. Publications
  console.log('\n[1] Recupero canali...');
  const pubResult: any = await targetClient.request(GET_PUBLICATIONS);
  const publications = pubResult.publications?.edges || [];

  // 2. Delete existing
  console.log('\n[2] Eliminazione prodotti ITALIVIO esistenti...');
  const existingResult: any = await targetClient.request(TARGET_PRODUCTS_QUERY, {
    first: 100,
    query: 'title:*ITALIVIO*',
  });

  for (const edge of existingResult.products.edges) {
    try {
      await targetClient.request(DELETE_PRODUCT, { input: { id: edge.node.id } });
      console.log(`   ✓ ${edge.node.title.substring(0, 50)}`);
    } catch (e) {}
    await delay(200);
  }

  // 3. Get source products
  console.log('\n[3] Caricamento prodotti Italivio...');
  let sourceProducts: any[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const result: any = await sourceClient.request(PRODUCTS_FULL_QUERY, { first: 50, after: cursor });
    sourceProducts = sourceProducts.concat(result.products.edges.map((e: any) => e.node));
    hasNextPage = result.products.pageInfo.hasNextPage;
    cursor = result.products.pageInfo.endCursor;
  }
  console.log(`   ${sourceProducts.length} prodotti`);

  // 4. Create products
  console.log('\n[4] Creazione prodotti...\n');

  let success = 0;
  let fail = 0;

  for (const product of sourceProducts) {
    try {
      const variants = product.variants.edges.map((e: any) => e.node);
      const hasOptions = product.options?.length > 0 && product.options[0].name !== 'Title';

      console.log(`[${success + fail + 1}/${sourceProducts.length}] ${product.title}`);
      console.log(`   Opzioni: ${hasOptions ? product.options.map((o: any) => `${o.name}(${o.values.length})`).join(', ') : 'nessuna'}`);
      console.log(`   Varianti sorgente: ${variants.length}`);

      // Create product
      const createResult: any = await targetClient.request(CREATE_PRODUCT, {
        input: {
          title: product.title,
          descriptionHtml: product.descriptionHtml || '',
          vendor: product.vendor || '',
          productType: product.productType || '',
          tags: product.tags || [],
          status: product.status,
          templateSuffix: product.templateSuffix || null,
        },
      });

      if (createResult.productCreate.userErrors.length > 0) {
        console.log(`   ✗ ${createResult.productCreate.userErrors[0].message}`);
        fail++;
        continue;
      }

      const newProduct = createResult.productCreate.product;
      const defaultVariantId = newProduct.variants.edges[0]?.node?.id;

      await delay(300);

      // Create options and variants
      if (hasOptions && variants.length > 1) {
        // Create options with all values
        const optionsInput = product.options.map((opt: any) => ({
          name: opt.name,
          values: opt.values.map((v: string) => ({ name: v })),
        }));

        const optResult: any = await targetClient.request(CREATE_OPTIONS, {
          productId: newProduct.id,
          options: optionsInput,
        });

        if (optResult.productOptionsCreate.userErrors.length > 0) {
          console.log(`   ! Opzioni: ${optResult.productOptionsCreate.userErrors[0].message}`);
        } else {
          const createdVariants = optResult.productOptionsCreate.product?.variants?.edges || [];
          console.log(`   ✓ ${product.options.length} opzioni, ${createdVariants.length} varianti generate`);

          // Update variant prices by matching selectedOptions
          if (createdVariants.length > 0) {
            const variantUpdates: any[] = [];

            for (const tv of createdVariants) {
              const targetOpts = tv.node.selectedOptions;

              // Find matching source variant
              const sourceVar = variants.find((sv: any) => {
                return targetOpts.every((to: any) =>
                  sv.selectedOptions.some((so: any) =>
                    so.name === to.name && so.value === to.value
                  )
                );
              });

              if (sourceVar) {
                variantUpdates.push({
                  id: tv.node.id,
                  price: sourceVar.price,
                  compareAtPrice: sourceVar.compareAtPrice || undefined,
                });
              }
            }

            if (variantUpdates.length > 0) {
              // Update in batches
              const batchSize = 50;
              let updated = 0;

              for (let i = 0; i < variantUpdates.length; i += batchSize) {
                const batch = variantUpdates.slice(i, i + batchSize);
                try {
                  const updateResult: any = await targetClient.request(UPDATE_VARIANTS, {
                    productId: newProduct.id,
                    variants: batch,
                  });
                  if (updateResult.productVariantsBulkUpdate.userErrors.length === 0) {
                    updated += batch.length;
                  }
                } catch (e) {}
                await delay(200);
              }

              console.log(`   ✓ ${updated} prezzi aggiornati`);
            }
          }
        }
      } else {
        // Single variant - update price
        if (defaultVariantId && variants.length > 0) {
          const v = variants[0];
          const targetShop = await prisma.shop.findUnique({ where: { shop: TARGET_SHOP } });
          const numericId = defaultVariantId.split('/').pop();

          await fetch(`https://${TARGET_SHOP}/admin/api/2024-01/variants/${numericId}.json`, {
            method: 'PUT',
            headers: {
              'X-Shopify-Access-Token': targetShop!.accessToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              variant: { price: v.price, compare_at_price: v.compareAtPrice },
            }),
          });
          console.log(`   ✓ Prezzo: $${v.price}`);
        }
      }

      await delay(300);

      // Images
      const images = product.images.edges.map((e: any) => e.node);
      if (images.length > 0) {
        try {
          await targetClient.request(CREATE_MEDIA, {
            productId: newProduct.id,
            media: images.map((img: any) => ({
              originalSource: img.url,
              alt: img.altText || '',
              mediaContentType: 'IMAGE',
            })),
          });
          console.log(`   ✓ ${images.length} immagini`);
        } catch (e) {}
        await delay(300);
      }

      // Metafields
      const metafields = product.metafields.edges
        .map((e: any) => e.node)
        .filter((mf: any) => mf.namespace !== 'shopify' && mf.namespace !== 'reviews');

      if (metafields.length > 0) {
        try {
          await targetClient.request(SET_METAFIELDS, {
            metafields: metafields.map((mf: any) => ({
              ownerId: newProduct.id,
              namespace: mf.namespace,
              key: mf.key,
              value: mf.value,
              type: mf.type,
            })),
          });
          console.log(`   ✓ ${metafields.length} metafields`);
        } catch (e) {}
      }

      // Publish
      for (const pub of publications) {
        try {
          await targetClient.request(PUBLISH_PRODUCT, {
            id: newProduct.id,
            input: [{ publicationId: pub.node.id }],
          });
        } catch (e) {}
      }

      success++;
      console.log(`   ✓ COMPLETATO\n`);
      await delay(500);

    } catch (error: any) {
      console.log(`   ✗ ERRORE: ${error.message?.substring(0, 100)}\n`);
      fail++;
    }
  }

  console.log('='.repeat(70));
  console.log(`RISULTATO: ${success} OK, ${fail} FALLITI`);
  console.log('='.repeat(70));

  await prisma.$disconnect();
}

main().catch(console.error);
