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

  let hasNextPage = true;
  let cursor: string | null = null;
  let totalProducts = 0;
  let productsWithItalivio = 0;

  while (hasNextPage) {
    const query = `
      query getProducts($first: Int!, $after: String) {
        products(first: 50, after: $after) {
          pageInfo { hasNextPage, endCursor }
          edges {
            node {
              id
              title
              description
              descriptionHtml
              tags
              vendor
              productType
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
        }
      }
    `;

    const result: any = await graphqlQuery(shop, query, { first: 50, after: cursor });
    const products = result.data?.products;

    if (!products) break;

    for (const edge of products.edges) {
      const product = edge.node;
      totalProducts++;

      const fieldsToCheck = [
        { name: 'title', value: product.title },
        { name: 'description', value: product.description },
        { name: 'descriptionHtml', value: product.descriptionHtml },
        { name: 'tags', value: product.tags?.join(', ') },
        { name: 'vendor', value: product.vendor },
        { name: 'productType', value: product.productType },
      ];

      // Check metafields
      for (const mfEdge of product.metafields?.edges || []) {
        const mf = mfEdge.node;
        fieldsToCheck.push({
          name: `metafield:${mf.namespace}.${mf.key}`,
          value: mf.value
        });
      }

      for (const field of fieldsToCheck) {
        if (field.value && field.value.toLowerCase().includes(SEARCH_TERM)) {
          const matches = field.value.match(new RegExp(SEARCH_TERM, 'gi')) || [];
          findings.push({
            location: `Product: "${product.title}" > ${field.name}`,
            context: field.value.substring(0, 100) + (field.value.length > 100 ? '...' : ''),
            count: matches.length
          });
          productsWithItalivio++;
        }
      }
    }

    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;
  }

  console.log(`   Checked ${totalProducts} products`);
  console.log(`   Found ${productsWithItalivio} products with references`);
}

async function checkCollections(shop: any) {
  console.log('\n📁 Checking collections...');

  const query = `
    query {
      collections(first: 100) {
        edges {
          node {
            id
            title
            description
            descriptionHtml
          }
        }
      }
    }
  `;

  const result: any = await graphqlQuery(shop, query);
  const collections = result.data?.collections?.edges || [];

  let found = 0;
  for (const edge of collections) {
    const coll = edge.node;
    const fieldsToCheck = [
      { name: 'title', value: coll.title },
      { name: 'description', value: coll.description },
      { name: 'descriptionHtml', value: coll.descriptionHtml },
    ];

    for (const field of fieldsToCheck) {
      if (field.value && field.value.toLowerCase().includes(SEARCH_TERM)) {
        const matches = field.value.match(new RegExp(SEARCH_TERM, 'gi')) || [];
        findings.push({
          location: `Collection: "${coll.title}" > ${field.name}`,
          context: field.value.substring(0, 100) + (field.value.length > 100 ? '...' : ''),
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
          context: field.value.substring(0, 100) + (field.value.length > 100 ? '...' : ''),
          count: matches.length
        });
        found++;
      }
    }
  }

  console.log(`   Checked ${pages.length} pages`);
  console.log(`   Found ${found} references`);
}

async function checkBlogs(shop: any) {
  console.log('\n📝 Checking blogs and articles...');

  const blogsResponse = await fetch(
    `https://${shop.shop}/admin/api/2024-01/blogs.json`,
    { headers: { 'X-Shopify-Access-Token': shop.accessToken } }
  );
  const blogsData: any = await blogsResponse.json();
  const blogs = blogsData.blogs || [];

  let found = 0;
  let totalArticles = 0;

  for (const blog of blogs) {
    // Check blog title
    if (blog.title && blog.title.toLowerCase().includes(SEARCH_TERM)) {
      findings.push({
        location: `Blog: "${blog.title}"`,
        context: blog.title,
        count: 1
      });
      found++;
    }

    // Check articles
    const articlesResponse = await fetch(
      `https://${shop.shop}/admin/api/2024-01/blogs/${blog.id}/articles.json`,
      { headers: { 'X-Shopify-Access-Token': shop.accessToken } }
    );
    const articlesData: any = await articlesResponse.json();
    const articles = articlesData.articles || [];

    for (const article of articles) {
      totalArticles++;
      const fieldsToCheck = [
        { name: 'title', value: article.title },
        { name: 'body_html', value: article.body_html },
        { name: 'summary_html', value: article.summary_html },
      ];

      for (const field of fieldsToCheck) {
        if (field.value && field.value.toLowerCase().includes(SEARCH_TERM)) {
          const matches = field.value.match(new RegExp(SEARCH_TERM, 'gi')) || [];
          findings.push({
            location: `Article: "${article.title}" > ${field.name}`,
            context: field.value.substring(0, 100) + (field.value.length > 100 ? '...' : ''),
            count: matches.length
          });
          found++;
        }
      }
    }
  }

  console.log(`   Checked ${blogs.length} blogs, ${totalArticles} articles`);
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

    // Check menu title
    if (menu.title && menu.title.toLowerCase().includes(SEARCH_TERM)) {
      findings.push({
        location: `Menu: "${menu.title}"`,
        context: menu.title,
        count: 1
      });
      found++;
    }

    // Check menu items recursively
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

  // Filter for content files (not images, fonts, etc.)
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

      // Rate limiting
      if (checked % 20 === 0) {
        process.stdout.write(`   Progress: ${checked}/${contentAssets.length}\r`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (e) {
      // Skip files that can't be read
    }
  }

  console.log(`   Checked ${checked} files                    `);
  console.log(`   Found ${found} files with references`);
}

async function checkShopSettings(shop: any) {
  console.log('\n⚙️ Checking shop settings...');

  const response = await fetch(
    `https://${shop.shop}/admin/api/2024-01/shop.json`,
    { headers: { 'X-Shopify-Access-Token': shop.accessToken } }
  );
  const data: any = await response.json();
  const shopData = data.shop;

  let found = 0;
  const fieldsToCheck = [
    { name: 'name', value: shopData.name },
    { name: 'email', value: shopData.email },
    { name: 'customer_email', value: shopData.customer_email },
    { name: 'domain', value: shopData.domain },
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

async function checkMetaobjects(shop: any) {
  console.log('\n🗃️ Checking metaobjects...');

  const query = `
    query {
      metaobjectDefinitions(first: 50) {
        edges {
          node {
            id
            type
            name
          }
        }
      }
    }
  `;

  const result: any = await graphqlQuery(shop, query);
  const definitions = result.data?.metaobjectDefinitions?.edges || [];

  let found = 0;
  let totalMetaobjects = 0;

  for (const defEdge of definitions) {
    const def = defEdge.node;

    const metaobjectsQuery = `
      query getMetaobjects($type: String!) {
        metaobjects(type: $type, first: 50) {
          edges {
            node {
              id
              displayName
              fields {
                key
                value
              }
            }
          }
        }
      }
    `;

    const metaobjectsResult: any = await graphqlQuery(shop, metaobjectsQuery, { type: def.type });
    const metaobjects = metaobjectsResult.data?.metaobjects?.edges || [];

    for (const moEdge of metaobjects) {
      const mo = moEdge.node;
      totalMetaobjects++;

      // Check display name
      if (mo.displayName && mo.displayName.toLowerCase().includes(SEARCH_TERM)) {
        findings.push({
          location: `Metaobject (${def.type}): "${mo.displayName}"`,
          context: mo.displayName,
          count: 1
        });
        found++;
      }

      // Check fields
      for (const field of mo.fields || []) {
        if (field.value && field.value.toLowerCase().includes(SEARCH_TERM)) {
          const matches = field.value.match(new RegExp(SEARCH_TERM, 'gi')) || [];
          findings.push({
            location: `Metaobject (${def.type}): "${mo.displayName}" > ${field.key}`,
            context: field.value.substring(0, 100) + (field.value.length > 100 ? '...' : ''),
            count: matches.length
          });
          found++;
        }
      }
    }
  }

  console.log(`   Checked ${totalMetaobjects} metaobjects`);
  console.log(`   Found ${found} references`);
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
  await checkBlogs(shop);
  await checkMenus(shop);
  await checkThemeAssets(shop);
  await checkShopSettings(shop);
  await checkMetaobjects(shop);

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('   AUDIT RESULTS');
  console.log('═══════════════════════════════════════════════════════════');

  if (findings.length === 0) {
    console.log('\n✅ No references to "ITALIVIO" found anywhere in the shop!');
  } else {
    console.log(`\n⚠️ Found ${findings.length} locations with "ITALIVIO" references:\n`);

    // Group by category
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

    // Total count
    const totalOccurrences = findings.reduce((sum, f) => sum + f.count, 0);
    console.log(`\n═══════════════════════════════════════════════════════════`);
    console.log(`   TOTAL: ${findings.length} locations, ${totalOccurrences} occurrences`);
    console.log(`═══════════════════════════════════════════════════════════`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
