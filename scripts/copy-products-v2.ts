/**
 * Script per copiare prodotti da Italivio a Moretti Dallas
 * Versione 2 - gestisce correttamente varianti e opzioni
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

const SOURCE_SHOP = 'usa-shop-8790.myshopify.com'; // Italivio
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com'; // Moretti Dallas

// Query per ottenere prodotti con tutti i dettagli
const PRODUCTS_QUERY = `
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
                id
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

// Crea prodotto base (senza varianti)
const PRODUCT_CREATE_MUTATION = `
  mutation productCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        title
        handle
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

// Crea opzioni prodotto
const PRODUCT_OPTIONS_CREATE = `
  mutation productOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!) {
    productOptionsCreate(productId: $productId, options: $options) {
      userErrors {
        field
        message
      }
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
              title
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

// Aggiorna varianti in bulk
const PRODUCT_VARIANTS_BULK_UPDATE = `
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
        sku
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Aggiungi media al prodotto
const PRODUCT_CREATE_MEDIA = `
  mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        ... on MediaImage {
          id
          status
        }
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

// Imposta metafields
const METAFIELDS_SET = `
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

// Pubblica prodotto
const GET_PUBLICATIONS_QUERY = `
  query getPublications {
    publications(first: 10) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`;

const PUBLISH_PRODUCT_MUTATION = `
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
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

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function copyProducts() {
  console.log('='.repeat(60));
  console.log('COPIA PRODOTTI DA ITALIVIO A MORETTI DALLAS');
  console.log('='.repeat(60));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  // Get publications
  console.log('\n[0] Recupero canali di pubblicazione...');
  const pubResult: any = await targetClient.request(GET_PUBLICATIONS_QUERY);
  const publications = pubResult.publications?.edges || [];
  console.log(`   Trovati ${publications.length} canali`);

  // Get all products from source
  console.log(`\n[1] Lettura prodotti da Italivio...`);
  let allProducts: any[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const result: any = await sourceClient.request(PRODUCTS_QUERY, {
      first: 50,
      after: cursor,
    });

    const products = result.products.edges.map((e: any) => e.node);
    allProducts = allProducts.concat(products);
    hasNextPage = result.products.pageInfo.hasNextPage;
    cursor = result.products.pageInfo.endCursor;
  }

  console.log(`   Trovati ${allProducts.length} prodotti\n`);

  let created = 0;
  let failed = 0;

  for (const product of allProducts) {
    try {
      console.log(`\n[${created + failed + 1}/${allProducts.length}] ${product.title}`);

      // 1. Crea prodotto base
      const productInput: any = {
        title: product.title,
        descriptionHtml: product.descriptionHtml || '',
        vendor: product.vendor || '',
        productType: product.productType || '',
        tags: product.tags || [],
        status: product.status,
        templateSuffix: product.templateSuffix || null,
      };

      const createResult: any = await targetClient.request(PRODUCT_CREATE_MUTATION, {
        input: productInput,
      });

      if (createResult.productCreate.userErrors.length > 0) {
        console.log(`   ✗ Errore creazione: ${createResult.productCreate.userErrors[0].message}`);
        failed++;
        continue;
      }

      const newProduct = createResult.productCreate.product;
      const defaultVariantId = newProduct.variants.edges[0]?.node?.id;
      console.log(`   ✓ Prodotto creato`);

      // 2. Aggiungi opzioni se il prodotto ha varianti multiple
      const sourceVariants = product.variants.edges.map((e: any) => e.node);
      const hasMultipleVariants = product.options &&
        product.options.length > 0 &&
        product.options[0].name !== 'Title' &&
        sourceVariants.length > 1;

      let targetVariants: any[] = [];

      if (hasMultipleVariants) {
        // Crea opzioni con i loro valori
        const optionsInput = product.options.map((opt: any) => ({
          name: opt.name,
          values: opt.values.map((v: string) => ({ name: v })),
        }));

        try {
          const optionsResult: any = await targetClient.request(PRODUCT_OPTIONS_CREATE, {
            productId: newProduct.id,
            options: optionsInput,
          });

          if (optionsResult.productOptionsCreate.userErrors.length > 0) {
            console.log(`   ! Errore opzioni: ${optionsResult.productOptionsCreate.userErrors[0].message}`);
          } else {
            targetVariants = optionsResult.productOptionsCreate.product.variants.edges.map((e: any) => e.node);
            console.log(`   ✓ ${product.options.length} opzioni create, ${targetVariants.length} varianti generate`);
          }
        } catch (e: any) {
          console.log(`   ! Errore opzioni: ${e.message?.substring(0, 100)}`);
        }

        await delay(300);
      }

      // 3. Aggiorna prezzi e SKU delle varianti
      if (sourceVariants.length > 0) {
        const variantUpdates: any[] = [];

        if (targetVariants.length > 0) {
          // Abbina varianti per selectedOptions
          for (const targetVar of targetVariants) {
            const targetOptions = targetVar.selectedOptions || [];

            // Trova la variante sorgente corrispondente
            const sourceVar = sourceVariants.find((sv: any) => {
              const sourceOptions = sv.selectedOptions || [];
              return targetOptions.every((to: any) =>
                sourceOptions.some((so: any) =>
                  so.name === to.name && so.value === to.value
                )
              );
            });

            if (sourceVar) {
              variantUpdates.push({
                id: targetVar.id,
                price: sourceVar.price,
                compareAtPrice: sourceVar.compareAtPrice,
                sku: sourceVar.sku,
                barcode: sourceVar.barcode,
              });
            }
          }
        } else if (defaultVariantId) {
          // Prodotto senza varianti multiple
          const sourceVar = sourceVariants[0];
          variantUpdates.push({
            id: defaultVariantId,
            price: sourceVar.price,
            compareAtPrice: sourceVar.compareAtPrice,
            sku: sourceVar.sku,
            barcode: sourceVar.barcode,
          });
        }

        if (variantUpdates.length > 0) {
          try {
            await targetClient.request(PRODUCT_VARIANTS_BULK_UPDATE, {
              productId: newProduct.id,
              variants: variantUpdates,
            });
            console.log(`   ✓ ${variantUpdates.length} varianti aggiornate con prezzi/SKU`);
          } catch (e: any) {
            console.log(`   ! Errore aggiornamento varianti: ${e.message?.substring(0, 100)}`);
          }
        }
      }

      // 4. Aggiungi immagini
      const images = product.images.edges.map((e: any) => e.node);
      if (images.length > 0) {
        const mediaInputs = images.map((img: any) => ({
          originalSource: img.url,
          alt: img.altText || '',
          mediaContentType: 'IMAGE',
        }));

        try {
          await targetClient.request(PRODUCT_CREATE_MEDIA, {
            productId: newProduct.id,
            media: mediaInputs,
          });
          console.log(`   ✓ ${images.length} immagini aggiunte`);
        } catch (e: any) {
          console.log(`   ! Errore immagini: ${e.message?.substring(0, 100)}`);
        }

        await delay(300);
      }

      // 5. Imposta metafields
      const metafields = product.metafields.edges.map((e: any) => e.node);
      const customMetafields = metafields.filter((mf: any) =>
        mf.namespace !== 'shopify' && mf.namespace !== 'reviews'
      );

      if (customMetafields.length > 0) {
        const metafieldInputs = customMetafields.map((mf: any) => ({
          ownerId: newProduct.id,
          namespace: mf.namespace,
          key: mf.key,
          value: mf.value,
          type: mf.type,
        }));

        try {
          await targetClient.request(METAFIELDS_SET, { metafields: metafieldInputs });
          console.log(`   ✓ ${customMetafields.length} metafield impostati`);
        } catch (e: any) {
          console.log(`   ! Errore metafields: ${e.message?.substring(0, 100)}`);
        }
      }

      // 6. Pubblica su tutti i canali
      for (const pub of publications) {
        try {
          await targetClient.request(PUBLISH_PRODUCT_MUTATION, {
            id: newProduct.id,
            input: [{ publicationId: pub.node.id }],
          });
        } catch (e) {
          // Ignora errori pubblicazione
        }
      }
      console.log(`   ✓ Pubblicato`);

      created++;
      await delay(500);

    } catch (error: any) {
      console.log(`   ✗ Errore: ${error.message?.substring(0, 150)}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`COMPLETATO: ${created} prodotti creati, ${failed} falliti`);
  console.log('='.repeat(60));

  await prisma.$disconnect();
}

copyProducts().catch(console.error);
