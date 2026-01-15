/**
 * Copia menu di navigazione da Italivio a Moretti Dallas
 * Versione 3: Salta le pagine mancanti
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

const PAGES_QUERY = `
  query getPages($first: Int!) {
    pages(first: $first) {
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

const CREATE_PAGE = `
  mutation pageCreate($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page {
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

// Query per ottenere contenuto pagine
const PAGE_CONTENT_QUERY = `
  query getPage($id: ID!) {
    page(id: $id) {
      id
      title
      handle
      body
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
  targetCollections: any[],
  sourcePages: any[],
  targetPages: any[],
  skippedItems: string[]
): any | null {
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
      } else {
        skippedItems.push(`${item.title} (collezione non trovata)`);
        return null;
      }
    }
  } else if (item.type === 'PAGE' && item.resourceId) {
    const sourcePage = sourcePages.find(p => p.id === item.resourceId);
    if (sourcePage) {
      const targetPage = targetPages.find(p => p.title === sourcePage.title || p.handle === sourcePage.handle);
      if (targetPage) {
        converted.resourceId = targetPage.id;
      } else {
        skippedItems.push(`${item.title} (pagina non trovata)`);
        return null;
      }
    }
  } else if (item.type === 'HTTP' && item.url) {
    converted.url = item.url;
  }

  if (item.items && item.items.length > 0) {
    const convertedSubItems = item.items
      .map((subItem: any) => convertMenuItem(subItem, sourceCollections, targetCollections, sourcePages, targetPages, skippedItems))
      .filter(Boolean);
    if (convertedSubItems.length > 0) {
      converted.items = convertedSubItems;
    }
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

  let targetMenusResult: any = await targetClient.request(MENUS_QUERY, { first: 50 });
  let targetMenus = targetMenusResult.menus.edges.map((e: any) => e.node);

  const sourceCollResult: any = await sourceClient.request(COLLECTIONS_QUERY, { first: 100 });
  const sourceCollections = sourceCollResult.collections.edges.map((e: any) => e.node);

  const targetCollResult: any = await targetClient.request(COLLECTIONS_QUERY, { first: 100 });
  const targetCollections = targetCollResult.collections.edges.map((e: any) => e.node);

  const sourcePagesResult: any = await sourceClient.request(PAGES_QUERY, { first: 100 });
  const sourcePages = sourcePagesResult.pages.edges.map((e: any) => e.node);

  let targetPagesResult: any = await targetClient.request(PAGES_QUERY, { first: 100 });
  let targetPages = targetPagesResult.pages.edges.map((e: any) => e.node);

  console.log(`   Menu: Italivio ${sourceMenus.length}, Moretti ${targetMenus.length}`);
  console.log(`   Collezioni: Italivio ${sourceCollections.length}, Moretti ${targetCollections.length}`);
  console.log(`   Pagine: Italivio ${sourcePages.length}, Moretti ${targetPages.length}`);

  // 2. Crea pagine mancanti
  console.log('\n[2] Verifica pagine...');

  // Trova pagine referenziate nei menu
  const referencedPageIds = new Set<string>();
  for (const menu of sourceMenus) {
    const findPageRefs = (items: any[]) => {
      for (const item of items || []) {
        if (item.type === 'PAGE' && item.resourceId) {
          referencedPageIds.add(item.resourceId);
        }
        if (item.items) findPageRefs(item.items);
      }
    };
    findPageRefs(menu.items);
  }

  console.log(`   Pagine referenziate nei menu: ${referencedPageIds.size}`);

  for (const pageId of referencedPageIds) {
    const sourcePage = sourcePages.find((p: any) => p.id === pageId);
    if (!sourcePage) continue;

    const targetPage = targetPages.find((p: any) => p.title === sourcePage.title || p.handle === sourcePage.handle);

    if (!targetPage) {
      console.log(`   Creazione pagina "${sourcePage.title}"...`);

      // Ottieni contenuto pagina
      try {
        const pageContent: any = await sourceClient.request(PAGE_CONTENT_QUERY, { id: pageId });
        const page = pageContent.page;

        const result: any = await targetClient.request(CREATE_PAGE, {
          page: {
            title: page.title,
            handle: page.handle,
            body: page.body || '',
          },
        });

        if (result.pageCreate.userErrors?.length > 0) {
          console.log(`      ❌ ${result.pageCreate.userErrors[0].message}`);
        } else {
          console.log(`      ✓ Creata`);
        }
      } catch (e: any) {
        console.log(`      ❌ ${e.message?.substring(0, 50)}`);
      }
      await delay(300);
    } else {
      console.log(`   ✓ "${sourcePage.title}" già esistente`);
    }
  }

  // Ricarica pagine target
  targetPagesResult = await targetClient.request(PAGES_QUERY, { first: 100 });
  targetPages = targetPagesResult.pages.edges.map((e: any) => e.node);

  // 3. Copia menu
  console.log('\n[3] Copia menu...');

  // Ricarica menu target
  targetMenusResult = await targetClient.request(MENUS_QUERY, { first: 50 });
  targetMenus = targetMenusResult.menus.edges.map((e: any) => e.node);

  for (const sourceMenu of sourceMenus) {
    console.log(`\n   📁 ${sourceMenu.title} (${sourceMenu.handle})`);

    // Trova ed elimina menu esistente
    const existingMenu = targetMenus.find((m: any) => m.handle === sourceMenu.handle);
    if (existingMenu) {
      console.log(`      Eliminazione menu esistente...`);
      try {
        await targetClient.request(DELETE_MENU, { id: existingMenu.id });
        console.log(`      ✓ Eliminato`);
      } catch (e: any) {
        console.log(`      ⚠ ${e.message?.substring(0, 40)}`);
      }
      await delay(500);
    }

    // Converti items
    const skippedItems: string[] = [];
    const convertedItems = (sourceMenu.items || [])
      .map((item: any) => convertMenuItem(item, sourceCollections, targetCollections, sourcePages, targetPages, skippedItems))
      .filter(Boolean);

    if (skippedItems.length > 0) {
      console.log(`      ⚠ Saltati: ${skippedItems.join(', ')}`);
    }

    // Crea menu
    console.log(`      Creazione menu con ${convertedItems.length} voci...`);
    try {
      const result: any = await targetClient.request(CREATE_MENU, {
        title: sourceMenu.title,
        handle: sourceMenu.handle,
        items: convertedItems,
      });

      if (result.menuCreate.userErrors?.length > 0) {
        console.log(`      ❌ ${result.menuCreate.userErrors[0].message}`);
      } else {
        console.log(`      ✓ Creato`);
      }
    } catch (e: any) {
      console.log(`      ❌ ${e.message?.substring(0, 60)}`);
    }

    await delay(500);
  }

  // 4. Verifica finale
  console.log('\n[4] Verifica finale...');
  const finalMenusResult: any = await targetClient.request(MENUS_QUERY, { first: 50 });
  const finalMenus = finalMenusResult.menus.edges.map((e: any) => e.node);

  for (const menu of finalMenus) {
    if (menu.handle === 'main-menu' || menu.handle === 'categories') {
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
  }

  console.log('\n' + '='.repeat(80));
  console.log('COMPLETATO');
  console.log('='.repeat(80));

  await prisma.$disconnect();
}

main().catch(console.error);
