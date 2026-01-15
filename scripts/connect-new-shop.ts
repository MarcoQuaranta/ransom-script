/**
 * Script per collegare un nuovo shop e generare il token
 */

import { PrismaClient } from '@prisma/client';
import { GraphQLClient } from 'graphql-request';

const prisma = new PrismaClient();

const NEW_SHOP_DOMAIN = process.env.NEW_SHOP_DOMAIN || '';
const NEW_API_KEY = process.env.NEW_SHOP_API_KEY || '';
const NEW_API_SECRET = process.env.NEW_SHOP_API_SECRET || '';

async function connectNewShop() {
  console.log('='.repeat(60));
  console.log('CONNESSIONE NUOVO SHOP');
  console.log('='.repeat(60));

  console.log(`\nShop: ${NEW_SHOP_DOMAIN}`);

  // 1. Genera token con client_credentials
  console.log('\n[1] Generazione token...');

  const response = await fetch(`https://${NEW_SHOP_DOMAIN}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: NEW_API_KEY,
      client_secret: NEW_API_SECRET,
      grant_type: 'client_credentials',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`✗ Errore: ${response.status} - ${errorText}`);
    return;
  }

  const tokenData = await response.json();
  console.log('✓ Token ottenuto!');

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;

  // 2. Salva nel database
  console.log('\n[2] Salvataggio nel database...');

  const shop = await prisma.shop.upsert({
    where: { shop: NEW_SHOP_DOMAIN },
    update: {
      accessToken: tokenData.access_token,
      tokenExpiresAt: expiresAt,
      clientId: NEW_API_KEY,
      clientSecret: NEW_API_SECRET,
    },
    create: {
      shop: NEW_SHOP_DOMAIN,
      accessToken: tokenData.access_token,
      tokenExpiresAt: expiresAt,
      clientId: NEW_API_KEY,
      clientSecret: NEW_API_SECRET,
      scope: 'read_products,write_products,read_files,write_files,read_metaobjects,write_metaobjects,read_metafields,write_metafields',
    },
  });

  console.log('✓ Shop salvato nel database!');
  console.log(`  ID: ${shop.id}`);

  // 3. Verifica connessione
  console.log('\n[3] Verifica connessione API...');

  const client = new GraphQLClient(`https://${NEW_SHOP_DOMAIN}/admin/api/2024-01/graphql.json`, {
    headers: {
      'X-Shopify-Access-Token': tokenData.access_token,
      'Content-Type': 'application/json',
    },
  });

  const shopInfo: any = await client.request(`
    query {
      shop {
        name
        email
        primaryDomain {
          host
        }
      }
    }
  `);

  console.log(`✓ Connesso a: ${shopInfo.shop.name}`);
  console.log(`  Dominio: ${shopInfo.shop.primaryDomain?.host}`);

  // Update shop name in DB
  await prisma.shop.update({
    where: { id: shop.id },
    data: { name: shopInfo.shop.name },
  });

  console.log('\n' + '='.repeat(60));
  console.log('SHOP COLLEGATO CON SUCCESSO!');
  console.log(`Shop ID: ${shop.id}`);
  console.log('='.repeat(60));

  await prisma.$disconnect();
}

connectNewShop().catch(console.error);
