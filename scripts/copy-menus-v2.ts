/**
 * Copia menu di navigazione da Italivio a Moretti Dallas
 * Versione 2: Elimina e ricrea i menu
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

const SOURCE_SHOP = 'usa-shop-8790.myshopify.com';
const TARGET_SHOP = 'bc2ywa-ee.myshopify.com';

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

const DELETE_MENU = `
  mutation menuDelete($id: ID!) {
    menuDelete(id: $id) {
      deletedMenuId
      userErrors {
        field
        message
      }
    }
  }
`;

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

function convertMenuItem(
  item: any,
  sourceCollections: any[],
  targetCollections: any[]
): any {
  const converted: any = {
    title: item.title,
    type: item.type,
  };

  if (item.type === 'COLLECTION' && item.resourceId) {
    const sourceCollection = sourceCollections.find(c => c.id === item.resourceId);
    if (sourceCollection) {
      const targetCollection = targetCollections.find(c => c.title === sourceCollection.title);
      if (targetCollection) {
        converted.resourceId = targetCollection.id;
      }
    }
  } else if (item.type === 'HTTP' && item.url) {
    converted.url = item.url;
  }

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

  // 1. Ottieni dati
  console.log('\n[1] Caricamento dati...');
  const sourceMenusResult: any = await sourceClient.request(MENUS_QUERY, { first: 50 });
  const sourceMenus = sourceMenusResult.menus.edges.map((e: any) => e.node);

  const targetMenusResult: any = await targetClient.request(MENUS_QUERY, { first: 50 });
  const targetMenus = targetMenusResult.menus.edges.map((e: any) => e.node);

  const sourceCollResult: any = await sourceClient.request(COLLECTIONS_QUERY, { first: 100 });
  const sourceCollections = sourceCollResult.collections.edges.map((e: any) => e.node);

  const targetCollResult: any = await targetClient.request(COLLECTIONS_QUERY, { first: 100 });
  const targetCollections = targetCollResult.collections.edges.map((e: any) => e.node);

  console.log(`   Menu Italivio: ${sourceMenus.length}`);
  console.log(`   Menu Moretti: ${targetMenus.length}`);

  // 2. Per ogni menu su Italivio
  console.log('\n[2] Elaborazione menu...');

  for (const sourceMenu of sourceMenus) {
    console.log(`\n   📁 ${sourceMenu.title} (${sourceMenu.handle})`);

    // Trova menu esistente su target con stesso handle
    const existingMenu = targetMenus.find((m: any) => m.handle === sourceMenu.handle);

    // Se esiste, elimina
    if (existingMenu) {
      console.log(`      Eliminazione menu esistente...`);
      try {
        await targetClient.request(DELETE_MENU, { id: existingMenu.id });
        console.log(`      ✓ Eliminato`);
      } catch (e: any) {
        console.log(`      ⚠ Non eliminato: ${e.message?.substring(0, 40)}`);
      }
      await delay(500);
    }

    // Converti items
    const convertedItems = (sourceMenu.items || []).map((item: any) =>
      convertMenuItem(item, sourceCollections, targetCollections)
    );

    // Crea nuovo menu
    console.log(`      Creazione menu...`);
    try {
      const result: any = await targetClient.request(CREATE_MENU, {
        title: sourceMenu.title,
        handle: sourceMenu.handle,
        items: convertedItems,
      });

      if (result.menuCreate.userErrors?.length > 0) {
        console.log(`      ❌ ${result.menuCreate.userErrors[0].message}`);
      } else {
        console.log(`      ✓ Creato con ${convertedItems.length} voci`);
      }
    } catch (e: any) {
      console.log(`      ❌ ${e.message?.substring(0, 60)}`);
    }

    await delay(500);
  }

  // 3. Verifica finale
  console.log('\n[3] Verifica finale...');
  const finalMenusResult: any = await targetClient.request(MENUS_QUERY, { first: 50 });
  const finalMenus = finalMenusResult.menus.edges.map((e: any) => e.node);

  for (const menu of finalMenus) {
    console.log(`\n   📁 ${menu.title} (${menu.handle})`);
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

  console.log('\n' + '='.repeat(80));
  console.log('COMPLETATO');
  console.log('='.repeat(80));

  await prisma.$disconnect();
}

main().catch(console.error);
