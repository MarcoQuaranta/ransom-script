/**
 * Pubblica le collezioni sui canali di vendita
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com';

// Query per ottenere le collezioni
const COLLECTIONS_QUERY = `
  query getCollections($first: Int!) {
    collections(first: $first) {
      edges {
        node {
          id
          title
          handle
        }
      }
    }
  }
`;

// Query per ottenere i canali di vendita (publications)
const PUBLICATIONS_QUERY = `
  query {
    publications(first: 20) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`;

// Mutation per pubblicare una collezione
const PUBLISH_COLLECTION = `
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

async function main() {
  console.log('='.repeat(80));
  console.log('PUBBLICAZIONE COLLEZIONI SUI CANALI DI VENDITA');
  console.log('='.repeat(80));

  const shop = await prisma.shop.findUnique({ where: { shop: TARGET_SHOP } });
  const client = new GraphQLClient(`https://${TARGET_SHOP}/admin/api/2024-01/graphql.json`, {
    headers: {
      'X-Shopify-Access-Token': shop!.accessToken,
      'Content-Type': 'application/json',
    },
  });

  // 1. Ottieni canali di vendita
  console.log('\n[1] Canali di vendita disponibili:');
  const pubResult: any = await client.request(PUBLICATIONS_QUERY);
  const publications = pubResult.publications.edges.map((e: any) => e.node);

  for (const pub of publications) {
    console.log(`   - ${pub.name} (${pub.id})`);
  }

  // Trova Online Store
  const onlineStore = publications.find((p: any) =>
    p.name.toLowerCase().includes('online store') ||
    p.name.toLowerCase().includes('negozio online')
  );

  if (!onlineStore) {
    console.log('\n❌ Online Store non trovato!');
    console.log('   Canali disponibili:', publications.map((p: any) => p.name).join(', '));
    await prisma.$disconnect();
    return;
  }

  console.log(`\n   ✓ Online Store trovato: ${onlineStore.name}`);

  // 2. Ottieni collezioni
  console.log('\n[2] Collezioni da pubblicare:');
  const collResult: any = await client.request(COLLECTIONS_QUERY, { first: 50 });
  const collections = collResult.collections.edges.map((e: any) => e.node);

  console.log(`   Trovate ${collections.length} collezioni`);

  // 3. Pubblica ogni collezione
  console.log('\n[3] Pubblicazione collezioni...');

  const publicationInput = [{ publicationId: onlineStore.id }];
  let published = 0;

  for (const collection of collections) {
    try {
      const result: any = await client.request(PUBLISH_COLLECTION, {
        id: collection.id,
        input: publicationInput,
      });

      if (result.publishablePublish.userErrors?.length > 0) {
        console.log(`   ⚠ "${collection.title}": ${result.publishablePublish.userErrors[0].message}`);
      } else {
        console.log(`   ✓ "${collection.title}" pubblicata`);
        published++;
      }
    } catch (e: any) {
      console.log(`   ❌ "${collection.title}": ${e.message?.substring(0, 50)}`);
    }

    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n' + '='.repeat(80));
  console.log(`COMPLETATO: ${published}/${collections.length} collezioni pubblicate`);
  console.log('='.repeat(80));

  await prisma.$disconnect();
}

main().catch(console.error);
