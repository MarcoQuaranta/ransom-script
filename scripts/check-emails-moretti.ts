import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SHOP_ID = 'cmkfaa57v0000w8qso46m602i'; // moretti dallas
const THEME_ID = '193980629330';

async function listAssets(shop: any, themeId: string) {
  const response = await fetch(
    `https://${shop.shop}/admin/api/2024-01/themes/${themeId}/assets.json`,
    { headers: { 'X-Shopify-Access-Token': shop.accessToken } }
  );
  const data = await response.json();
  return data.assets || [];
}

async function getAsset(shop: any, themeId: string, assetKey: string) {
  const response = await fetch(
    `https://${shop.shop}/admin/api/2024-01/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(assetKey)}`,
    { headers: { 'X-Shopify-Access-Token': shop.accessToken } }
  );
  const data = await response.json();
  return data.asset;
}

async function main() {
  console.log('Checking Moretti Dallas theme for email addresses...\n');

  const shop = await prisma.shop.findUnique({ where: { id: SHOP_ID } });
  if (!shop) {
    console.error('Shop not found');
    return;
  }

  console.log(`Connected to: ${shop.name} (${shop.shop})\n`);

  const assets = await listAssets(shop, THEME_ID);
  console.log(`Found ${assets.length} theme assets\n`);

  // Check all text-based assets
  const textAssets = assets.filter((a: any) =>
    a.key.endsWith('.json') ||
    a.key.endsWith('.liquid') ||
    a.key.endsWith('.css') ||
    a.key.endsWith('.js')
  );

  console.log(`Checking ${textAssets.length} text assets for emails...\n`);

  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const findings: { file: string; emails: string[] }[] = [];

  for (const asset of textAssets) {
    try {
      const content = await getAsset(shop, THEME_ID, asset.key);
      if (content && content.value) {
        const emails = content.value.match(emailPattern);
        if (emails) {
          // Filter out common Shopify/system emails
          const relevantEmails = emails.filter((e: string) =>
            !e.includes('shopify.com') &&
            !e.includes('example.com') &&
            !e.includes('email.com') &&
            !e.includes('myshopify.com')
          );
          if (relevantEmails.length > 0) {
            findings.push({ file: asset.key, emails: [...new Set(relevantEmails)] as string[] });
          }
        }
      }
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (err) {
      // Skip errors
    }
  }

  console.log('\n========================================');
  console.log('EMAIL ADDRESSES FOUND:');
  console.log('========================================\n');

  if (findings.length === 0) {
    console.log('No email addresses found in theme files');
  } else {
    for (const finding of findings) {
      console.log(`File: ${finding.file}`);
      for (const email of finding.emails) {
        const status = email === 'support@morettidallas.com' ? '[OK]' : '[FIX]';
        console.log(`   ${status} ${email}`);
      }
      console.log('');
    }

    // Summary
    const allEmails = findings.flatMap(f => f.emails);
    const uniqueEmails = [...new Set(allEmails)];
    const wrongEmails = uniqueEmails.filter(e => e !== 'support@morettidallas.com');

    console.log('========================================');
    console.log('SUMMARY:');
    console.log('========================================');
    console.log(`Total unique emails: ${uniqueEmails.length}`);
    console.log(`Correct (support@morettidallas.com): ${uniqueEmails.includes('support@morettidallas.com') ? 'Yes' : 'No'}`);
    if (wrongEmails.length > 0) {
      console.log(`\nEmails to fix: ${wrongEmails.join(', ')}`);
    } else {
      console.log('\nAll emails are correct!');
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
