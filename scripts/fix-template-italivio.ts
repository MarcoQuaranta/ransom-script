import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SHOP_ID = 'cmkfaa57v0000w8qso46m602i'; // moretti dallas
const THEME_ID = '193980629330'; // main theme

async function getAsset(shop: any, themeId: string, assetKey: string) {
  const response = await fetch(
    `https://${shop.shop}/admin/api/2024-01/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(assetKey)}`,
    {
      headers: { 'X-Shopify-Access-Token': shop.accessToken }
    }
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

async function processTemplate(shop: any, templateKey: string) {
  console.log(`\n📄 Processing: ${templateKey}`);

  const asset = await getAsset(shop, THEME_ID, templateKey);

  if (!asset || !asset.value) {
    console.log('   ❌ Could not read asset');
    return false;
  }

  let content = asset.value;

  // Count before
  const beforeCount = (content.match(/italivio/gi) || []).length;
  console.log(`   Found ${beforeCount} occurrences of "ITALIVIO" before replacement`);

  if (beforeCount === 0) {
    console.log('   ✅ No ITALIVIO found');
    return true;
  }

  // Replace all variations
  // ITALIVIO, Italivio, italivio
  content = content.replace(/ITALIVIO/g, 'MORETTI DALLAS');
  content = content.replace(/Italivio/g, 'MORETTI DALLAS');
  content = content.replace(/italivio/g, 'MORETTI DALLAS');

  // Count after
  const afterCount = (content.match(/italivio/gi) || []).length;
  console.log(`   After replacement: ${afterCount} occurrences remaining`);

  if (afterCount > 0) {
    console.log('   ⚠️ Some occurrences could not be replaced!');
    // Show remaining
    const lines = content.split('\n');
    lines.forEach((line: string, i: number) => {
      if (line.toLowerCase().includes('italivio')) {
        console.log(`   Line ${i + 1}: ${line.substring(0, 100)}...`);
      }
    });
  }

  // Update the asset
  console.log('   📤 Uploading updated content...');

  try {
    await updateAsset(shop, THEME_ID, templateKey, content);
    console.log('   ✅ Successfully updated!');
    return true;
  } catch (error: any) {
    console.error(`   ❌ Failed to update: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🔄 Connecting to Moretti Dallas shop...\n');

  const shop = await prisma.shop.findUnique({
    where: { id: SHOP_ID }
  });

  if (!shop) {
    console.error('❌ Shop not found');
    return;
  }

  console.log(`✅ Connected to: ${shop.name} (${shop.shop})`);

  // Process both templates
  const templates = [
    'templates/product.non-scontati.json',
    'templates/product.apollo.json'
  ];

  for (const template of templates) {
    await processTemplate(shop, template);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Verify the changes
  console.log('\n\n🔍 Verifying changes...');

  for (const template of templates) {
    const asset = await getAsset(shop, THEME_ID, template);
    const count = (asset.value.match(/italivio/gi) || []).length;
    console.log(`   ${template}: ${count} occurrences of "ITALIVIO"`);
  }

  console.log('\n✅ Done!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
