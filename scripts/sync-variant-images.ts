/**
 * Sincronizza ESATTAMENTE le immagini delle varianti da Italivio a Moretti Dallas
 * 1. Ottiene le associazioni variante-immagine da Italivio
 * 2. Rimuove tutte le associazioni su Moretti Dallas
 * 3. Ricrea le stesse associazioni
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
                title
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

const DETACH_MEDIA = `
  mutation productVariantDetachMedia($productId: ID!, $variantMedia: [ProductVariantDetachMediaInput!]!) {
    productVariantDetachMedia(productId: $productId, variantMedia: $variantMedia) {
      productVariants { id }
      userErrors { field message }
    }
  }
`;

const APPEND_MEDIA = `
  mutation productVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
    productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
      productVariants { id }
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

// Estrai filename dall'URL Shopify per matching
function extractFilename(url: string): string {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    // Rimuovi parametri di query e versione
    const filename = path.split('/').pop()?.split('?')[0] || '';
    // Rimuovi suffissi come _small, _medium, dimensioni
    return filename.replace(/_\d+x\d+/, '').replace(/_small|_medium|_large|_grande/, '');
  } catch {
    return url;
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('SINCRONIZZAZIONE IMMAGINI VARIANTI DA ITALIVIO A MORETTI DALLAS');
  console.log('='.repeat(80));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  console.log('\n[1] Caricamento prodotti...');
  const sourceProducts = await getAllProducts(sourceClient);
  const targetProducts = await getAllProducts(targetClient);
  console.log(`   Sorgente: ${sourceProducts.length}, Target: ${targetProducts.length}`);

  let totalDetached = 0;
  let totalAttached = 0;

  for (const sourceProduct of sourceProducts) {
    const targetProduct = targetProducts.find(tp => tp.title === sourceProduct.title);
    if (!targetProduct) continue;

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`PRODOTTO: ${sourceProduct.title}`);
    console.log('─'.repeat(70));

    // Ottieni media del prodotto (immagini disponibili)
    const sourceMedia = sourceProduct.media.edges
      .map((e: any) => e.node)
      .filter((m: any) => m.id && m.image?.url);

    const targetMedia = targetProduct.media.edges
      .map((e: any) => e.node)
      .filter((m: any) => m.id && m.image?.url);

    // Crea mapping source -> target per filename
    const imageMapping: Map<string, string> = new Map();

    for (const sm of sourceMedia) {
      const sourceFilename = extractFilename(sm.image.url);

      // Cerca immagine corrispondente su target
      for (const tm of targetMedia) {
        const targetFilename = extractFilename(tm.image.url);
        if (sourceFilename === targetFilename) {
          imageMapping.set(sm.id, tm.id);
          break;
        }
      }
    }

    // Fallback: se non troviamo per filename, mappiamo per posizione
    if (imageMapping.size === 0 && sourceMedia.length > 0 && targetMedia.length > 0) {
      console.log('   (Mapping per posizione)');
      for (let i = 0; i < sourceMedia.length && i < targetMedia.length; i++) {
        imageMapping.set(sourceMedia[i].id, targetMedia[i].id);
      }
    }

    console.log(`   Immagini mappate: ${imageMapping.size}`);

    // Ottieni varianti
    const sourceVariants = sourceProduct.variants.edges.map((e: any) => e.node);
    const targetVariants = targetProduct.variants.edges.map((e: any) => e.node);

    // Step 1: Rimuovi TUTTE le associazioni esistenti su target
    const detachInputs: any[] = [];

    for (const tv of targetVariants) {
      const existingMedia = tv.media?.edges?.map((e: any) => e.node?.id).filter(Boolean) || [];
      if (existingMedia.length > 0) {
        detachInputs.push({
          variantId: tv.id,
          mediaIds: existingMedia,
        });
      }
    }

    if (detachInputs.length > 0) {
      try {
        await targetClient.request(DETACH_MEDIA, {
          productId: targetProduct.id,
          variantMedia: detachInputs,
        });
        console.log(`   ✓ Rimosse associazioni da ${detachInputs.length} varianti`);
        totalDetached += detachInputs.length;
      } catch (e: any) {
        console.log(`   ! Errore detach: ${e.message?.substring(0, 50)}`);
      }
      await delay(300);
    }

    // Step 2: Ricrea le associazioni esattamente come su Italivio
    const attachInputs: any[] = [];

    for (const sv of sourceVariants) {
      // Trova variante target corrispondente per opzioni
      const tv = targetVariants.find((t: any) => {
        const sOpts = sv.selectedOptions || [];
        const tOpts = t.selectedOptions || [];
        return sOpts.every((so: any) =>
          tOpts.some((to: any) => to.name === so.name && to.value === so.value)
        );
      });

      if (!tv) continue;

      // Ottieni immagini associate alla variante source
      const svMediaIds = sv.media?.edges
        ?.map((e: any) => e.node?.id)
        .filter(Boolean) || [];

      if (svMediaIds.length > 0) {
        const targetMediaIds: string[] = [];

        for (const smId of svMediaIds) {
          const tmId = imageMapping.get(smId);
          if (tmId) {
            targetMediaIds.push(tmId);
          }
        }

        if (targetMediaIds.length > 0) {
          const colorOpt = sv.selectedOptions?.find((o: any) => o.name === 'Color');
          console.log(`   → Variante ${colorOpt?.value || sv.title}: ${targetMediaIds.length} img`);

          attachInputs.push({
            variantId: tv.id,
            mediaIds: targetMediaIds,
          });
        }
      }
    }

    // Esegui attach
    if (attachInputs.length > 0) {
      try {
        // Shopify richiede una chiamata per variante
        for (const input of attachInputs) {
          await targetClient.request(APPEND_MEDIA, {
            productId: targetProduct.id,
            variantMedia: [{
              variantId: input.variantId,
              mediaIds: input.mediaIds,
            }],
          });
          await delay(200);
        }
        console.log(`   ✓ Associate immagini a ${attachInputs.length} varianti`);
        totalAttached += attachInputs.length;
      } catch (e: any) {
        console.log(`   ! Errore attach: ${e.message?.substring(0, 50)}`);
      }
    } else {
      // Verifica se anche su Italivio non ci sono associazioni
      const sourceVariantsWithMedia = sourceVariants.filter(
        (v: any) => v.media?.edges?.length > 0
      ).length;

      if (sourceVariantsWithMedia === 0) {
        console.log('   (Nessuna variante ha immagini su Italivio)');
      } else {
        console.log(`   ! Su Italivio ci sono ${sourceVariantsWithMedia} varianti con immagini`);
      }
    }

    await delay(300);
  }

  console.log('\n' + '='.repeat(80));
  console.log('COMPLETATO');
  console.log(`   Varianti pulite: ${totalDetached}`);
  console.log(`   Varianti associate: ${totalAttached}`);
  console.log('='.repeat(80));

  await prisma.$disconnect();
}

main().catch(console.error);
