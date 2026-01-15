import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

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

  // Parse JSON to fix structure issues
  let jsonData: any;
  try {
    jsonData = JSON.parse(asset.value);
    console.log('✅ JSON parsed successfully');
  } catch (e) {
    console.error('❌ Failed to parse JSON:', e);
    return;
  }

  // Fix block_order issues - remove references to non-existent blocks
  let fixedBlockOrder = false;

  function fixSectionBlockOrder(section: any, sectionName: string) {
    if (!section || !section.block_order || !section.blocks) return;

    const existingBlockIds = Object.keys(section.blocks);
    const originalOrder = [...section.block_order];
    section.block_order = section.block_order.filter((id: string) => existingBlockIds.includes(id));

    if (originalOrder.length !== section.block_order.length) {
      console.log(`   Fixed block_order in ${sectionName}: removed ${originalOrder.length - section.block_order.length} invalid references`);
      fixedBlockOrder = true;
    }

    // Recursively check nested blocks (groups)
    for (const [blockId, block] of Object.entries(section.blocks) as any) {
      if (block.block_order && block.blocks) {
        const nestedExisting = Object.keys(block.blocks);
        const nestedOriginal = [...block.block_order];
        block.block_order = block.block_order.filter((id: string) => nestedExisting.includes(id));

        if (nestedOriginal.length !== block.block_order.length) {
          console.log(`   Fixed nested block_order in ${sectionName}/${blockId}: removed ${nestedOriginal.length - block.block_order.length} invalid references`);
          fixedBlockOrder = true;
        }
      }
    }
  }

  // Process all sections
  if (jsonData.sections) {
    for (const [name, section] of Object.entries(jsonData.sections)) {
      fixSectionBlockOrder(section, name);
    }
  }

  // Convert back to string
  let content = JSON.stringify(jsonData, null, 2);

  // Now replace ITALIVIO
  const beforeCount = (content.match(/ITALIVIO|Italivio|italivio/g) || []).length;
  console.log(`\n🔍 Found ${beforeCount} occurrences of "ITALIVIO"`);

  content = content.replace(/ITALIVIO/g, 'MORETTI DALLAS');
  content = content.replace(/Italivio/g, 'MORETTI DALLAS');
  content = content.replace(/italivio/g, 'MORETTI DALLAS');

  const afterCount = (content.match(/ITALIVIO|Italivio|italivio/gi) || []).length;
  console.log(`   After replacement: ${afterCount} occurrences remaining`);

  // Upload
  console.log('\n📤 Uploading fixed template...');
  const result = await updateAsset(shop, THEME_ID, 'templates/product.non-scontati.json', content);

  if (result.success) {
    console.log('✅ Template updated successfully!');
  } else {
    console.log('❌ Failed to update template');

    // Save locally for debugging
    fs.writeFileSync('temp-fixed-non-scontati.json', content);
    console.log('   Saved fixed content to temp-fixed-non-scontati.json for debugging');
  }

  // Verify
  console.log('\n🔍 Verifying...');
  const verifyAsset = await getAsset(shop, THEME_ID, 'templates/product.non-scontati.json');
  const verifyCount = (verifyAsset.value.match(/italivio/gi) || []).length;
  console.log(`   templates/product.non-scontati.json: ${verifyCount} occurrences of "ITALIVIO"`);

  console.log('\n✅ Done!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
