/**
 * Corregge i menu - Elimina main-menu sbagliato e ricrea da main-menu-2
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
            title
            type
            url
            resourceId
            items {
              title
              type
              url
              resourceId
              items {
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

const CREATE_MENU = `
  mutation menuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
    menuCreate(title: $title, handle: $handle, items: $items) {
      menu { id title handle }
      userErrors { field message }
    }
  }
`;

function convertItem(item: any): any {
  const converted: any = {
    title: item.title,
    type: item.type,
  };

  if (item.url) converted.url = item.url;
  if (item.resourceId) converted.resourceId = item.resourceId;

  if (item.items && item.items.length > 0) {
    converted.items = item.items.map(convertItem);
  }

  return converted;
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
  console.log('CORREZIONE MENU PRINCIPALE');
  console.log('='.repeat(60));

  const result: any = await client.request(MENUS_QUERY, { first: 50 });
  const menus = result.menus.edges.map((e: any) => e.node);

  // Trova main-menu (quello sbagliato) e main-menu-2 (quello corretto)
  const wrongMenu = menus.find((m: any) => m.handle === 'main-menu');
  const correctMenu = menus.find((m: any) => m.handle === 'main-menu-2');

  console.log(`\nMenu sbagliato (main-menu): ${wrongMenu?.items?.length || 0} voci`);
  console.log(`Menu corretto (main-menu-2): ${correctMenu?.items?.length || 0} voci`);

  if (!correctMenu) {
    console.log('\nMenu corretto non trovato!');
    await prisma.$disconnect();
    return;
  }

  // 1. Elimina menu sbagliato
  if (wrongMenu) {
    console.log('\n[1] Eliminazione main-menu sbagliato...');
    try {
      await client.request(DELETE_MENU, { id: wrongMenu.id });
      console.log('   ✓ Eliminato');
    } catch (e: any) {
      console.log(`   ❌ ${e.message?.substring(0, 50)}`);
    }
  }

  // 2. Elimina main-menu-2 (lo ricreemo come main-menu)
  console.log('\n[2] Eliminazione main-menu-2...');
  try {
    await client.request(DELETE_MENU, { id: correctMenu.id });
    console.log('   ✓ Eliminato');
  } catch (e: any) {
    console.log(`   ❌ ${e.message?.substring(0, 50)}`);
  }

  // Attendi un momento
  await new Promise(r => setTimeout(r, 1000));

  // 3. Ricrea come main-menu
  console.log('\n[3] Creazione nuovo main-menu...');
  const items = correctMenu.items.map(convertItem);

  try {
    const createResult: any = await client.request(CREATE_MENU, {
      title: 'Menu principale',
      handle: 'main-menu',
      items: items,
    });

    if (createResult.menuCreate.userErrors?.length > 0) {
      console.log(`   ❌ ${createResult.menuCreate.userErrors[0].message}`);
    } else {
      console.log(`   ✓ Creato con ${items.length} voci`);
    }
  } catch (e: any) {
    console.log(`   ❌ ${e.message?.substring(0, 60)}`);
  }

  // Verifica finale
  console.log('\n' + '='.repeat(60));
  console.log('VERIFICA FINALE');
  console.log('='.repeat(60));

  const finalResult: any = await client.request(MENUS_QUERY, { first: 50 });
  const finalMenus = finalResult.menus.edges.map((e: any) => e.node);

  for (const menu of finalMenus) {
    const itemCount = menu.items?.length || 0;
    if (menu.handle === 'main-menu' || menu.handle === 'categories') {
      console.log(`\n📁 ${menu.title} (${menu.handle}) - ${itemCount} voci`);
      for (const item of menu.items || []) {
        const subCount = item.items?.length || 0;
        console.log(`   ├─ ${item.title} [${item.type}]${subCount > 0 ? ` (${subCount} sotto-voci)` : ''}`);
      }
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
