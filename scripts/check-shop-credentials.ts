import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkShopCredentials() {
  const shop = await prisma.shop.findFirst({
    where: { shop: 'usa-shop-8790.myshopify.com' }
  });

  if (!shop) {
    console.log('Shop not found');
    return;
  }

  console.log('Shop USA credentials:');
  console.log('- ID:', shop.id);
  console.log('- Name:', shop.name);
  console.log('- Shop domain:', shop.shop);
  console.log('- Has access token:', !!shop.accessToken);
  console.log('- Token length:', shop.accessToken?.length || 0);
  console.log('- Has clientId:', !!shop.clientId);
  console.log('- Has clientSecret:', !!shop.clientSecret);
  console.log('- Token expires at:', shop.tokenExpiresAt);

  await prisma.$disconnect();
}

checkShopCredentials();
