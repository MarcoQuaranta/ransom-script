import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SHOP_ID = 'cmkfaa57v0000w8qso46m602i'; // moretti dallas
const OLD_VENDOR = 'Italivio';
const NEW_VENDOR = 'Moretti Dallas';

async function main() {
  console.log('🔄 Connecting to Moretti Dallas shop...\n');

  const shop = await prisma.shop.findUnique({ where: { id: SHOP_ID } });
  if (!shop) {
    console.error('❌ Shop not found');
    return;
  }

  console.log(`✅ Connected to: ${shop.name} (${shop.shop})\n`);

  // Get all products
  console.log('📦 Fetching products...');

  const response = await fetch(
    `https://${shop.shop}/admin/api/2024-01/products.json?limit=250`,
    { headers: { 'X-Shopify-Access-Token': shop.accessToken } }
  );
  const data: any = await response.json();
  const products = data.products || [];

  console.log(`   Found ${products.length} products\n`);

  // Find products with old vendor
  const productsToUpdate = products.filter((p: any) =>
    p.vendor && p.vendor.toLowerCase() === OLD_VENDOR.toLowerCase()
  );

  console.log(`🔍 Found ${productsToUpdate.length} products with vendor "${OLD_VENDOR}":\n`);

  if (productsToUpdate.length === 0) {
    console.log('✅ No products need updating!');
    return;
  }

  productsToUpdate.forEach((p: any, i: number) => {
    console.log(`   ${i + 1}. ${p.title}`);
  });

  // Update vendors
  console.log(`\n🔄 Updating vendors to "${NEW_VENDOR}"...\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const product of productsToUpdate) {
    try {
      const updateResponse = await fetch(
        `https://${shop.shop}/admin/api/2024-01/products/${product.id}.json`,
        {
          method: 'PUT',
          headers: {
            'X-Shopify-Access-Token': shop.accessToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            product: {
              id: product.id,
              vendor: NEW_VENDOR
            }
          })
        }
      );

      if (updateResponse.ok) {
        console.log(`✅ ${product.title}`);
        successCount++;
      } else {
        const error = await updateResponse.text();
        console.error(`❌ ${product.title}: ${error}`);
        errorCount++;
      }
    } catch (error: any) {
      console.error(`❌ ${product.title}: ${error.message}`);
      errorCount++;
    }

    // Rate limiting
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
