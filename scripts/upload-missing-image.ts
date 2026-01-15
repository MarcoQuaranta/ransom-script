/**
 * Carica l'immagine mancante da Italivio a Moretti Dallas
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

const SOURCE_SHOP = 'usa-shop-8790.myshopify.com';
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com';

const FILES_QUERY = `
  query getFiles($first: Int!, $query: String) {
    files(first: $first, query: $query) {
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
`;

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

async function main() {
  console.log('='.repeat(80));
  console.log('CARICAMENTO IMMAGINE MANCANTE');
  console.log('='.repeat(80));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  // Trova immagine su Italivio
  console.log('\n[1] Ricerca immagine su Italivio...');

  const sourceResult: any = await sourceClient.request(FILES_QUERY, {
    first: 50,
    query: 'filename:general-clothing-bold-4',
  });

  const sourceFile = sourceResult.files.edges[0]?.node;

  if (!sourceFile?.image?.url) {
    console.log('   ❌ Immagine non trovata su Italivio');
    await prisma.$disconnect();
    return;
  }

  console.log(`   ✓ Trovata: ${sourceFile.image.url}`);

  // Verifica se esiste già su Moretti
  console.log('\n[2] Verifica su Moretti Dallas...');

  const targetResult: any = await targetClient.request(FILES_QUERY, {
    first: 10,
    query: 'filename:general-clothing-bold-4',
  });

  if (targetResult.files.edges.length > 0) {
    console.log('   ✓ Immagine già presente su Moretti Dallas');
    await prisma.$disconnect();
    return;
  }

  console.log('   Immagine non presente, caricamento in corso...');

  // Carica immagine
  console.log('\n[3] Caricamento immagine...');

  try {
    const uploadResult: any = await targetClient.request(FILE_CREATE, {
      files: [{
        originalSource: sourceFile.image.url,
        contentType: 'IMAGE',
        filename: 'general-clothing-bold-4.jpg',
      }],
    });

    if (uploadResult.fileCreate.userErrors?.length > 0) {
      console.log(`   ❌ Errore: ${uploadResult.fileCreate.userErrors[0].message}`);
    } else {
      const newFile = uploadResult.fileCreate.files?.[0];
      console.log(`   ✓ Caricata: ${newFile?.image?.url || 'OK'}`);
    }
  } catch (e: any) {
    console.log(`   ❌ Errore: ${e.message?.substring(0, 80)}`);
  }

  // Verifica finale
  console.log('\n[4] Verifica finale...');

  // Attendi un momento per la propagazione
  await new Promise(r => setTimeout(r, 2000));

  const verifyResult: any = await targetClient.request(FILES_QUERY, {
    first: 10,
    query: 'filename:general-clothing-bold-4',
  });

  if (verifyResult.files.edges.length > 0) {
    console.log(`   ✓ Immagine presente: ${verifyResult.files.edges[0].node.image?.url}`);
  } else {
    console.log('   ⚠ Immagine non ancora visibile (potrebbe richiedere qualche secondo)');
  }

  console.log('\n' + '='.repeat(80));
  console.log('COMPLETATO');
  console.log('='.repeat(80));

  await prisma.$disconnect();
}

main().catch(console.error);
