/**
 * Copia menu di navigazione da Italivio a Moretti Dallas
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

const SOURCE_SHOP = 'usa-shop-8790.myshopify.com';
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com';

// Query per ottenere tutti i menu
const MENUS_QUERY = `
  query getMenus($first: Int!) {
    menus(first: $first) {
      edges {
        node {
          id
          handle
          title
          items {
            id
            title
            type
            url
            resourceId
            items {
              id
              title
              type
              url
              resourceId
              items {
                id
                title
                type
                url
                resourceId
              }
            }
          }
        }
      }
    }
  }
`;

// Query per ottenere collezioni (per mappare resourceId)
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

// Mutation per creare menu
const CREATE_MENU = `
  mutation menuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
    menuCreate(title: $title, handle: $handle, items: $items) {
      menu {
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

// Mutation per aggiornare menu esistente
const UPDATE_MENU = `
  mutation menuUpdate($id: ID!, $title: String!, $items: [MenuItemCreateInput!]!) {
    menuUpdate(id: $id, title: $title, items: $items) {
      menu {
        id
        title
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

// Converte item menu per la creazione, mappando le collezioni
function convertMenuItem(
  item: any,
  sourceCollections: any[],
  targetCollections: any[]
): any {
  const converted: any = {
    title: item.title,
    type: item.type,
  };

  // Se è un link a collezione, mappa all'ID corrispondente su target
  if (item.type === 'COLLECTION' && item.resourceId) {
    const sourceCollection = sourceCollections.find(c => c.id === item.resourceId);
    if (sourceCollection) {
      const targetCollection = targetCollections.find(c => c.title === sourceCollection.title);
      if (targetCollection) {
        converted.resourceId = targetCollection.id;
      }
    }
  } else if (item.type === 'HTTP' && item.url) {
    // Link esterno
    converted.url = item.url;
  } else if (item.type === 'FRONTPAGE') {
    // Homepage - nessun resourceId necessario
  }

  // Processa sotto-items ricorsivamente
  if (item.items && item.items.length > 0) {
    converted.items = item.items.map((subItem: any) =>
      convertMenuItem(subItem, sourceCollections, targetCollections)
    );
  }

  return converted;
}

async function main() {
  console.log('='.repeat(80));
  console.log('COPIA MENU DA ITALIVIO A MORETTI DALLAS');
  console.log('='.repeat(80));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  // 1. Ottieni menu da source
  console.log('\n[1] Caricamento menu da Italivio...');
  const sourceMenusResult: any = await sourceClient.request(MENUS_QUERY, { first: 50 });
  const sourceMenus = sourceMenusResult.menus.edges.map((e: any) => e.node);
  console.log(`   Trovati ${sourceMenus.length} menu`);

  // 2. Ottieni menu da target
  console.log('\n[2] Caricamento menu da Moretti Dallas...');
  const targetMenusResult: any = await targetClient.request(MENUS_QUERY, { first: 50 });
  const targetMenus = targetMenusResult.menus.edges.map((e: any) => e.node);
  console.log(`   Trovati ${targetMenus.length} menu`);

  // 3. Ottieni collezioni per mapping
  console.log('\n[3] Caricamento collezioni per mapping...');
  const sourceCollResult: any = await sourceClient.request(COLLECTIONS_QUERY, { first: 100 });
  const sourceCollections = sourceCollResult.collections.edges.map((e: any) => e.node);

  const targetCollResult: any = await targetClient.request(COLLECTIONS_QUERY, { first: 100 });
  const targetCollections = targetCollResult.collections.edges.map((e: any) => e.node);
  console.log(`   Italivio: ${sourceCollections.length}, Moretti: ${targetCollections.length}`);

  // 4. Mostra struttura menu su Italivio
  console.log('\n[4] Struttura menu su Italivio:');
  for (const menu of sourceMenus) {
    console.log(`\n   📁 ${menu.title} (handle: ${menu.handle})`);
    for (const item of menu.items || []) {
      console.log(`      ├─ ${item.title} [${item.type}]`);
      for (const subItem of item.items || []) {
        console.log(`      │  ├─ ${subItem.title} [${subItem.type}]`);
        for (const subSubItem of subItem.items || []) {
          console.log(`      │  │  └─ ${subSubItem.title} [${subSubItem.type}]`);
        }
      }
    }
  }

  // 5. Copia/aggiorna menu
  console.log('\n[5] Creazione/aggiornamento menu su Moretti Dallas...');

  for (const sourceMenu of sourceMenus) {
    console.log(`\n   Menu: "${sourceMenu.title}" (${sourceMenu.handle})`);

    // Converti items
    const convertedItems = (sourceMenu.items || []).map((item: any) =>
      convertMenuItem(item, sourceCollections, targetCollections)
    );

    // Verifica se esiste già
    const existingMenu = targetMenus.find((m: any) => m.handle === sourceMenu.handle);

    if (existingMenu) {
      // Aggiorna menu esistente
      try {
        const result: any = await targetClient.request(UPDATE_MENU, {
          id: existingMenu.id,
          title: sourceMenu.title,
          items: convertedItems,
        });

        if (result.menuUpdate.userErrors?.length > 0) {
          console.log(`      ❌ Errore: ${result.menuUpdate.userErrors[0].message}`);
        } else {
          console.log(`      ✓ Aggiornato (${convertedItems.length} voci)`);
        }
      } catch (e: any) {
        console.log(`      ❌ Errore: ${e.message?.substring(0, 60)}`);
      }
    } else {
      // Crea nuovo menu
      try {
        const result: any = await targetClient.request(CREATE_MENU, {
          title: sourceMenu.title,
          handle: sourceMenu.handle,
          items: convertedItems,
        });

        if (result.menuCreate.userErrors?.length > 0) {
          console.log(`      ❌ Errore: ${result.menuCreate.userErrors[0].message}`);
        } else {
          console.log(`      ✓ Creato (${convertedItems.length} voci)`);
        }
      } catch (e: any) {
        console.log(`      ❌ Errore: ${e.message?.substring(0, 60)}`);
      }
    }

    await delay(500);
  }

  // 6. Verifica finale
  console.log('\n[6] Verifica finale...');
  const finalMenusResult: any = await targetClient.request(MENUS_QUERY, { first: 50 });
  const finalMenus = finalMenusResult.menus.edges.map((e: any) => e.node);

  console.log('\n   Menu su Moretti Dallas:');
  for (const menu of finalMenus) {
    const itemCount = menu.items?.length || 0;
    const subItemCount = menu.items?.reduce((sum: number, item: any) =>
      sum + (item.items?.length || 0), 0) || 0;
    console.log(`   ✓ ${menu.title}: ${itemCount} voci principali, ${subItemCount} sotto-voci`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('COMPLETATO');
  console.log('='.repeat(80));

  await prisma.$disconnect();
}

main().catch(console.error);
