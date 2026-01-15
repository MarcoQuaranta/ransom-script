/**
 * Verifica che le collezioni su Moretti Dallas siano identiche a Italivio
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

const SOURCE_SHOP = 'usa-shop-8790.myshopify.com';
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com';

const COLLECTIONS_QUERY = `
  query getCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
          descriptionHtml
          sortOrder
          productsCount {
            count
          }
          image {
            url
          }
          ruleSet {
            appliedDisjunctively
            rules {
              column
              relation
              condition
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

async function getAllCollections(client: GraphQLClient): Promise<any[]> {
  let collections: any[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const result: any = await client.request(COLLECTIONS_QUERY, { first: 50, after: cursor });
    collections = collections.concat(result.collections.edges.map((e: any) => e.node));
    hasNextPage = result.collections.pageInfo.hasNextPage;
    cursor = result.collections.pageInfo.endCursor;
  }

  return collections;
}

async function main() {
  console.log('='.repeat(90));
  console.log('VERIFICA COLLEZIONI');
  console.log('='.repeat(90));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  const sourceCollections = await getAllCollections(sourceClient);
  const targetCollections = await getAllCollections(targetClient);

  console.log('\n' + 'COLLEZIONE'.padEnd(30) + 'ITALIVIO'.padEnd(20) + 'MORETTI DALLAS'.padEnd(20) + 'STATO');
  console.log('-'.repeat(90));

  let allOk = true;

  for (const sc of sourceCollections) {
    const tc = targetCollections.find(t => t.title === sc.title);

    const sourceRules = sc.ruleSet?.rules?.map((r: any) => `${r.column}:${r.condition}`).join(', ') || 'Manual';

    if (!tc) {
      console.log(
        sc.title.substring(0, 28).padEnd(30) +
        sourceRules.substring(0, 18).padEnd(20) +
        'NON TROVATA'.padEnd(20) +
        '❌'
      );
      allOk = false;
      continue;
    }

    const targetRules = tc.ruleSet?.rules?.map((r: any) => `${r.column}:${r.condition}`).join(', ') || 'Manual';

    // Confronta regole
    const rulesMatch = sourceRules === targetRules;
    const sortMatch = sc.sortOrder === tc.sortOrder;

    const status = rulesMatch && sortMatch ? '✓' : '⚠';
    if (!rulesMatch || !sortMatch) allOk = false;

    console.log(
      sc.title.substring(0, 28).padEnd(30) +
      sourceRules.substring(0, 18).padEnd(20) +
      targetRules.substring(0, 18).padEnd(20) +
      status
    );
  }

  console.log('-'.repeat(90));
  console.log(`\nRISULTATO: ${allOk ? '✓ TUTTE LE COLLEZIONI CORRISPONDONO' : '⚠ ALCUNE DIFFERENZE'}`);

  // Dettagli regole
  console.log('\n' + '='.repeat(90));
  console.log('DETTAGLIO REGOLE COLLEZIONI');
  console.log('='.repeat(90));

  for (const sc of sourceCollections) {
    const tc = targetCollections.find(t => t.title === sc.title);
    if (!tc) continue;

    console.log(`\n${sc.title}:`);

    if (sc.ruleSet?.rules?.length > 0) {
      console.log('   ITALIVIO:');
      for (const r of sc.ruleSet.rules) {
        console.log(`      - ${r.column} ${r.relation} "${r.condition}"`);
      }
      console.log('   MORETTI:');
      for (const r of tc.ruleSet?.rules || []) {
        console.log(`      - ${r.column} ${r.relation} "${r.condition}"`);
      }
    } else {
      console.log('   (Collezione manuale)');
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
