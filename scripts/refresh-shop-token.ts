/**
 * Script per rigenerare il token di accesso Shopify
 * Usa le credenziali API per ottenere un nuovo token
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY!;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET!;

async function refreshToken(shopDomain: string) {
  console.log('='.repeat(60));
  console.log('REFRESH TOKEN SHOPIFY');
  console.log('='.repeat(60));

  console.log(`\nShop: ${shopDomain}`);
  console.log(`API Key: ${SHOPIFY_API_KEY.substring(0, 8)}...`);

  // Method 1: Client Credentials Grant (for custom apps)
  console.log('\n[1] Tentativo con Client Credentials...');

  try {
    const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        grant_type: 'client_credentials',
      }),
    });

    const responseText = await response.text();
    console.log(`Response status: ${response.status}`);

    if (response.ok) {
      const data = JSON.parse(responseText);
      console.log('✓ Token ottenuto!');

      // Salva nel database
      const expiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : null;

      await prisma.shop.update({
        where: { shop: shopDomain },
        data: {
          accessToken: data.access_token,
          tokenExpiresAt: expiresAt,
          clientId: SHOPIFY_API_KEY,
          clientSecret: SHOPIFY_API_SECRET,
        },
      });

      console.log('✓ Token salvato nel database!');
      if (expiresAt) {
        console.log(`  Scade: ${expiresAt.toISOString()}`);
      }

      return data.access_token;
    } else {
      console.log(`✗ Errore: ${responseText}`);
    }
  } catch (error: any) {
    console.log(`✗ Errore: ${error.message}`);
  }

  // Method 2: Using existing offline token refresh
  console.log('\n[2] Verifica token esistente...');

  const shop = await prisma.shop.findUnique({
    where: { shop: shopDomain }
  });

  if (shop?.accessToken) {
    console.log(`Token attuale (primi 10 char): ${shop.accessToken.substring(0, 10)}...`);
    console.log(`Lunghezza: ${shop.accessToken.length}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Per ottenere un nuovo token, avvia l\'app e ri-autorizza:');
  console.log(`1. npm run dev`);
  console.log(`2. Vai su http://localhost:3000`);
  console.log(`3. Installa l\'app su ${shopDomain}`);
  console.log('='.repeat(60));

  await prisma.$disconnect();
}

// Shop da aggiornare
const shopDomain = process.argv[2] || 'usa-shop-8790.myshopify.com';
refreshToken(shopDomain);
