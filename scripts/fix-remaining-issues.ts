/**
 * Corregge i problemi rimanenti:
 * 1. Thick Snow Boots Warm - mapping immagini
 * 2. Harmony Knit 3-Piece Lounge Set - mapping immagini + varianti Ivory/Gray
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

const SOURCE_SHOP = 'usa-shop-8790.myshopify.com';
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com';

const PRODUCTS_QUERY = `
  query getProducts($first: Int!, $query: String) {
    products(first: $first, query: $query) {
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
                        image { url }
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
                  image { url }
                }
              }
            }
          }
        }
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

// Estrae il nome base del file (senza UUID)
function getBaseFilename(url: string): string {
  try {
    const parts = url.split('/');
    let filename = parts[parts.length - 1].split('?')[0];
    // Rimuovi UUID (pattern: _xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    filename = filename.replace(/_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '');
    // Rimuovi dimensioni
    filename = filename.replace(/_\d+x\d*/, '').replace(/_\d*x\d+/, '');
    return filename;
  } catch {
    return url;
  }
}

function getVariantKey(v: any): string {
  const opts = v.selectedOptions || [];
  return opts.map((o: any) => `${o.name}:${o.value}`).sort().join('|');
}

async function main() {
  console.log('='.repeat(80));
  console.log('CORREZIONE PROBLEMI RIMANENTI');
  console.log('='.repeat(80));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  const productsToFix = [
    'Thick Snow Boots Warm',
    'Harmony Knit 3-Piece Lounge Set'
  ];

  for (const productTitle of productsToFix) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`PRODOTTO: ${productTitle}`);
    console.log('─'.repeat(80));

    // Ottieni prodotto da entrambi gli shop
    const sourceRes: any = await sourceClient.request(PRODUCTS_QUERY, {
      first: 1,
      query: `title:*${productTitle}*`
    });
    const targetRes: any = await targetClient.request(PRODUCTS_QUERY, {
      first: 1,
      query: `title:*${productTitle}*`
    });

    const sp = sourceRes.products.edges[0]?.node;
    const tp = targetRes.products.edges[0]?.node;

    if (!sp || !tp) {
      console.log('   Prodotto non trovato');
      continue;
    }

    // Ottieni media
    const sourceMedia = sp.media.edges.map((e: any) => e.node).filter((m: any) => m.id && m.image?.url);
    const targetMedia = tp.media.edges.map((e: any) => e.node).filter((m: any) => m.id && m.image?.url);

    console.log(`\n   Immagini Italivio: ${sourceMedia.length}`);
    console.log(`   Immagini Moretti:  ${targetMedia.length}`);

    // Crea mapping basato su nome base file
    const imageMapping: Map<string, string> = new Map();

    console.log('\n   MAPPING IMMAGINI:');
    for (const sm of sourceMedia) {
      const sourceBase = getBaseFilename(sm.image.url);

      // Cerca corrispondenza su target
      let matched = false;
      for (const tm of targetMedia) {
        const targetBase = getBaseFilename(tm.image.url);
        if (sourceBase === targetBase && !imageMapping.has(sm.id)) {
          imageMapping.set(sm.id, tm.id);
          console.log(`   ✓ "${sourceBase}" -> mapped`);
          matched = true;
          break;
        }
      }

      if (!matched) {
        console.log(`   ? "${sourceBase}" -> NON TROVATA`);
      }
    }

    // Se non tutti mappati, prova per posizione
    if (imageMapping.size < sourceMedia.length && sourceMedia.length === targetMedia.length) {
      console.log('\n   Fallback: mapping per posizione...');
      imageMapping.clear();
      for (let i = 0; i < sourceMedia.length; i++) {
        imageMapping.set(sourceMedia[i].id, targetMedia[i].id);
        console.log(`   ✓ pos ${i + 1}: ${sourceMedia[i].id.substring(0, 30)}... -> ${targetMedia[i].id.substring(0, 30)}...`);
      }
    }

    console.log(`\n   Totale mappate: ${imageMapping.size}/${sourceMedia.length}`);

    // Ottieni varianti
    const sourceVariants = sp.variants.edges.map((e: any) => e.node);
    const targetVariants = tp.variants.edges.map((e: any) => e.node);

    // Step 1: Rimuovi TUTTE le associazioni esistenti
    console.log('\n   Rimozione associazioni esistenti...');
    const detachInputs: any[] = [];
    for (const tv of targetVariants) {
      const existingMedia = tv.media?.edges?.map((e: any) => e.node?.id).filter(Boolean) || [];
      if (existingMedia.length > 0) {
        detachInputs.push({ variantId: tv.id, mediaIds: existingMedia });
      }
    }

    if (detachInputs.length > 0) {
      try {
        await targetClient.request(DETACH_MEDIA, {
          productId: tp.id,
          variantMedia: detachInputs,
        });
        console.log(`   ✓ Rimosse associazioni da ${detachInputs.length} varianti`);
      } catch (e: any) {
        console.log(`   ! Errore detach: ${e.message?.substring(0, 60)}`);
      }
      await delay(500);
    }

    // Step 2: Ricrea le associazioni esattamente come su Italivio
    console.log('\n   Creazione nuove associazioni...');
    let attached = 0;

    for (const sv of sourceVariants) {
      const key = getVariantKey(sv);
      const tv = targetVariants.find((t: any) => getVariantKey(t) === key);

      if (!tv) continue;

      const svMedia = sv.media?.edges?.map((e: any) => e.node?.id).filter(Boolean) || [];

      if (svMedia.length > 0) {
        const targetMediaIds: string[] = [];
        for (const smId of svMedia) {
          const tmId = imageMapping.get(smId);
          if (tmId) targetMediaIds.push(tmId);
        }

        if (targetMediaIds.length > 0) {
          const colorOpt = sv.selectedOptions?.find((o: any) => o.name === 'Color')?.value || sv.title;

          try {
            await targetClient.request(APPEND_MEDIA, {
              productId: tp.id,
              variantMedia: [{
                variantId: tv.id,
                mediaIds: targetMediaIds,
              }],
            });
            console.log(`   ✓ ${colorOpt}: ${targetMediaIds.length} img`);
            attached++;
          } catch (e: any) {
            console.log(`   ! ${colorOpt}: ${e.message?.substring(0, 50)}`);
          }
          await delay(200);
        }
      }
    }

    console.log(`\n   Varianti associate: ${attached}`);
    await delay(500);
  }

  console.log('\n' + '='.repeat(80));
  console.log('COMPLETATO');
  console.log('='.repeat(80));

  await prisma.$disconnect();
}

main().catch(console.error);
