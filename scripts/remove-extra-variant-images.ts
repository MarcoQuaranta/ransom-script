/**
 * Rimuove immagini extra dalle varianti che non le hanno su Italivio
 */
import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();
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
                media(first: 10) {
                  edges {
                    node {
                      ... on MediaImage { id }
                    }
                  }
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

async function main() {
  const shop = await prisma.shop.findUnique({ where: { shop: TARGET_SHOP } });
  const client = new GraphQLClient(`https://${TARGET_SHOP}/admin/api/2024-01/graphql.json`, {
    headers: { 'X-Shopify-Access-Token': shop!.accessToken, 'Content-Type': 'application/json' }
  });

  const products = ['ThermoFlex Beanie', 'K-Style Slim Fit Blazer'];

  for (const title of products) {
    console.log(`\nProcessando: ${title}`);

    const result: any = await client.request(PRODUCTS_QUERY, { first: 1, query: `title:*${title}*` });
    const product = result.products.edges[0]?.node;

    if (!product) {
      console.log('   Non trovato');
      continue;
    }

    const variants = product.variants.edges.map((e: any) => e.node);
    const variantMediaInputs: any[] = [];

    for (const v of variants) {
      const mediaIds = v.media?.edges?.map((e: any) => e.node?.id).filter(Boolean) || [];
      if (mediaIds.length > 0) {
        variantMediaInputs.push({
          variantId: v.id,
          mediaIds: mediaIds,
        });
      }
    }

    if (variantMediaInputs.length > 0) {
      try {
        await client.request(DETACH_MEDIA, {
          productId: product.id,
          variantMedia: variantMediaInputs,
        });
        console.log(`   ✓ Rimosse immagini da ${variantMediaInputs.length} varianti`);
      } catch (e: any) {
        console.log(`   ! Errore: ${e.message?.substring(0, 60)}`);
      }
    } else {
      console.log('   Nessuna immagine da rimuovere');
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
