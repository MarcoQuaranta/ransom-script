/**
 * Aggiorna il menu main-menu usando menuUpdate
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
        node { id title handle }
      }
    }
  }
`;

const PAGES_QUERY = `
  query getPages($first: Int!) {
    pages(first: $first) {
      edges {
        node { id title handle }
      }
    }
  }
`;

const MENU_UPDATE = `
  mutation menuUpdate($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
    menuUpdate(id: $id, title: $title, items: $items) {
      menu {
        id
        title
        items { id title type }
      }
      userErrors { field message }
    }
  }
`;

const DELETE_MENU = `
  mutation menuDelete($id: ID!) {
    menuDelete(id: $id) {
      deletedMenuId
      userErrors { field message }
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

function convertMenuItem(
  item: any,
  sourceCollections: any[],
  targetCollections: any[],
  sourcePages: any[],
  targetPages: any[]
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
  } else if (item.type === 'PAGE' && item.resourceId) {
    const sourcePage = sourcePages.find(p => p.id === item.resourceId);
    if (sourcePage) {
      const targetPage = targetPages.find(p => p.title === sourcePage.title || p.handle === sourcePage.handle);
      if (targetPage) {
        converted.resourceId = targetPage.id;
      }
    }
  } else if (item.type === 'HTTP' && item.url) {
    converted.url = item.url;
  }

  if (item.items && item.items.length > 0) {
    converted.items = item.items.map((subItem: any) =>
      convertMenuItem(subItem, sourceCollections, targetCollections, sourcePages, targetPages)
    );
  }

  return converted;
}

async function main() {
  console.log('='.repeat(70));
  console.log('AGGIORNAMENTO MENU PRINCIPALE');
  console.log('='.repeat(70));

  const sourceClient = await getClient(SOURCE_SHOP);
  const targetClient = await getClient(TARGET_SHOP);

  // Carica dati
  console.log('\n[1] Caricamento dati...');

  const sourceMenusResult: any = await sourceClient.request(MENUS_QUERY, { first: 50 });
  const sourceMenus = sourceMenusResult.menus.edges.map((e: any) => e.node);
  const sourceMainMenu = sourceMenus.find((m: any) => m.handle === 'main-menu');

  const targetMenusResult: any = await targetClient.request(MENUS_QUERY, { first: 50 });
  const targetMenus = targetMenusResult.menus.edges.map((e: any) => e.node);
  const targetMainMenu = targetMenus.find((m: any) => m.handle === 'main-menu');

  const sourceCollResult: any = await sourceClient.request(COLLECTIONS_QUERY, { first: 100 });
  const sourceCollections = sourceCollResult.collections.edges.map((e: any) => e.node);

  const targetCollResult: any = await targetClient.request(COLLECTIONS_QUERY, { first: 100 });
  const targetCollections = targetCollResult.collections.edges.map((e: any) => e.node);

  const sourcePagesResult: any = await sourceClient.request(PAGES_QUERY, { first: 100 });
  const sourcePages = sourcePagesResult.pages.edges.map((e: any) => e.node);

  const targetPagesResult: any = await targetClient.request(PAGES_QUERY, { first: 100 });
  const targetPages = targetPagesResult.pages.edges.map((e: any) => e.node);

  console.log(`   Menu principale Italivio: ${sourceMainMenu?.items?.length || 0} voci`);
  console.log(`   Menu principale Moretti: ${targetMainMenu?.items?.length || 0} voci`);

  if (!sourceMainMenu || !targetMainMenu) {
    console.log('Menu non trovato!');
    await prisma.$disconnect();
    return;
  }

  // Elimina eventuali menu duplicati
  console.log('\n[2] Pulizia menu duplicati...');
  const duplicates = targetMenus.filter((m: any) =>
    m.handle.startsWith('main-menu-') || m.handle.startsWith('categories-')
  );

  for (const dup of duplicates) {
    try {
      await targetClient.request(DELETE_MENU, { id: dup.id });
      console.log(`   ✓ Eliminato ${dup.handle}`);
    } catch (e: any) {
      console.log(`   ⚠ ${dup.handle}: ${e.message?.substring(0, 40)}`);
    }
  }

  // Converti items
  console.log('\n[3] Conversione menu...');
  const convertedItems = sourceMainMenu.items.map((item: any) =>
    convertMenuItem(item, sourceCollections, targetCollections, sourcePages, targetPages)
  );

  console.log(`   Items convertiti: ${convertedItems.length}`);

  // Aggiorna menu
  console.log('\n[4] Aggiornamento menu...');
  try {
    const updateResult: any = await targetClient.request(MENU_UPDATE, {
      id: targetMainMenu.id,
      title: 'Menu principale',
      items: convertedItems,
    });

    if (updateResult.menuUpdate.userErrors?.length > 0) {
      console.log(`   ❌ ${updateResult.menuUpdate.userErrors[0].message}`);
    } else {
      console.log(`   ✓ Aggiornato con ${updateResult.menuUpdate.menu?.items?.length || 0} voci`);
    }
  } catch (e: any) {
    console.log(`   ❌ ${e.message?.substring(0, 100)}`);
  }

  // Verifica finale
  console.log('\n[5] Verifica finale...');
  const finalResult: any = await targetClient.request(MENUS_QUERY, { first: 50 });
  const finalMenus = finalResult.menus.edges.map((e: any) => e.node);
  const finalMainMenu = finalMenus.find((m: any) => m.handle === 'main-menu');

  if (finalMainMenu) {
    console.log(`\n📁 ${finalMainMenu.title} (${finalMainMenu.handle}) - ${finalMainMenu.items?.length || 0} voci`);
    for (const item of finalMainMenu.items || []) {
      const subCount = item.items?.length || 0;
      console.log(`   ├─ ${item.title} [${item.type}]${subCount > 0 ? ` (${subCount} sotto-voci)` : ''}`);
      for (const subItem of item.items || []) {
        const subSubCount = subItem.items?.length || 0;
        console.log(`   │  ├─ ${subItem.title}${subSubCount > 0 ? ` (${subSubCount})` : ''}`);
      }
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('COMPLETATO');
  console.log('='.repeat(70));

  await prisma.$disconnect();
}

main().catch(console.error);
