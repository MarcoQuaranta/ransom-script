/**
 * Copia collezioni da Italivio a Moretti Dallas
 * Copia tutto: titolo, descrizione, immagine, regole, ordinamento
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

const SOURCE_SHOP = 'usa-shop-8790.myshopify.com';
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com';

// Query per ottenere tutte le collezioni con dettagli
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
          templateSuffix
          image {
            url
            altText
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

// Mutation per creare collezione manuale
const CREATE_COLLECTION = `
  mutation collectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection {
        id
        title
        handle
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

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

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
  console.log('='.repeat(80));
  console.log('COPIA COLLEZIONI DA ITALIVIO A MORETTI DALLAS');
  console.log('='.repeat(80));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  // 1. Ottieni collezioni da entrambi gli shop
  console.log('\n[1] Caricamento collezioni...');
  const sourceCollections = await getAllCollections(sourceClient);
  const targetCollections = await getAllCollections(targetClient);

  console.log(`   Italivio: ${sourceCollections.length} collezioni`);
  console.log(`   Moretti:  ${targetCollections.length} collezioni`);

  // 2. Mostra collezioni su Italivio
  console.log('\n[2] Collezioni su Italivio:');
  for (const c of sourceCollections) {
    const ruleCount = c.ruleSet?.rules?.length || 0;
    const type = ruleCount > 0 ? 'Smart' : 'Manual';
    console.log(`   - ${c.title} (${type}${ruleCount > 0 ? `, ${ruleCount} regole` : ''})`);
  }

  // 3. Crea collezioni mancanti su Moretti
  console.log('\n[3] Creazione collezioni su Moretti Dallas...');

  let created = 0;
  let skipped = 0;

  for (const sc of sourceCollections) {
    // Verifica se esiste già
    const exists = targetCollections.find(tc => tc.title === sc.title || tc.handle === sc.handle);

    if (exists) {
      console.log(`   ⏭ "${sc.title}" - già esistente`);
      skipped++;
      continue;
    }

    // Prepara input per creazione
    const input: any = {
      title: sc.title,
      descriptionHtml: sc.descriptionHtml || '',
      sortOrder: sc.sortOrder || 'BEST_SELLING',
    };

    // Aggiungi handle se presente
    if (sc.handle) {
      input.handle = sc.handle;
    }

    // Aggiungi template suffix se presente
    if (sc.templateSuffix) {
      input.templateSuffix = sc.templateSuffix;
    }

    // Aggiungi immagine se presente
    if (sc.image?.url) {
      input.image = {
        src: sc.image.url,
        altText: sc.image.altText || sc.title,
      };
    }

    // Aggiungi regole se è una smart collection
    if (sc.ruleSet?.rules && sc.ruleSet.rules.length > 0) {
      input.ruleSet = {
        appliedDisjunctively: sc.ruleSet.appliedDisjunctively || false,
        rules: sc.ruleSet.rules.map((r: any) => ({
          column: r.column,
          relation: r.relation,
          condition: r.condition,
        })),
      };
    }

    try {
      const result: any = await targetClient.request(CREATE_COLLECTION, { input });

      if (result.collectionCreate.userErrors?.length > 0) {
        console.log(`   ❌ "${sc.title}" - ${result.collectionCreate.userErrors[0].message}`);
      } else {
        console.log(`   ✓ "${sc.title}" creata`);
        created++;
      }
    } catch (e: any) {
      console.log(`   ❌ "${sc.title}" - ${e.message?.substring(0, 60)}`);
    }

    await delay(500);
  }

  // 4. Riepilogo
  console.log('\n' + '='.repeat(80));
  console.log('RIEPILOGO:');
  console.log(`   Collezioni create: ${created}`);
  console.log(`   Collezioni già esistenti: ${skipped}`);
  console.log('='.repeat(80));

  await prisma.$disconnect();
}

main().catch(console.error);
