import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const SHOP_ID = 'cmkfaa57v0000w8qso46m602i';
const THEME_ID = '193980629330';

async function main() {
  const shop = await prisma.shop.findUnique({ where: { id: SHOP_ID } });
  if (!shop) {
    console.log('Shop not found');
    return;
  }

  const templates = ['templates/product.apollo.json', 'templates/product.non-scontati.json'];

  console.log('Final verification:\n');

  for (const t of templates) {
    const response = await fetch(
      `https://${shop.shop}/admin/api/2024-01/themes/${THEME_ID}/assets.json?asset[key]=${encodeURIComponent(t)}`,
      { headers: { 'X-Shopify-Access-Token': shop.accessToken } }
    );
    const data: any = await response.json();
    const count = (data.asset.value.match(/italivio/gi) || []).length;
    const status = count === 0 ? '✅' : '❌';
    console.log(`${status} ${t}: ${count} occurrences of ITALIVIO`);
  }
}

main().finally(() => prisma.$disconnect());
