import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SHOP_ID = 'cmkfaa57v0000w8qso46m602i'; // moretti dallas
const THEME_ID = '193980629330'; // main theme (moretti2)

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
  const data = await response.json();
  return data;
}

async function listAssets(shop: any, themeId: string) {
  const response = await fetch(
    `https://${shop.shop}/admin/api/2024-01/themes/${themeId}/assets.json`,
    {
      headers: { 'X-Shopify-Access-Token': shop.accessToken }
    }
  );
  const data = await response.json();
  return data.assets || [];
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

  console.log(`✅ Connected to: ${shop.name} (${shop.shop})\n`);

  // Get all assets
  console.log('📂 Fetching theme assets...');
  const assets = await listAssets(shop, THEME_ID);
  console.log(`   Found ${assets.length} assets\n`);

  // Filter for relevant templates
  const relevantKeys = assets
    .map((a: any) => a.key)
    .filter((key: string) =>
      key.toLowerCase().includes('apollo') ||
      key.toLowerCase().includes('non-scontati') ||
      key.toLowerCase().includes('non_scontati') ||
      key.toLowerCase().includes('landing')
    );

  console.log('🔍 Relevant templates found:');
  relevantKeys.forEach((k: string) => console.log(`   - ${k}`));
  console.log('');

  // Check each template for ITALIVIO and email addresses
  const filesToUpdate: { key: string; oldContent: string; newContent: string }[] = [];

  for (const key of relevantKeys) {
    console.log(`\n📄 Checking: ${key}`);
    const asset = await getAsset(shop, THEME_ID, key);

    if (!asset || !asset.value) {
      console.log('   ⚠️ Could not read asset');
      continue;
    }

    let content = asset.value;
    let modified = false;

    // Check for ITALIVIO (case insensitive)
    const italivioMatches = content.match(/italivio/gi);
    if (italivioMatches) {
      console.log(`   🔍 Found "ITALIVIO" ${italivioMatches.length} time(s)`);
      content = content.replace(/italivio/gi, 'MORETTI DALLAS');
      modified = true;
    }

    // Check for email addresses (common patterns)
    const emailPatterns = [
      /support@italivio\.com/gi,
      /info@italivio\.com/gi,
      /contact@italivio\.com/gi,
      /help@italivio\.com/gi,
      /[a-zA-Z0-9._%+-]+@italivio\.[a-zA-Z]{2,}/gi
    ];

    for (const pattern of emailPatterns) {
      const emailMatches = content.match(pattern);
      if (emailMatches) {
        console.log(`   📧 Found email: ${emailMatches.join(', ')}`);
        content = content.replace(pattern, 'support@morettidallas.com');
        modified = true;
      }
    }

    if (modified) {
      filesToUpdate.push({ key, oldContent: asset.value, newContent: content });
    } else {
      console.log('   ✅ No changes needed');
    }
  }

  // Also check sections that might be used by these templates
  const sectionKeys = assets
    .map((a: any) => a.key)
    .filter((key: string) => key.startsWith('sections/'));

  console.log(`\n\n📂 Checking ${sectionKeys.length} section files for ITALIVIO/emails...`);

  for (const key of sectionKeys) {
    const asset = await getAsset(shop, THEME_ID, key);

    if (!asset || !asset.value) continue;

    let content = asset.value;
    let modified = false;
    const changes: string[] = [];

    // Check for ITALIVIO
    const italivioMatches = content.match(/italivio/gi);
    if (italivioMatches) {
      changes.push(`ITALIVIO x${italivioMatches.length}`);
      content = content.replace(/italivio/gi, 'MORETTI DALLAS');
      modified = true;
    }

    // Check for emails
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = content.match(emailPattern);
    if (emails) {
      const relevantEmails = emails.filter((e: string) =>
        e.toLowerCase().includes('italivio') ||
        !e.includes('shopify') && !e.includes('example')
      );
      if (relevantEmails.length > 0) {
        changes.push(`Emails: ${relevantEmails.join(', ')}`);
        relevantEmails.forEach((email: string) => {
          content = content.replace(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'support@morettidallas.com');
        });
        modified = true;
      }
    }

    if (modified) {
      console.log(`   📄 ${key}: ${changes.join(', ')}`);
      filesToUpdate.push({ key, oldContent: asset.value, newContent: content });
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Summary and update
  console.log(`\n\n========================================`);
  console.log(`📝 Files to update: ${filesToUpdate.length}`);
  console.log(`========================================\n`);

  if (filesToUpdate.length === 0) {
    console.log('✅ No files need updating!');
    return;
  }

  console.log('Files that will be modified:');
  filesToUpdate.forEach(f => console.log(`   - ${f.key}`));

  console.log('\n🔄 Updating files...\n');

  let successCount = 0;
  let errorCount = 0;

  for (const file of filesToUpdate) {
    try {
      await updateAsset(shop, THEME_ID, file.key, file.newContent);
      console.log(`✅ Updated: ${file.key}`);
      successCount++;
    } catch (error: any) {
      console.error(`❌ Failed to update ${file.key}: ${error.message}`);
      errorCount++;
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log(`\n========================================`);
  console.log(`✅ Successfully updated: ${successCount}`);
  if (errorCount > 0) {
    console.log(`❌ Failed: ${errorCount}`);
  }
  console.log(`========================================`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
