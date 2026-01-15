/**
 * Confronto DETTAGLIATO di OGNI variante e immagine tra Italivio e Moretti Dallas
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

function extractFilename(url: string): string {
  try {
    const parts = url.split('/');
    let filename = parts[parts.length - 1].split('?')[0];
    // Rimuovi UUID (pattern: _xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    filename = filename.replace(/_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '');
    // Rimuovi suffissi dimensioni
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
  console.log('='.repeat(90));
  console.log('CONFRONTO DETTAGLIATO VARIANTI E IMMAGINI');
  console.log('='.repeat(90));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  const sourceProducts = await getAllProducts(sourceClient);
  const targetProducts = await getAllProducts(targetClient);

  let totalIssues = 0;

  for (const sp of sourceProducts) {
    const tp = targetProducts.find(p => p.title === sp.title);
    if (!tp) continue;

    const issues: string[] = [];

    // 1. Confronta immagini prodotto (galleria)
    const sourceMedia = sp.media.edges.map((e: any) => e.node).filter((m: any) => m.image?.url);
    const targetMedia = tp.media.edges.map((e: any) => e.node).filter((m: any) => m.image?.url);

    const sourceFilenames = sourceMedia.map((m: any) => extractFilename(m.image.url));
    const targetFilenames = targetMedia.map((m: any) => extractFilename(m.image.url));

    // Verifica se tutte le immagini source esistono su target
    for (const sf of sourceFilenames) {
      if (!targetFilenames.includes(sf)) {
        issues.push(`GALLERIA: Manca immagine "${sf}"`);
      }
    }

    // Verifica immagini extra su target
    for (const tf of targetFilenames) {
      if (!sourceFilenames.includes(tf)) {
        issues.push(`GALLERIA: Immagine extra "${tf}" (non su Italivio)`);
      }
    }

    // Verifica ordine immagini
    if (sourceFilenames.length === targetFilenames.length) {
      for (let i = 0; i < sourceFilenames.length; i++) {
        if (sourceFilenames[i] !== targetFilenames[i]) {
          issues.push(`GALLERIA: Ordine diverso pos ${i + 1}: "${sourceFilenames[i]}" vs "${targetFilenames[i]}"`);
          break;
        }
      }
    }

    // 2. Confronta immagini varianti
    const sourceVariants = sp.variants.edges.map((e: any) => e.node);
    const targetVariants = tp.variants.edges.map((e: any) => e.node);

    // Crea mapping filename -> posizione per matching
    const sourceFilenameToPos: Map<string, number> = new Map();
    sourceFilenames.forEach((f: string, i: number) => sourceFilenameToPos.set(f, i));

    const targetFilenameToPos: Map<string, number> = new Map();
    targetFilenames.forEach((f: string, i: number) => targetFilenameToPos.set(f, i));

    for (const sv of sourceVariants) {
      const key = getVariantKey(sv);
      const tv = targetVariants.find((t: any) => getVariantKey(t) === key);

      if (!tv) {
        issues.push(`VARIANTE: "${sv.title}" non trovata su target`);
        continue;
      }

      // Immagini associate alla variante source
      const svMedia = sv.media?.edges?.map((e: any) => e.node).filter((m: any) => m.image?.url) || [];
      const tvMedia = tv.media?.edges?.map((e: any) => e.node).filter((m: any) => m.image?.url) || [];

      const svFilenames = svMedia.map((m: any) => extractFilename(m.image.url));
      const tvFilenames = tvMedia.map((m: any) => extractFilename(m.image.url));

      // Confronta
      if (svFilenames.length !== tvFilenames.length) {
        const colorOpt = sv.selectedOptions?.find((o: any) => o.name === 'Color')?.value || sv.title;
        issues.push(`VARIANTE "${colorOpt}": ${svFilenames.length} img su Italivio, ${tvFilenames.length} su Moretti`);
      } else if (svFilenames.length > 0) {
        // Verifica che siano le stesse immagini
        for (let i = 0; i < svFilenames.length; i++) {
          if (svFilenames[i] !== tvFilenames[i]) {
            const colorOpt = sv.selectedOptions?.find((o: any) => o.name === 'Color')?.value || sv.title;
            issues.push(`VARIANTE "${colorOpt}": img diversa - "${svFilenames[i]}" vs "${tvFilenames[i]}"`);
          }
        }
      }
    }

    // Stampa risultato
    if (issues.length > 0) {
      console.log(`\n${'═'.repeat(90)}`);
      console.log(`❌ ${sp.title}`);
      console.log('─'.repeat(90));
      for (const issue of issues) {
        console.log(`   ${issue}`);
      }
      totalIssues += issues.length;
    } else {
      console.log(`✓ ${sp.title.substring(0, 60)}`);
    }
  }

  console.log('\n' + '═'.repeat(90));
  if (totalIssues === 0) {
    console.log('✓ TUTTO CORRISPONDE PERFETTAMENTE');
  } else {
    console.log(`❌ TROVATI ${totalIssues} PROBLEMI`);
  }
  console.log('═'.repeat(90));

  await prisma.$disconnect();
}

main().catch(console.error);
