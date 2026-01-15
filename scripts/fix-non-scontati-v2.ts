import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SHOP_ID = 'cmkfaa57v0000w8qso46m602i';
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
        asset: { key: assetKey, value: value }
      })
    }
  );

  const data = await response.json();

  if (data.errors) {
    console.log('Errors:', JSON.stringify(data.errors, null, 2));
    return { success: false, errors: data.errors };
  }

  return { success: true, data };
}

// Recursively fix block_order in all nested structures
function fixAllBlockOrders(obj: any, path: string = ''): number {
  let fixCount = 0;

  if (!obj || typeof obj !== 'object') return fixCount;

  // If this object has both block_order and blocks, fix it
  if (Array.isArray(obj.block_order) && obj.blocks && typeof obj.blocks === 'object') {
    const existingBlockIds = Object.keys(obj.blocks);
    const originalLength = obj.block_order.length;
    obj.block_order = obj.block_order.filter((id: string) => existingBlockIds.includes(id));

    if (obj.block_order.length !== originalLength) {
      const removed = originalLength - obj.block_order.length;
      console.log(`   Fixed ${path || 'root'}: removed ${removed} invalid block references`);
      fixCount += removed;
    }
  }

  // Recurse into all properties
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object') {
      fixCount += fixAllBlockOrders(value, path ? `${path}.${key}` : key);
    }
  }

  return fixCount;
}

async function main() {
  console.log('🔄 Connecting to Moretti Dallas shop...\n');

  const shop = await prisma.shop.findUnique({ where: { id: SHOP_ID } });
  if (!shop) {
    console.error('❌ Shop not found');
    return;
  }

  console.log(`✅ Connected to: ${shop.name}\n`);

  // Get the template
  console.log('📥 Downloading template...');
  const asset = await getAsset(shop, THEME_ID, 'templates/product.non-scontati.json');

  if (!asset?.value) {
    console.error('❌ Could not get asset');
    return;
  }

  // Parse JSON
  let jsonData: any;
  try {
    jsonData = JSON.parse(asset.value);
    console.log('✅ JSON parsed successfully\n');
  } catch (e) {
    console.error('❌ Failed to parse JSON:', e);
    return;
  }

  // Fix all block_order issues recursively
  console.log('🔧 Fixing block_order issues...');
  const fixCount = fixAllBlockOrders(jsonData);
  console.log(`   Total fixes: ${fixCount}\n`);

  // Convert back to string
  let content = JSON.stringify(jsonData, null, 2);

  // Replace ITALIVIO
  const beforeCount = (content.match(/ITALIVIO|Italivio|italivio/g) || []).length;
  console.log(`🔍 Found ${beforeCount} occurrences of "ITALIVIO"`);

  content = content.replace(/ITALIVIO/g, 'MORETTI DALLAS');
  content = content.replace(/Italivio/g, 'MORETTI DALLAS');
  content = content.replace(/italivio/g, 'MORETTI DALLAS');

  const afterCount = (content.match(/italivio/gi) || []).length;
  console.log(`   After replacement: ${afterCount} occurrences remaining\n`);

  // Upload
  console.log('📤 Uploading fixed template...');
  const result = await updateAsset(shop, THEME_ID, 'templates/product.non-scontati.json', content);

  if (result.success) {
    console.log('✅ Template updated successfully!\n');
  } else {
    console.log('❌ Failed to update template\n');
    return;
  }

  // Verify
  console.log('🔍 Verifying...');
  const verifyAsset = await getAsset(shop, THEME_ID, 'templates/product.non-scontati.json');
  const verifyCount = (verifyAsset.value.match(/italivio/gi) || []).length;
  console.log(`   templates/product.non-scontati.json: ${verifyCount} occurrences of "ITALIVIO"`);

  if (verifyCount === 0) {
    console.log('\n✅ All ITALIVIO references have been removed!');
  } else {
    console.log('\n⚠️ Some ITALIVIO references still remain');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
