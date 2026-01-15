/**
 * Corregge i menu duplicati su Moretti Dallas
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

const UPDATE_MENU = `
  mutation menuUpdate($id: ID!, $title: String!, $handle: String!) {
    menuUpdate(id: $id, title: $title, handle: $handle) {
      menu { id title handle }
      userErrors { field message }
    }
  }
`;

async function main() {
  const shop = await prisma.shop.findUnique({ where: { shop: TARGET_SHOP } });
  const client = new GraphQLClient(`https://${TARGET_SHOP}/admin/api/2024-01/graphql.json`, {
    headers: {
      'X-Shopify-Access-Token': shop!.accessToken,
      'Content-Type': 'application/json',
    },
  });

  console.log('='.repeat(60));
  console.log('CORREZIONE MENU DUPLICATI');
  console.log('='.repeat(60));

  const result: any = await client.request(MENUS_QUERY, { first: 50 });
  const menus = result.menus.edges.map((e: any) => e.node);

  // Trova menu da eliminare e menu da tenere
  const mainMenus = menus.filter((m: any) => m.handle.startsWith('main-menu'));
  console.log(`\nMenu "principale" trovati: ${mainMenus.length}`);

  // Il menu corretto è quello con più voci
  let bestMenu = mainMenus[0];
  for (const m of mainMenus) {
    const itemCount = m.items?.length || 0;
    const bestCount = bestMenu?.items?.length || 0;
    if (itemCount > bestCount) {
      bestMenu = m;
    }
  }

  console.log(`\nMenu migliore: ${bestMenu.handle} (${bestMenu.items?.length || 0} voci)`);

  // Elimina gli altri
  for (const m of mainMenus) {
    if (m.id !== bestMenu.id) {
      console.log(`\nEliminazione ${m.handle}...`);
      try {
        await client.request(DELETE_MENU, { id: m.id });
        console.log(`   ✓ Eliminato`);
      } catch (e: any) {
        console.log(`   ❌ ${e.message?.substring(0, 50)}`);
      }
    }
  }

  // Rinomina il menu migliore in "main-menu"
  if (bestMenu.handle !== 'main-menu') {
    console.log(`\nRinomina ${bestMenu.handle} -> main-menu...`);
    try {
      await client.request(UPDATE_MENU, {
        id: bestMenu.id,
        title: 'Menu principale',
        handle: 'main-menu',
      });
      console.log(`   ✓ Rinominato`);
    } catch (e: any) {
      console.log(`   ❌ ${e.message?.substring(0, 50)}`);
    }
  }

  // Verifica finale
  console.log('\n' + '='.repeat(60));
  console.log('VERIFICA FINALE');
  console.log('='.repeat(60));

  const finalResult: any = await client.request(MENUS_QUERY, { first: 50 });
  const finalMenus = finalResult.menus.edges.map((e: any) => e.node);

  for (const menu of finalMenus) {
    const itemCount = menu.items?.length || 0;
    console.log(`\n📁 ${menu.title} (${menu.handle}) - ${itemCount} voci`);
    if (menu.handle === 'main-menu' || menu.handle === 'categories') {
      for (const item of menu.items || []) {
        const subCount = item.items?.length || 0;
        console.log(`   ├─ ${item.title} [${item.type}]${subCount > 0 ? ` (${subCount} sotto-voci)` : ''}`);
      }
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
