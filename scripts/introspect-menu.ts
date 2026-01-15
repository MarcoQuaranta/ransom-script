import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

async function main() {
  const shop = await prisma.shop.findUnique({ where: { shop: 'bc2ywa-ee.myshopify.com' } });
  const client = new GraphQLClient('https://bc2ywa-ee.myshopify.com/admin/api/2024-01/graphql.json', {
    headers: {
      'X-Shopify-Access-Token': shop!.accessToken,
      'Content-Type': 'application/json',
    },
  });

  // Query per vedere la struttura di menuUpdate
  const INTROSPECT = `
    {
      __type(name: "Mutation") {
        fields {
          name
          args {
            name
            type {
              name
              kind
              ofType { name kind }
              inputFields {
                name
                type { name kind ofType { name } }
              }
            }
          }
        }
      }
    }
  `;

  const result: any = await client.request(INTROSPECT);
  const menuUpdate = result.__type.fields.find((f: any) => f.name === 'menuUpdate');

  if (menuUpdate) {
    console.log('menuUpdate args:');
    for (const arg of menuUpdate.args) {
      console.log(`  ${arg.name}: ${arg.type.name || arg.type.kind}`);
      if (arg.type.inputFields) {
        for (const field of arg.type.inputFields) {
          const typeName = field.type.name || field.type.ofType?.name || field.type.kind;
          console.log(`    - ${field.name}: ${typeName}`);
        }
      }
    }
  }

  // Query per MenuInput type
  const MENU_INPUT = `
    {
      __type(name: "MenuUpdateInput") {
        inputFields {
          name
          type { name kind ofType { name kind } }
        }
      }
    }
  `;

  try {
    const inputResult: any = await client.request(MENU_INPUT);
    if (inputResult.__type) {
      console.log('\nMenuUpdateInput fields:');
      for (const field of inputResult.__type.inputFields || []) {
        const typeName = field.type.name || field.type.ofType?.name || field.type.kind;
        console.log(`  - ${field.name}: ${typeName}`);
      }
    }
  } catch (e) {
    console.log('MenuUpdateInput not found');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
