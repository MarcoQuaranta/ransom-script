import { prisma } from '../lib/db';
import {
  shopifyGraphqlWithRefresh,
  PRODUCT_CREATE_MUTATION,
  METAFIELDS_SET_MUTATION,
  PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
} from '../lib/shopify';

const SHOP_DOMAIN = 'ransom-9258.myshopify.com';

// Prodotto di esempio completo
const productData = {
  title: 'Orologio Elegante Collection 2024',
  description: `<p>Scopri l'eleganza senza tempo del nostro <strong>Orologio Elegante Collection 2024</strong>.</p>
<p>Realizzato con materiali premium e un design raffinato che si adatta a ogni occasione.</p>`,
  price: '199.99',
  compareAtPrice: '299.99',
  vendor: 'Italivio',
  productType: 'Orologi',
  sku: 'WATCH-2024-001',
};

// Metafield per la landing page (solo i 4 definiti nello shop)
const metafields = {
  titolo_sezione: 'Eleganza Senza Tempo',
  descrizione_sezione: 'Scopri la nuova collezione 2024 di orologi artigianali italiani.\nDesign raffinato, qualità superiore, stile inconfondibile.',
  // foto_sezione e galleria_foto richiedono GID di file caricati su Shopify
  // foto_sezione: 'gid://shopify/MediaImage/...',
  // galleria_foto: '["gid://shopify/MediaImage/...", ...]',
};

async function main() {
  console.log('🚀 Creazione prodotto completo con tutti i metafield...\n');

  // 1. Crea il prodotto
  console.log('1️⃣ Creazione prodotto su Shopify...');

  // Prima crea il prodotto senza varianti
  const createResult = await shopifyGraphqlWithRefresh<any>(
    SHOP_DOMAIN,
    PRODUCT_CREATE_MUTATION,
    {
      input: {
        title: productData.title,
        descriptionHtml: productData.description,
        vendor: productData.vendor,
        productType: productData.productType,
        templateSuffix: 'landing',
        status: 'ACTIVE',
      }
    }
  );

  if (createResult.productCreate.userErrors?.length > 0) {
    console.error('❌ Errori:', createResult.productCreate.userErrors);
    return;
  }

  const product = createResult.productCreate.product;
  console.log(`   ✅ Prodotto creato: ${product.title}`);
  console.log(`   ID: ${product.id}`);
  console.log(`   Handle: ${product.handle}`);

  // 1b. Aggiorna la variante con prezzo (senza sku - API limitation)
  if (product.variants?.edges?.[0]) {
    const variantId = product.variants.edges[0].node.id;
    console.log('\n1️⃣b Aggiornamento prezzo variante...');

    try {
      await shopifyGraphqlWithRefresh<any>(
        SHOP_DOMAIN,
        PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
        {
          productId: product.id,
          variants: [{
            id: variantId,
            price: productData.price,
            compareAtPrice: productData.compareAtPrice,
          }]
        }
      );
      console.log(`   ✅ Prezzo aggiornato: €${productData.price}`);
    } catch (e) {
      console.log(`   ⚠️ Aggiornamento prezzo saltato (API limitation)`);
    }
  }

  // 2. Aggiungi tutti i metafield
  console.log('\n2️⃣ Aggiunta metafield...');

  // Mappa tipo per ogni metafield definito
  const metafieldTypes: Record<string, string> = {
    titolo_sezione: 'single_line_text_field',
    descrizione_sezione: 'multi_line_text_field',
    foto_sezione: 'file_reference',
    galleria_foto: 'list.file_reference',
  };

  const metafieldInputs = Object.entries(metafields).map(([key, value]) => ({
    ownerId: product.id,
    namespace: 'landing',
    key,
    value: String(value),
    type: metafieldTypes[key] || 'single_line_text_field',
  }));

  const metaResult = await shopifyGraphqlWithRefresh<any>(
    SHOP_DOMAIN,
    METAFIELDS_SET_MUTATION,
    { metafields: metafieldInputs }
  );

  let totalSaved = 0;
  if (metaResult.metafieldsSet.userErrors?.length > 0) {
    console.error('   ⚠️ Errori metafield:', metaResult.metafieldsSet.userErrors);
  } else {
    totalSaved = metafieldInputs.length;
    console.log(`   ✅ ${totalSaved} metafield salvati`);
  }

  // 3. Salva nel database locale
  console.log('\n3️⃣ Salvataggio nel database locale...');

  const shop = await prisma.shop.findUnique({
    where: { shop: SHOP_DOMAIN }
  });

  if (shop) {
    await prisma.product.create({
      data: {
        shopifyProductId: product.id,
        shopId: shop.id,
        title: productData.title,
        handle: product.handle,
        price: parseFloat(productData.price),
        sku: productData.sku,
        templateSuffix: 'landing',
        metafields: metafields,
      }
    });
    console.log('   ✅ Salvato nel database locale');
  }

  // Riepilogo
  console.log('\n' + '='.repeat(50));
  console.log('✅ PRODOTTO CREATO CON SUCCESSO!');
  console.log('='.repeat(50));
  console.log(`\n📦 Prodotto: ${productData.title}`);
  console.log(`💰 Prezzo: €${productData.price} (era €${productData.compareAtPrice})`);
  console.log(`📝 Metafield: ${totalSaved} campi compilati`);
  console.log(`\n🔗 URL Landing Page:`);
  console.log(`   https://${SHOP_DOMAIN}/products/${product.handle}`);
  console.log(`\n🔗 URL Admin:`);
  console.log(`   https://admin.shopify.com/store/ransom-9258/products/${product.id.split('/').pop()}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
