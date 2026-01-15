/**
 * Aggiorna il menu main-menu esistente con gli items corretti
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();
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

const DELETE_MENU = `
  mutation menuDelete($id: ID!) {
    menuDelete(id: $id) {
      deletedMenuId
      userErrors { field message }
    }
  }
`;

// Prima eliminiamo tutti gli items esistenti, poi aggiungiamo i nuovi
const MENU_ITEM_DELETE = `
  mutation menuItemDelete($id: ID!) {
    menuItemDelete(id: $id) {
      deletedMenuItemId
      userErrors { field message }
    }
  }
`;

const MENU_ITEM_CREATE = `
  mutation menuItemCreate($menuId: ID!, $menuItem: MenuItemCreateInput!) {
    menuItemCreate(menuId: $menuId, menuItem: $menuItem) {
      menuItem { id title }
      userErrors { field message }
    }
  }
`;

function prepareMenuItem(item: any): any {
  const prepared: any = {
    title: item.title,
    type: item.type,
  };

  if (item.url) prepared.url = item.url;
  if (item.resourceId) prepared.resourceId = item.resourceId;

  if (item.items && item.items.length > 0) {
    prepared.items = item.items.map((subItem: any) => prepareMenuItem(subItem));
  }

  return prepared;
}

async function main() {
  const shop = await prisma.shop.findUnique({ where: { shop: TARGET_SHOP } });
  const client = new GraphQLClient(`https://${TARGET_SHOP}/admin/api/2024-01/graphql.json`, {
    headers: {
      'X-Shopify-Access-Token': shop!.accessToken,
      'Content-Type': 'application/json',
    },
  });

  console.log('='.repeat(60));
  console.log('AGGIORNAMENTO MENU PRINCIPALE');
  console.log('='.repeat(60));

  const result: any = await client.request(MENUS_QUERY, { first: 50 });
  const menus = result.menus.edges.map((e: any) => e.node);

  const mainMenu = menus.find((m: any) => m.handle === 'main-menu');
  const correctMenu = menus.find((m: any) => m.handle === 'main-menu-1');

  if (!mainMenu) {
    console.log('Menu main-menu non trovato!');
    await prisma.$disconnect();
    return;
  }

  if (!correctMenu) {
    console.log('Menu main-menu-1 non trovato!');
    await prisma.$disconnect();
    return;
  }

  console.log(`\nMenu da aggiornare: ${mainMenu.handle} (${mainMenu.items?.length || 0} voci)`);
  console.log(`Menu sorgente: ${correctMenu.handle} (${correctMenu.items?.length || 0} voci)`);

  // 1. Elimina tutti gli items esistenti dal main-menu
  console.log('\n[1] Eliminazione items esistenti...');
  for (const item of mainMenu.items || []) {
    try {
      await client.request(MENU_ITEM_DELETE, { id: item.id });
      console.log(`   ✓ Eliminato "${item.title}"`);
    } catch (e: any) {
      console.log(`   ❌ "${item.title}": ${e.message?.substring(0, 40)}`);
    }
  }

  // Attendi un momento
  await new Promise(r => setTimeout(r, 500));

  // 2. Aggiungi nuovi items dal menu corretto
  console.log('\n[2] Aggiunta nuovi items...');
  for (const item of correctMenu.items || []) {
    const menuItem = prepareMenuItem(item);

    try {
      const createResult: any = await client.request(MENU_ITEM_CREATE, {
        menuId: mainMenu.id,
        menuItem: menuItem,
      });

      if (createResult.menuItemCreate.userErrors?.length > 0) {
        console.log(`   ❌ "${item.title}": ${createResult.menuItemCreate.userErrors[0].message}`);
      } else {
        console.log(`   ✓ Aggiunto "${item.title}"`);
      }
    } catch (e: any) {
      console.log(`   ❌ "${item.title}": ${e.message?.substring(0, 50)}`);
    }

    await new Promise(r => setTimeout(r, 200));
  }

  // 3. Elimina menu duplicato main-menu-1
  console.log('\n[3] Eliminazione menu duplicato...');
  try {
    await client.request(DELETE_MENU, { id: correctMenu.id });
    console.log('   ✓ Eliminato main-menu-1');
  } catch (e: any) {
    console.log(`   ❌ ${e.message?.substring(0, 50)}`);
  }

  // Verifica finale
  console.log('\n' + '='.repeat(60));
  console.log('VERIFICA FINALE');
  console.log('='.repeat(60));

  const finalResult: any = await client.request(MENUS_QUERY, { first: 50 });
  const finalMenus = finalResult.menus.edges.map((e: any) => e.node);

  const finalMainMenu = finalMenus.find((m: any) => m.handle === 'main-menu');
  if (finalMainMenu) {
    console.log(`\n📁 ${finalMainMenu.title} (${finalMainMenu.handle}) - ${finalMainMenu.items?.length || 0} voci`);
    for (const item of finalMainMenu.items || []) {
      const subCount = item.items?.length || 0;
      console.log(`   ├─ ${item.title} [${item.type}]${subCount > 0 ? ` (${subCount} sotto-voci)` : ''}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
