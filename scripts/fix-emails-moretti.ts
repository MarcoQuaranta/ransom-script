import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SHOP_ID = 'cmkfaa57v0000w8qso46m602i'; // moretti dallas
const THEME_ID = '193980629330';

async function getAsset(shop: any, themeId: string, assetKey: string) {
  const response = await fetch(
    `https://${shop.shop}/admin/api/2024-01/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(assetKey)}`,
    { headers: { 'X-Shopify-Access-Token': shop.accessToken } }
  );
  const data = await response.json();
  return data.asset;
}

async function updateAsset(shop: any, themeId: string, assetKey: string, value: string) {
  const response = await fetch(
    `https://${shop.shop}/admin/api/2024-01/themes/${themeId}/assets.json`,
    {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': shop.accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        asset: {
          key: assetKey,
          value: value
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data;
}

async function main() {
  console.log('Fixing emails in Moretti Dallas theme...\n');

  const shop = await prisma.shop.findUnique({ where: { id: SHOP_ID } });
  if (!shop) {
    console.error('Shop not found');
    return;
  }

  console.log(`Connected to: ${shop.name} (${shop.shop})\n`);

  const filesToFix = [
    'templates/product.json',
    'templates/product.raincoat.json'
  ];

  for (const file of filesToFix) {
    console.log(`\nProcessing: ${file}`);

    const asset = await getAsset(shop, THEME_ID, file);
    if (!asset || !asset.value) {
      console.log('  Could not read asset');
      continue;
    }

    let content = asset.value;
    const beforeCount = (content.match(/info@morettidallas\.com/gi) || []).length;

    if (beforeCount === 0) {
      console.log('  No info@morettidallas.com found');
      continue;
    }

    console.log(`  Found ${beforeCount} occurrence(s) of info@morettidallas.com`);

    // Replace email
    content = content.replace(/info@morettidallas\.com/gi, 'support@morettidallas.com');

    // Verify replacement
    const afterCount = (content.match(/info@morettidallas\.com/gi) || []).length;
    console.log(`  After replacement: ${afterCount} remaining`);

    // Update the asset
    console.log('  Uploading...');
    try {
      await updateAsset(shop, THEME_ID, file, content);
      console.log('  [OK] Updated successfully');
    } catch (error: any) {
      console.error(`  [ERROR] ${error.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n========================================');
  console.log('Done! Verifying changes...');
  console.log('========================================\n');

  // Verify
  for (const file of filesToFix) {
    const asset = await getAsset(shop, THEME_ID, file);
    const infoCount = (asset?.value?.match(/info@morettidallas\.com/gi) || []).length;
    const supportCount = (asset?.value?.match(/support@morettidallas\.com/gi) || []).length;
    console.log(`${file}:`);
    console.log(`  info@morettidallas.com: ${infoCount}`);
    console.log(`  support@morettidallas.com: ${supportCount}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
