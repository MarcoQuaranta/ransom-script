/**
 * Verifica struttura menu
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

async function main() {
  const shop = await prisma.shop.findUnique({ where: { shop: TARGET_SHOP } });
  const client = new GraphQLClient(`https://${TARGET_SHOP}/admin/api/2024-01/graphql.json`, {
    headers: {
      'X-Shopify-Access-Token': shop!.accessToken,
      'Content-Type': 'application/json',
    },
  });

  const result: any = await client.request(MENUS_QUERY, { first: 50 });
  const menus = result.menus.edges.map((e: any) => e.node);

  console.log('MENU SU MORETTI DALLAS:\n');

  for (const menu of menus) {
    console.log(`📁 ${menu.title} (handle: ${menu.handle})`);
    console.log(`   ID: ${menu.id}`);
    for (const item of menu.items || []) {
      console.log(`   ├─ ${item.title} [${item.type}]`);
      for (const subItem of item.items || []) {
        console.log(`   │  ├─ ${subItem.title} [${subItem.type}]`);
        for (const subSubItem of subItem.items || []) {
          console.log(`   │  │  └─ ${subSubItem.title} [${subSubItem.type}]`);
        }
      }
    }
    console.log('');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
