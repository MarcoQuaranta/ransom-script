import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SHOP_ID = 'cmkfaa57v0000w8qso46m602i'; // moretti dallas
const THEME_ID = '193980629330'; // main theme
const SEARCH_TERM = 'italivio';

interface Finding {
  location: string;
  context: string;
  count: number;
}

const findings: Finding[] = [];

async function graphqlQuery(shop: any, query: string, variables?: any) {
  const response = await fetch(`https://${shop.shop}/admin/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': shop.accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  return response.json();
}

async function checkProducts(shop: any) {
  console.log('\n📦 Checking products...');

  // Use REST API for more reliable product fetching
  let products: any[] = [];
  let url = `https://${shop.shop}/admin/api/2024-01/products.json?limit=250`;

  while (url) {
    const response = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': shop.accessToken }
    });
    const data: any = await response.json();
    products = products.concat(data.products || []);

    // Check for pagination
    const linkHeader = response.headers.get('link');
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      url = match ? match[1] : '';
    } else {
      url = '';
    }
  }

  console.log(`   Found ${products.length} products`);

  let productsWithItalivio = 0;

  for (const product of products) {
    const fieldsToCheck = [
      { name: 'title', value: product.title },
      { name: 'body_html', value: product.body_html },
      { name: 'vendor', value: product.vendor },
      { name: 'product_type', value: product.product_type },
      { name: 'tags', value: product.tags },
    ];

    // Check variants
    for (const variant of product.variants || []) {
      fieldsToCheck.push({ name: `variant:${variant.title}`, value: variant.title });
    }

    let foundInProduct = false;
    for (const field of fieldsToCheck) {
      if (field.value && field.value.toLowerCase().includes(SEARCH_TERM)) {
        const matches = field.value.match(new RegExp(SEARCH_TERM, 'gi')) || [];
        findings.push({
          location: `Product: "${product.title}" > ${field.name}`,
          context: String(field.value).substring(0, 100) + (String(field.value).length > 100 ? '...' : ''),
          count: matches.length
        });
        foundInProduct = true;
      }
    }

    if (foundInProduct) productsWithItalivio++;
  }

  // Also check product metafields via GraphQL
  console.log('   Checking product metafields...');

  for (const product of products) {
    const query = `
      query getProductMetafields($id: ID!) {
        product(id: $id) {
          metafields(first: 50) {
            edges {
              node {
                namespace
                key
                value
              }
            }
          }
        }
      }
    `;

    const gid = `gid://shopify/Product/${product.id}`;
    const result: any = await graphqlQuery(shop, query, { id: gid });

    for (const edge of result.data?.product?.metafields?.edges || []) {
      const mf = edge.node;
      if (mf.value && mf.value.toLowerCase().includes(SEARCH_TERM)) {
        const matches = mf.value.match(new RegExp(SEARCH_TERM, 'gi')) || [];
        findings.push({
          location: `Product: "${product.title}" > metafield:${mf.namespace}.${mf.key}`,
          context: mf.value.substring(0, 100) + (mf.value.length > 100 ? '...' : ''),
          count: matches.length
        });
      }
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log(`   Found references in ${productsWithItalivio} products`);
}

async function checkCollections(shop: any) {
  console.log('\n📁 Checking collections...');

  const response = await fetch(
    `https://${shop.shop}/admin/api/2024-01/custom_collections.json?limit=250`,
    { headers: { 'X-Shopify-Access-Token': shop.accessToken } }
  );
  const data: any = await response.json();

  const response2 = await fetch(
    `https://${shop.shop}/admin/api/2024-01/smart_collections.json?limit=250`,
    { headers: { 'X-Shopify-Access-Token': shop.accessToken } }
  );
  const data2: any = await response2.json();

  const collections = [...(data.custom_collections || []), ...(data2.smart_collections || [])];

  let found = 0;
  for (const coll of collections) {
    const fieldsToCheck = [
      { name: 'title', value: coll.title },
      { name: 'body_html', value: coll.body_html },
    ];

    for (const field of fieldsToCheck) {
      if (field.value && field.value.toLowerCase().includes(SEARCH_TERM)) {
        const matches = field.value.match(new RegExp(SEARCH_TERM, 'gi')) || [];
        findings.push({
          location: `Collection: "${coll.title}" > ${field.name}`,
          context: String(field.value).substring(0, 100),
          count: matches.length
        });
        found++;
      }
    }
  }

  console.log(`   Checked ${collections.length} collections`);
  console.log(`   Found ${found} references`);
}

async function checkPages(shop: any) {
  console.log('\n📄 Checking pages...');

  const response = await fetch(
    `https://${shop.shop}/admin/api/2024-01/pages.json`,
    { headers: { 'X-Shopify-Access-Token': shop.accessToken } }
  );
  const data: any = await response.json();
  const pages = data.pages || [];

  let found = 0;
  for (const page of pages) {
    const fieldsToCheck = [
      { name: 'title', value: page.title },
      { name: 'body_html', value: page.body_html },
    ];

    for (const field of fieldsToCheck) {
      if (field.value && field.value.toLowerCase().includes(SEARCH_TERM)) {
        const matches = field.value.match(new RegExp(SEARCH_TERM, 'gi')) || [];
        findings.push({
          location: `Page: "${page.title}" > ${field.name}`,
          context: String(field.value).substring(0, 100),
          count: matches.length
        });
        found++;
      }
    }
  }

  console.log(`   Checked ${pages.length} pages`);
  console.log(`   Found ${found} references`);
}

async function checkMenus(shop: any) {
  console.log('\n🔗 Checking navigation menus...');

  const query = `
    query {
      menus(first: 20) {
        edges {
          node {
            id
            title
            handle
            items {
              id
              title
              url
              items {
                id
                title
                url
              }
            }
          }
        }
      }
    }
  `;

  const result: any = await graphqlQuery(shop, query);
  const menus = result.data?.menus?.edges || [];

  let found = 0;
  for (const edge of menus) {
    const menu = edge.node;

    if (menu.title && menu.title.toLowerCase().includes(SEARCH_TERM)) {
      findings.push({
        location: `Menu: "${menu.title}"`,
        context: menu.title,
        count: 1
      });
      found++;
    }

    const checkItems = (items: any[], parentPath: string) => {
      for (const item of items || []) {
        if (item.title && item.title.toLowerCase().includes(SEARCH_TERM)) {
          findings.push({
            location: `Menu item: ${parentPath} > "${item.title}"`,
            context: item.title,
            count: 1
          });
          found++;
        }
        if (item.items) {
          checkItems(item.items, `${parentPath} > "${item.title}"`);
        }
      }
    };

    checkItems(menu.items, `Menu: "${menu.title}"`);
  }

  console.log(`   Checked ${menus.length} menus`);
  console.log(`   Found ${found} references`);
}

async function checkThemeAssets(shop: any) {
  console.log('\n🎨 Checking theme assets...');

  const response = await fetch(
    `https://${shop.shop}/admin/api/2024-01/themes/${THEME_ID}/assets.json`,
    { headers: { 'X-Shopify-Access-Token': shop.accessToken } }
  );
  const data: any = await response.json();
  const assets = data.assets || [];

  const contentAssets = assets.filter((a: any) =>
    a.key.endsWith('.json') ||
    a.key.endsWith('.liquid') ||
    a.key.endsWith('.css') ||
    a.key.endsWith('.js')
  );

  console.log(`   Checking ${contentAssets.length} content files...`);

  let found = 0;
  let checked = 0;

  for (const asset of contentAssets) {
    try {
      const assetResponse = await fetch(
        `https://${shop.shop}/admin/api/2024-01/themes/${THEME_ID}/assets.json?asset[key]=${encodeURIComponent(asset.key)}`,
        { headers: { 'X-Shopify-Access-Token': shop.accessToken } }
      );
      const assetData: any = await assetResponse.json();

      if (assetData.asset?.value) {
        const content = assetData.asset.value;
        if (content.toLowerCase().includes(SEARCH_TERM)) {
          const matches = content.match(new RegExp(SEARCH_TERM, 'gi')) || [];
          findings.push({
            location: `Theme file: ${asset.key}`,
            context: `Contains ${matches.length} occurrence(s)`,
            count: matches.length
          });
          found++;
        }
      }

      checked++;

      if (checked % 50 === 0) {
        console.log(`   Progress: ${checked}/${contentAssets.length}`);
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (e) {
      // Skip files that can't be read
    }
  }

  console.log(`   Checked ${checked} files`);
  console.log(`   Found ${found} files with references`);
}

async function checkShopInfo(shop: any) {
  console.log('\n⚙️ Checking shop info...');

  try {
    const response = await fetch(
      `https://${shop.shop}/admin/api/2024-01/shop.json`,
      { headers: { 'X-Shopify-Access-Token': shop.accessToken } }
    );
    const data: any = await response.json();

    if (data.shop) {
      const shopData = data.shop;
      let found = 0;

      const fieldsToCheck = [
        { name: 'name', value: shopData.name },
        { name: 'email', value: shopData.email },
        { name: 'customer_email', value: shopData.customer_email },
      ];

      for (const field of fieldsToCheck) {
        if (field.value && field.value.toLowerCase().includes(SEARCH_TERM)) {
          findings.push({
            location: `Shop setting: ${field.name}`,
            context: field.value,
            count: 1
          });
          found++;
        }
      }

      console.log(`   Found ${found} references in shop settings`);
    }
  } catch (e) {
    console.log('   Could not check shop settings');
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   ITALIVIO Reference Audit - Moretti Dallas Shop');
  console.log('═══════════════════════════════════════════════════════════');

  const shop = await prisma.shop.findUnique({ where: { id: SHOP_ID } });
  if (!shop) {
    console.error('❌ Shop not found');
    return;
  }

  console.log(`\n🏪 Shop: ${shop.name} (${shop.shop})`);
  console.log(`🔍 Searching for: "${SEARCH_TERM}" (case insensitive)`);

  await checkProducts(shop);
  await checkCollections(shop);
  await checkPages(shop);
  await checkMenus(shop);
  await checkThemeAssets(shop);
  await checkShopInfo(shop);

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('   AUDIT RESULTS');
  console.log('═══════════════════════════════════════════════════════════');

  if (findings.length === 0) {
    console.log('\n✅ No references to "ITALIVIO" found anywhere in the shop!');
  } else {
    console.log(`\n⚠️ Found ${findings.length} locations with "ITALIVIO" references:\n`);

    const grouped: Record<string, Finding[]> = {};
    for (const f of findings) {
      const category = f.location.split(':')[0];
      if (!grouped[category]) grouped[category] = [];
      grouped[category].push(f);
    }

    for (const [category, items] of Object.entries(grouped)) {
      console.log(`\n📌 ${category} (${items.length} found):`);
      for (const item of items) {
        console.log(`   • ${item.location}`);
        console.log(`     Context: "${item.context}"`);
        console.log(`     Occurrences: ${item.count}`);
      }
    }

    const totalOccurrences = findings.reduce((sum, f) => sum + f.count, 0);
    console.log(`\n═══════════════════════════════════════════════════════════`);
    console.log(`   TOTAL: ${findings.length} locations, ${totalOccurrences} occurrences`);
    console.log(`═══════════════════════════════════════════════════════════`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
