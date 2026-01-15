/**
 * Script per copiare metafield definitions e prodotti da Italivio al nuovo shop
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

const SOURCE_SHOP = 'usa-shop-8790.myshopify.com'; // Italivio
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com'; // Moretti Dallas

// Queries
const METAFIELD_DEFINITIONS_QUERY = `
  query metafieldDefinitions($ownerType: MetafieldOwnerType!) {
    metafieldDefinitions(ownerType: $ownerType, first: 100) {
      edges {
        node {
          id
          namespace
          key
          name
          description
          type {
            name
          }
          validations {
            name
            value
          }
          pinnedPosition
        }
      }
    }
  }
`;

const METAFIELD_DEFINITION_CREATE = `
  mutation metafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        namespace
        key
        name
      }
      userErrors {
        field
        message
      }
    }
  }
`;

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

const PRODUCT_CREATE_MUTATION = `
  mutation productCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        title
        handle
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
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_VARIANTS_BULK_UPDATE = `
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
        compareAtPrice
        sku
      }
      userErrors {
        field
        message
      }
    }
  }
`;

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
      publishable {
        availablePublicationsCount {
          count
        }
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

async function copyMetafieldDefinitions() {
  console.log('\n' + '='.repeat(60));
  console.log('COPIA METAFIELD DEFINITIONS');
  console.log('='.repeat(60));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  // Get definitions from source
  console.log(`\n[1] Lettura metafield definitions da ${SOURCE_SHOP}...`);
  const sourceResult: any = await sourceClient.request(METAFIELD_DEFINITIONS_QUERY, {
    ownerType: 'PRODUCT',
  });

  const definitions = sourceResult.metafieldDefinitions.edges;
  console.log(`   Trovate ${definitions.length} definizioni`);

  if (definitions.length === 0) {
    console.log('   Nessuna definizione da copiare');
    return;
  }

  // Create definitions on target
  console.log(`\n[2] Creazione metafield definitions su ${TARGET_SHOP}...`);

  let created = 0;
  let skipped = 0;

  for (const edge of definitions) {
    const def = edge.node;

    // Skip shopify namespace (system metafields)
    if (def.namespace === 'shopify') {
      console.log(`   - ${def.namespace}.${def.key}: skipped (system)`);
      skipped++;
      continue;
    }

    try {
      const input: any = {
        namespace: def.namespace,
        key: def.key,
        name: def.name,
        type: def.type.name,
        ownerType: 'PRODUCT',
      };

      if (def.description) {
        input.description = def.description;
      }

      // Add validations if present
      if (def.validations && def.validations.length > 0) {
        input.validations = def.validations.map((v: any) => ({
          name: v.name,
          value: v.value,
        }));
      }

      const result: any = await targetClient.request(METAFIELD_DEFINITION_CREATE, {
        definition: input,
      });

      if (result.metafieldDefinitionCreate.userErrors.length > 0) {
        const error = result.metafieldDefinitionCreate.userErrors[0];
        if (error.message.includes('already exists') || error.message.includes('taken')) {
          console.log(`   - ${def.namespace}.${def.key}: già esistente`);
          skipped++;
        } else {
          console.log(`   - ${def.namespace}.${def.key}: ERRORE - ${error.message}`);
        }
      } else {
        console.log(`   - ${def.namespace}.${def.key}: ✓ creato`);
        created++;
      }
    } catch (error: any) {
      console.log(`   - ${def.namespace}.${def.key}: ERRORE - ${error.message}`);
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n   Risultato: ${created} creati, ${skipped} già esistenti/skipped`);
}

async function copyProducts() {
  console.log('\n' + '='.repeat(60));
  console.log('COPIA PRODOTTI');
  console.log('='.repeat(60));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  // Get publications for target shop
  console.log('\n[0] Recupero canali di pubblicazione...');
  const pubResult: any = await targetClient.request(GET_PUBLICATIONS_QUERY);
  const publications = pubResult.publications?.edges || [];
  console.log(`   Trovati ${publications.length} canali`);

  // Get all products from source
  console.log(`\n[1] Lettura prodotti da ${SOURCE_SHOP}...`);

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

  console.log(`   Trovati ${allProducts.length} prodotti`);

  // Copy each product
  console.log(`\n[2] Creazione prodotti su ${TARGET_SHOP}...`);

  let created = 0;
  let failed = 0;

  for (const product of allProducts) {
    try {
      console.log(`\n   Prodotto: ${product.title}`);

      // Prepare product input
      const productInput: any = {
        title: product.title,
        descriptionHtml: product.descriptionHtml || '',
        vendor: product.vendor || '',
        productType: product.productType || '',
        tags: product.tags || [],
        status: product.status,
        templateSuffix: product.templateSuffix || null,
      };

      // Add options if product has variants with options
      if (product.options && product.options.length > 0 && product.options[0].name !== 'Title') {
        productInput.options = product.options.map((opt: any) => opt.name);
      }

      // Create product
      const createResult: any = await targetClient.request(PRODUCT_CREATE_MUTATION, {
        input: productInput,
      });

      if (createResult.productCreate.userErrors.length > 0) {
        console.log(`     ✗ Errore: ${createResult.productCreate.userErrors[0].message}`);
        failed++;
        continue;
      }

      const newProduct = createResult.productCreate.product;
      console.log(`     ✓ Prodotto creato: ${newProduct.handle}`);

      // Update variants with prices and SKUs
      const sourceVariants = product.variants.edges.map((e: any) => e.node);
      const targetVariants = newProduct.variants.edges.map((e: any) => e.node);

      if (sourceVariants.length > 0 && targetVariants.length > 0) {
        // Match variants by selectedOptions or position
        const variantUpdates: any[] = [];

        for (let i = 0; i < targetVariants.length && i < sourceVariants.length; i++) {
          const sourceVar = sourceVariants[i];
          const targetVar = targetVariants[i];

          variantUpdates.push({
            id: targetVar.id,
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
            console.log(`     ✓ ${variantUpdates.length} varianti aggiornate`);
          } catch (e: any) {
            console.log(`     ! Errore varianti: ${e.message}`);
          }
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
          await targetClient.request(PRODUCT_CREATE_MEDIA, {
            productId: newProduct.id,
            media: mediaInputs,
          });
          console.log(`     ✓ ${images.length} immagini aggiunte`);
        } catch (e: any) {
          console.log(`     ! Errore immagini: ${e.message}`);
        }
      }

      // Set metafields
      const metafields = product.metafields.edges.map((e: any) => e.node);
      if (metafields.length > 0) {
        const metafieldInputs = metafields
          .filter((mf: any) => mf.namespace !== 'shopify') // Skip system metafields
          .map((mf: any) => ({
            ownerId: newProduct.id,
            namespace: mf.namespace,
            key: mf.key,
            value: mf.value,
            type: mf.type,
          }));

        if (metafieldInputs.length > 0) {
          try {
            await targetClient.request(METAFIELDS_SET, {
              metafields: metafieldInputs,
            });
            console.log(`     ✓ ${metafieldInputs.length} metafield impostati`);
          } catch (e: any) {
            console.log(`     ! Errore metafields: ${e.message}`);
          }
        }
      }

      // Publish to all channels
      for (const pub of publications) {
        try {
          await targetClient.request(PUBLISH_PRODUCT_MUTATION, {
            id: newProduct.id,
            input: [{ publicationId: pub.node.id }],
          });
        } catch (e) {
          // Ignore publish errors
        }
      }
      console.log(`     ✓ Pubblicato su ${publications.length} canali`);

      created++;

      // Delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));

    } catch (error: any) {
      console.log(`     ✗ Errore: ${error.message}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`COMPLETATO: ${created} prodotti creati, ${failed} falliti`);
  console.log('='.repeat(60));
}

async function main() {
  console.log('='.repeat(60));
  console.log('COPIA DATI DA ITALIVIO A MORETTI DALLAS');
  console.log('='.repeat(60));
  console.log(`\nSorgente: ${SOURCE_SHOP} (Italivio)`);
  console.log(`Destinazione: ${TARGET_SHOP} (Moretti Dallas)`);

  // Metafield definitions già copiati, ora solo prodotti
  // await copyMetafieldDefinitions();
  await copyProducts();

  await prisma.$disconnect();
}

main().catch(console.error);
