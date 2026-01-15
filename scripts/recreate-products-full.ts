/**
 * Script per ricreare i prodotti con TUTTE le varianti
 * 1. Elimina i prodotti copiati (con | ITALIVIO)
 * 2. Ricrea con tutte le varianti usando productVariantsBulkCreate
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

const SOURCE_SHOP = 'usa-shop-8790.myshopify.com';
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com';

// Query prodotti con tutte le varianti
const PRODUCTS_FULL_QUERY = `
  query getProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
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
                id
                title
                price
                compareAtPrice
                sku
                barcode
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

// Query prodotti target per eliminazione
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
      userErrors {
        field
        message
      }
    }
  }
`;

// Crea prodotto base
const CREATE_PRODUCT = `
  mutation productCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        title
        variants(first: 1) {
          edges {
            node {
              id
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Crea varianti in bulk
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

// Elimina variante default
const DELETE_VARIANT = `
  mutation productVariantDelete($id: ID!) {
    productVariantDelete(id: $id) {
      deletedProductVariantId
      userErrors {
        field
        message
      }
    }
  }
`;

// Media
const CREATE_MEDIA = `
  mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        ... on MediaImage {
          id
        }
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

// Metafields
const SET_METAFIELDS = `
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Publish
const GET_PUBLICATIONS = `
  query { publications(first: 10) { edges { node { id name } } } }
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

async function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('='.repeat(70));
  console.log('RICREAZIONE PRODOTTI CON TUTTE LE VARIANTI');
  console.log('='.repeat(70));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  // 1. Get publications
  console.log('\n[1] Recupero canali pubblicazione...');
  const pubResult: any = await targetClient.request(GET_PUBLICATIONS);
  const publications = pubResult.publications?.edges || [];
  console.log(`   ${publications.length} canali trovati`);

  // 2. Delete existing copied products
  console.log('\n[2] Eliminazione prodotti esistenti con "ITALIVIO"...');
  const existingResult: any = await targetClient.request(TARGET_PRODUCTS_QUERY, {
    first: 100,
    query: 'title:*ITALIVIO*',
  });

  const toDelete = existingResult.products.edges;
  console.log(`   Trovati ${toDelete.length} prodotti da eliminare`);

  for (const edge of toDelete) {
    try {
      await targetClient.request(DELETE_PRODUCT, {
        input: { id: edge.node.id },
      });
      console.log(`   ✓ Eliminato: ${edge.node.title.substring(0, 40)}`);
    } catch (e: any) {
      console.log(`   ✗ Errore: ${edge.node.title.substring(0, 40)}`);
    }
    await delay(200);
  }

  // Also delete "Savage Tiger Cap" duplicates
  const savageResult: any = await targetClient.request(TARGET_PRODUCTS_QUERY, {
    first: 10,
    query: 'title:"Savage Tiger Cap"',
  });

  // Keep only the first one
  const savageCaps = savageResult.products.edges;
  if (savageCaps.length > 1) {
    for (let i = 1; i < savageCaps.length; i++) {
      try {
        await targetClient.request(DELETE_PRODUCT, {
          input: { id: savageCaps[i].node.id },
        });
        console.log(`   ✓ Eliminato duplicato: Savage Tiger Cap`);
      } catch (e) {}
    }
  }

  // 3. Get source products
  console.log('\n[3] Caricamento prodotti da Italivio...');
  let sourceProducts: any[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const result: any = await sourceClient.request(PRODUCTS_FULL_QUERY, { first: 50, after: cursor });
    sourceProducts = sourceProducts.concat(result.products.edges.map((e: any) => e.node));
    hasNextPage = result.products.pageInfo.hasNextPage;
    cursor = result.products.pageInfo.endCursor;
  }
  console.log(`   ${sourceProducts.length} prodotti trovati`);

  // 4. Recreate each product
  console.log('\n[4] Creazione prodotti con varianti...');

  let created = 0;
  let failed = 0;

  for (const product of sourceProducts) {
    try {
      console.log(`\n[${created + failed + 1}/${sourceProducts.length}] ${product.title}`);

      const variants = product.variants.edges.map((e: any) => e.node);
      const hasMultipleVariants = variants.length > 1;

      // Create base product
      const productInput: any = {
        title: product.title,
        descriptionHtml: product.descriptionHtml || '',
        vendor: product.vendor || '',
        productType: product.productType || '',
        tags: product.tags || [],
        status: product.status,
        templateSuffix: product.templateSuffix || null,
      };

      const createResult: any = await targetClient.request(CREATE_PRODUCT, {
        input: productInput,
      });

      if (createResult.productCreate.userErrors.length > 0) {
        console.log(`   ✗ Errore creazione: ${createResult.productCreate.userErrors[0].message}`);
        failed++;
        continue;
      }

      const newProduct = createResult.productCreate.product;
      const defaultVariantId = newProduct.variants.edges[0]?.node?.id;
      console.log(`   ✓ Prodotto base creato`);

      await delay(300);

      // Create all variants
      if (hasMultipleVariants) {
        // Prepare variant inputs
        const variantInputs = variants.map((v: any) => ({
          price: v.price,
          compareAtPrice: v.compareAtPrice || undefined,
          optionValues: v.selectedOptions.map((opt: any) => ({
            optionName: opt.name,
            name: opt.value,
          })),
        }));

        // Create in batches of 50
        const batchSize = 50;
        let totalCreated = 0;

        for (let i = 0; i < variantInputs.length; i += batchSize) {
          const batch = variantInputs.slice(i, i + batchSize);

          try {
            const varResult: any = await targetClient.request(VARIANTS_BULK_CREATE, {
              productId: newProduct.id,
              variants: batch,
            });

            if (varResult.productVariantsBulkCreate.userErrors.length > 0) {
              console.log(`   ! Errore varianti: ${varResult.productVariantsBulkCreate.userErrors[0].message}`);
            } else {
              totalCreated += varResult.productVariantsBulkCreate.productVariants?.length || 0;
            }
          } catch (e: any) {
            console.log(`   ! Errore batch varianti: ${e.message?.substring(0, 80)}`);
          }

          await delay(300);
        }

        console.log(`   ✓ ${totalCreated} varianti create`);

        // Delete default variant
        if (defaultVariantId && totalCreated > 0) {
          try {
            await targetClient.request(DELETE_VARIANT, { id: defaultVariantId });
          } catch (e) {}
        }
      } else {
        // Single variant - update price via REST
        const v = variants[0];
        if (v && defaultVariantId) {
          const numericId = defaultVariantId.split('/').pop();
          const targetShop = await prisma.shop.findUnique({ where: { shop: TARGET_SHOP } });

          await fetch(`https://${TARGET_SHOP}/admin/api/2024-01/variants/${numericId}.json`, {
            method: 'PUT',
            headers: {
              'X-Shopify-Access-Token': targetShop!.accessToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              variant: {
                price: v.price,
                compare_at_price: v.compareAtPrice,
              },
            }),
          });
          console.log(`   ✓ Prezzo variante impostato`);
        }
      }

      // Add images
      const images = product.images.edges.map((e: any) => e.node);
      if (images.length > 0) {
        const mediaInputs = images.map((img: any) => ({
          originalSource: img.url,
          alt: img.altText || '',
          mediaContentType: 'IMAGE',
        }));

        try {
          await targetClient.request(CREATE_MEDIA, {
            productId: newProduct.id,
            media: mediaInputs,
          });
          console.log(`   ✓ ${images.length} immagini`);
        } catch (e: any) {
          console.log(`   ! Errore immagini`);
        }
        await delay(300);
      }

      // Set metafields
      const metafields = product.metafields.edges
        .map((e: any) => e.node)
        .filter((mf: any) => mf.namespace !== 'shopify' && mf.namespace !== 'reviews');

      if (metafields.length > 0) {
        const mfInputs = metafields.map((mf: any) => ({
          ownerId: newProduct.id,
          namespace: mf.namespace,
          key: mf.key,
          value: mf.value,
          type: mf.type,
        }));

        try {
          await targetClient.request(SET_METAFIELDS, { metafields: mfInputs });
          console.log(`   ✓ ${metafields.length} metafields`);
        } catch (e) {
          console.log(`   ! Errore metafields`);
        }
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
      console.log(`   ✓ Pubblicato`);

      created++;
      await delay(500);

    } catch (error: any) {
      console.log(`   ✗ Errore: ${error.message?.substring(0, 100)}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`COMPLETATO: ${created} prodotti, ${failed} falliti`);
  console.log('='.repeat(70));

  await prisma.$disconnect();
}

main().catch(console.error);
