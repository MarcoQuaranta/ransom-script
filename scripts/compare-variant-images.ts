/**
 * Confronta immagini varianti tra source e target
 */
import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();
const SOURCE_SHOP = 'usa-shop-8790.myshopify.com';
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com';

const QUERY = `
  query getProducts($first: Int!, $query: String) {
    products(first: $first, query: $query) {
      edges {
        node {
          title
          variants(first: 100) {
            edges {
              node {
                title
                selectedOptions { name value }
                media(first: 1) {
                  edges {
                    node { ... on MediaImage { id } }
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

async function main() {
  const sourceShop = await prisma.shop.findUnique({ where: { shop: SOURCE_SHOP } });
  const targetShop = await prisma.shop.findUnique({ where: { shop: TARGET_SHOP } });

  const sourceClient = new GraphQLClient(`https://${SOURCE_SHOP}/admin/api/2024-01/graphql.json`, {
    headers: { 'X-Shopify-Access-Token': sourceShop!.accessToken, 'Content-Type': 'application/json' }
  });
  const targetClient = new GraphQLClient(`https://${TARGET_SHOP}/admin/api/2024-01/graphql.json`, {
    headers: { 'X-Shopify-Access-Token': targetShop!.accessToken, 'Content-Type': 'application/json' }
  });

  const products = ['ThermoFlex Beanie', 'K-Style Slim Fit Blazer'];

  for (const title of products) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${title}`);
    console.log('='.repeat(60));

    const sourceRes: any = await sourceClient.request(QUERY, { first: 1, query: `title:*${title}*` });
    const targetRes: any = await targetClient.request(QUERY, { first: 1, query: `title:*${title}*` });

    const sp = sourceRes.products.edges[0]?.node;
    const tp = targetRes.products.edges[0]?.node;

    if (!sp || !tp) {
      console.log('Prodotto non trovato');
      continue;
    }

    console.log('\nITALIVIO:');
    const sv = sp.variants.edges.map((e: any) => e.node);
    const svColors = new Set<string>();
    const svColorsWithImg = new Set<string>();

    for (const v of sv) {
      const color = v.selectedOptions?.find((o: any) => o.name === 'Color')?.value;
      if (color) {
        svColors.add(color);
        if (v.media?.edges?.length > 0) {
          svColorsWithImg.add(color);
        }
      }
    }
    console.log(`   Colori: ${Array.from(svColors).join(', ')}`);
    console.log(`   Colori con img: ${Array.from(svColorsWithImg).join(', ') || 'NESSUNO'}`);

    console.log('\nMORETTI DALLAS:');
    const tv = tp.variants.edges.map((e: any) => e.node);
    const tvColors = new Set<string>();
    const tvColorsWithImg = new Set<string>();

    for (const v of tv) {
      const color = v.selectedOptions?.find((o: any) => o.name === 'Color')?.value;
      if (color) {
        tvColors.add(color);
        if (v.media?.edges?.length > 0) {
          tvColorsWithImg.add(color);
        }
      }
    }
    console.log(`   Colori: ${Array.from(tvColors).join(', ')}`);
    console.log(`   Colori con img: ${Array.from(tvColorsWithImg).join(', ') || 'NESSUNO'}`);

    const match = svColorsWithImg.size === tvColorsWithImg.size;
    console.log(`\n   ${match ? '✓ UGUALE A ITALIVIO' : '⚠ DIVERSO DA ITALIVIO'}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
