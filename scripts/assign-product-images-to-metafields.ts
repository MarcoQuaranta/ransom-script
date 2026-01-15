/**
 * Assegna le immagini del prodotto ai metafield che richiedono immagini
 * Usa le immagini del prodotto in ordine posizionale
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

const SET_METAFIELDS = `
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key }
      userErrors { field message }
    }
  }
`;

// Mapping: metafield key -> which image index to use
const IMAGE_METAFIELD_MAPPING: { [key: string]: number } = {
  'angle_1_image': 0,  // First image
  'angle_2_image': 1,  // Second image
  'angle_3_image': 2,  // Third image
  'lifestyle_image': 3, // Fourth image
};

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

async function main() {
  console.log('='.repeat(70));
  console.log('ASSEGNAZIONE IMMAGINI PRODOTTO AI METAFIELD');
  console.log('='.repeat(70));

  const client = await getClient(TARGET_SHOP);

  console.log('\n[1] Caricamento prodotti target...');
  const products = await getAllProducts(client);
  console.log(`   ${products.length} prodotti`);

  console.log('\n[2] Assegnazione immagini...\n');

  let totalSet = 0;

  for (const product of products) {
    // Skip products without ITALIVIO (original products)
    if (!product.title.includes('ITALIVIO') && product.title !== 'Savage Tiger Cap') {
      continue;
    }

    const media = product.media.edges
      .map((e: any) => e.node)
      .filter((m: any) => m.id);

    if (media.length < 4) {
      // Not enough images
      continue;
    }

    // Check if image metafields already exist
    const existingMeta = product.metafields.edges.map((e: any) => e.node);
    const hasImageMeta = existingMeta.some((m: any) =>
      Object.keys(IMAGE_METAFIELD_MAPPING).includes(m.key) && m.value
    );

    if (hasImageMeta) {
      continue;
    }

    console.log(`${product.title.substring(0, 55)}`);
    console.log(`   ${media.length} immagini disponibili`);

    // Create metafields
    const metafieldsToSet: any[] = [];

    for (const [key, index] of Object.entries(IMAGE_METAFIELD_MAPPING)) {
      if (index < media.length) {
        metafieldsToSet.push({
          ownerId: product.id,
          namespace: 'custom',
          key: key,
          value: media[index].id,
          type: 'file_reference',
        });
      }
    }

    if (metafieldsToSet.length > 0) {
      try {
        const result: any = await client.request(SET_METAFIELDS, {
          metafields: metafieldsToSet,
        });

        if (result.metafieldsSet.userErrors.length === 0) {
          console.log(`   ✓ ${metafieldsToSet.length} metafield immagini assegnati`);
          totalSet += metafieldsToSet.length;
        } else {
          console.log(`   ! ${result.metafieldsSet.userErrors[0].message}`);
        }
      } catch (e: any) {
        console.log(`   ! Errore: ${e.message?.substring(0, 60)}`);
      }
    }

    console.log('');
    await delay(300);
  }

  console.log('='.repeat(70));
  console.log(`RISULTATO: ${totalSet} metafield immagini assegnati`);
  console.log('='.repeat(70));

  await prisma.$disconnect();
}

main().catch(console.error);
