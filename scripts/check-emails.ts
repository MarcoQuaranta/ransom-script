import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const SHOP_ID = 'cmkfaa57v0000w8qso46m602i';
const THEME_ID = '193980629330';

async function main() {
  const shop = await prisma.shop.findUnique({ where: { id: SHOP_ID } });
  if (!shop) return;

  const templates = ['templates/product.apollo.json', 'templates/product.non-scontati.json'];

  console.log('Checking for email addresses:\n');

  for (const t of templates) {
    const response = await fetch(
      `https://${shop.shop}/admin/api/2024-01/themes/${THEME_ID}/assets.json?asset[key]=${encodeURIComponent(t)}`,
      { headers: { 'X-Shopify-Access-Token': shop.accessToken } }
    );
    const data: any = await response.json();
    const content = data.asset.value;

    // Find all email addresses
    const emails = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    const uniqueEmails = [...new Set(emails)];

    console.log(`📄 ${t}:`);
    if (uniqueEmails.length === 0) {
      console.log('   No email addresses found');
    } else {
      uniqueEmails.forEach(e => console.log(`   - ${e}`));
    }
    console.log('');
  }
}

main().finally(() => prisma.$disconnect());
