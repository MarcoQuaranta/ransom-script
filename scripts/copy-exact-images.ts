/**
 * Copia ESATTA delle immagini da Italivio a Moretti Dallas
 * 1. Scarica tutte le immagini (prodotto + files)
 * 2. Le carica su Moretti Dallas
 * 3. Mappa esattamente varianti e metafield
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

const SOURCE_SHOP = 'usa-shop-8790.myshopify.com';
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com';

// Query per ottenere TUTTO da source
const SOURCE_PRODUCT_QUERY = `
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
                price
                compareAtPrice
                selectedOptions {
                  name
                  value
                }
                media(first: 10) {
                  edges {
                    node {
                      ... on MediaImage {
                        id
                        image {
                          url
                        }
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

// Query per file (immagini caricate separatamente)
const FILES_QUERY = `
  query getFiles($first: Int!, $after: String) {
    files(first: $first, after: $after) {
      edges {
        node {
          ... on MediaImage {
            id
            image {
              url
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
const TARGET_PRODUCT_QUERY = `
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
                selectedOptions {
                  name
                  value
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

// Staged upload per caricare file
const STAGED_UPLOAD_CREATE = `
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Crea file
const FILE_CREATE = `
  mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        ... on MediaImage {
          id
          image {
            url
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

// Associa media a variante
const VARIANT_APPEND_MEDIA = `
  mutation productVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
    productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
      productVariants { id }
      userErrors { field message }
    }
  }
`;

// Set metafields
const SET_METAFIELDS = `
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key }
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

async function getAllProducts(client: GraphQLClient, query: string): Promise<any[]> {
  let products: any[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const result: any = await client.request(query, { first: 50, after: cursor });
    products = products.concat(result.products.edges.map((e: any) => e.node));
    hasNextPage = result.products.pageInfo.hasNextPage;
    cursor = result.products.pageInfo.endCursor;
  }

  return products;
}

// Carica immagine su Shopify tramite URL
async function uploadImageToShopify(
  client: GraphQLClient,
  imageUrl: string,
  filename: string
): Promise<string | null> {
  try {
    // Crea file direttamente da URL
    const result: any = await client.request(FILE_CREATE, {
      files: [{
        originalSource: imageUrl,
        contentType: 'IMAGE',
      }],
    });

    if (result.fileCreate.userErrors?.length > 0) {
      console.log(`      ! Upload error: ${result.fileCreate.userErrors[0].message}`);
      return null;
    }

    const file = result.fileCreate.files?.[0];
    return file?.id || null;
  } catch (e: any) {
    console.log(`      ! Upload error: ${e.message?.substring(0, 50)}`);
    return null;
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('COPIA ESATTA IMMAGINI DA ITALIVIO A MORETTI DALLAS');
  console.log('='.repeat(80));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  // 1. Carica prodotti
  console.log('\n[1] Caricamento prodotti...');
  const sourceProducts = await getAllProducts(sourceClient, SOURCE_PRODUCT_QUERY);
  const targetProducts = await getAllProducts(targetClient, TARGET_PRODUCT_QUERY);
  console.log(`   Sorgente: ${sourceProducts.length}, Target: ${targetProducts.length}`);

  // 2. Per ogni prodotto, copia immagini e associa
  console.log('\n[2] Elaborazione prodotti...\n');

  for (const sourceProduct of sourceProducts) {
    const targetProduct = targetProducts.find(tp => tp.title === sourceProduct.title);
    if (!targetProduct) continue;

    console.log(`\n${'='.repeat(70)}`);
    console.log(`PRODOTTO: ${sourceProduct.title}`);
    console.log('='.repeat(70));

    // Raccogli tutte le immagini necessarie (prodotto + metafield refs)
    const sourceMedia = sourceProduct.media.edges
      .map((e: any) => e.node)
      .filter((m: any) => m.id && m.image?.url);

    const sourceMetafields = sourceProduct.metafields.edges
      .map((e: any) => e.node)
      .filter((m: any) => m.namespace === 'custom');

    // Estrai ID immagini dai metafield
    const metafieldImageIds: Set<string> = new Set();
    for (const mf of sourceMetafields) {
      if (mf.value?.includes('gid://shopify/MediaImage/')) {
        const matches = mf.value.match(/gid:\/\/shopify\/MediaImage\/\d+/g) || [];
        matches.forEach((id: string) => metafieldImageIds.add(id));
      }
    }

    console.log(`\n[A] Immagini prodotto: ${sourceMedia.length}`);
    console.log(`[B] Immagini metafield: ${metafieldImageIds.size}`);

    // Mappa immagini esistenti target per URL
    const targetMedia = targetProduct.media.edges
      .map((e: any) => e.node)
      .filter((m: any) => m.id && m.image?.url);

    // Crea mapping source URL -> target ID
    const urlToTargetId: Map<string, string> = new Map();
    for (const tm of targetMedia) {
      // Estrai filename dall'URL per matching
      const url = tm.image.url;
      urlToTargetId.set(url, tm.id);
    }

    // Mapping source ID -> target ID
    const imageMapping: Map<string, string> = new Map();

    // Mappa immagini prodotto per posizione (stesse immagini, stesso ordine)
    console.log(`\n[C] Mapping immagini prodotto...`);
    for (let i = 0; i < sourceMedia.length && i < targetMedia.length; i++) {
      imageMapping.set(sourceMedia[i].id, targetMedia[i].id);
      console.log(`   ${i + 1}. ${sourceMedia[i].id} -> ${targetMedia[i].id}`);
    }

    // Per le immagini dei metafield che non sono nel prodotto, dobbiamo caricarle
    console.log(`\n[D] Caricamento immagini metafield mancanti...`);

    const missingImageIds = Array.from(metafieldImageIds).filter(id => !imageMapping.has(id));

    if (missingImageIds.length > 0) {
      // Ottieni URL delle immagini mancanti dalla Files API
      let allFiles: any[] = [];
      let hasNextPage = true;
      let cursor: string | null = null;

      while (hasNextPage) {
        try {
          const filesResult: any = await sourceClient.request(FILES_QUERY, { first: 50, after: cursor });
          const files = filesResult.files.edges.map((e: any) => e.node).filter((f: any) => f.id);
          allFiles = allFiles.concat(files);
          hasNextPage = filesResult.files.pageInfo.hasNextPage;
          cursor = filesResult.files.pageInfo.endCursor;
        } catch (e) {
          break;
        }
      }

      console.log(`   Files trovati su Italivio: ${allFiles.length}`);

      // Trova e carica le immagini mancanti
      for (const missingId of missingImageIds) {
        const sourceFile = allFiles.find(f => f.id === missingId);
        if (sourceFile?.image?.url) {
          console.log(`   Caricamento: ${missingId.substring(0, 40)}...`);

          const newId = await uploadImageToShopify(targetClient, sourceFile.image.url, 'metafield-image');

          if (newId) {
            imageMapping.set(missingId, newId);
            console.log(`      ✓ Nuovo ID: ${newId.substring(0, 40)}...`);
          }

          await delay(500);
        } else {
          console.log(`   ! Immagine non trovata: ${missingId}`);
        }
      }
    } else {
      console.log(`   Nessuna immagine mancante`);
    }

    // [E] Aggiorna metafield con i nuovi ID
    console.log(`\n[E] Aggiornamento metafield...`);

    const metafieldsToUpdate: any[] = [];

    for (const mf of sourceMetafields) {
      let value = mf.value;
      let updated = false;

      // Sostituisci tutti i riferimenti immagine
      if (value?.includes('gid://shopify/MediaImage/')) {
        const regex = /gid:\/\/shopify\/MediaImage\/\d+/g;
        const matches = value.match(regex) || [];

        for (const match of matches) {
          const newId = imageMapping.get(match);
          if (newId) {
            value = value.replace(match, newId);
            updated = true;
          }
        }
      }

      metafieldsToUpdate.push({
        ownerId: targetProduct.id,
        namespace: mf.namespace,
        key: mf.key,
        value: updated ? value : mf.value,
        type: mf.type,
      });
    }

    if (metafieldsToUpdate.length > 0) {
      try {
        const result: any = await targetClient.request(SET_METAFIELDS, {
          metafields: metafieldsToUpdate,
        });

        if (result.metafieldsSet.userErrors?.length > 0) {
          console.log(`   ! ${result.metafieldsSet.userErrors[0].message}`);
        } else {
          console.log(`   ✓ ${metafieldsToUpdate.length} metafield aggiornati`);
        }
      } catch (e: any) {
        console.log(`   ! Errore: ${e.message?.substring(0, 60)}`);
      }
    }

    // [F] Associa immagini alle varianti (ESATTAMENTE come su Italivio)
    console.log(`\n[F] Associazione immagini alle varianti...`);

    const sourceVariants = sourceProduct.variants.edges.map((e: any) => e.node);
    const targetVariants = targetProduct.variants.edges.map((e: any) => e.node);

    const variantMediaInputs: any[] = [];

    for (const sv of sourceVariants) {
      // Trova variante target corrispondente
      const tv = targetVariants.find((t: any) => {
        const sOpts = sv.selectedOptions || [];
        const tOpts = t.selectedOptions || [];
        return sOpts.every((so: any) =>
          tOpts.some((to: any) => to.name === so.name && to.value === so.value)
        );
      });

      if (!tv) continue;

      // Ottieni immagini associate alla variante source
      const svMedia = sv.media?.edges?.map((e: any) => e.node).filter((m: any) => m.id) || [];

      if (svMedia.length > 0) {
        const targetMediaIds: string[] = [];

        for (const sm of svMedia) {
          const targetId = imageMapping.get(sm.id);
          if (targetId) {
            targetMediaIds.push(targetId);
          }
        }

        if (targetMediaIds.length > 0) {
          variantMediaInputs.push({
            variantId: tv.id,
            mediaIds: targetMediaIds,
          });
        }
      }
    }

    if (variantMediaInputs.length > 0) {
      try {
        // Shopify accetta solo 1 mediaId per variante per chiamata
        for (const input of variantMediaInputs) {
          for (const mediaId of input.mediaIds) {
            await targetClient.request(VARIANT_APPEND_MEDIA, {
              productId: targetProduct.id,
              variantMedia: [{
                variantId: input.variantId,
                mediaIds: [mediaId],
              }],
            });
          }
        }
        console.log(`   ✓ ${variantMediaInputs.length} varianti aggiornate`);
      } catch (e: any) {
        console.log(`   ! Errore: ${e.message?.substring(0, 60)}`);
      }
    } else {
      console.log(`   Nessuna variante da aggiornare`);
    }

    await delay(500);
  }

  console.log('\n' + '='.repeat(80));
  console.log('COMPLETATO');
  console.log('='.repeat(80));

  await prisma.$disconnect();
}

main().catch(console.error);
