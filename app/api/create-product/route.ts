import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { shopifyGraphqlWithRefresh, PRODUCT_CREATE_MUTATION, METAFIELDS_SET_MUTATION, PUBLISH_PRODUCT_MUTATION, GET_PUBLICATIONS_QUERY } from '@/lib/shopify';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      shopId,
      title,
      description,
      price,
      compareAtPrice,
      sku,
      tags,
      templateSuffix = 'landing',
      metafields,
      images,
      options, // Product options for variants (e.g. Size, Color)
    } = body;

    console.log('[CREATE] Received request body:', JSON.stringify(body, null, 2));
    console.log('[CREATE] metafields received:', metafields ? Object.keys(metafields).length : 0, 'keys');
    console.log('[CREATE] Non-empty metafields:', metafields ? Object.entries(metafields).filter(([k, v]) => v !== '' && v !== null && v !== undefined).map(([k]) => k) : []);

    if (!shopId || !title) {
      return NextResponse.json(
        { error: 'Missing required fields: shopId, title' },
        { status: 400 }
      );
    }

    // Get shop credentials
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
    });

    if (!shop) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }

    // Prepare product input (variants are auto-created by Shopify)
    const productInput: any = {
      title,
      descriptionHtml: description || '',
      status: 'ACTIVE',
      templateSuffix,
    };

    // Add tags if provided
    if (tags && Array.isArray(tags) && tags.length > 0) {
      productInput.tags = tags;
    }

    // Create product in Shopify
    const productResult: any = await shopifyGraphqlWithRefresh(
      shop.shop,
      PRODUCT_CREATE_MUTATION,
      { input: productInput }
    );

    if (productResult.productCreate.userErrors.length > 0) {
      return NextResponse.json(
        { error: productResult.productCreate.userErrors },
        { status: 400 }
      );
    }

    const createdProduct = productResult.productCreate.product;
    const productGid = createdProduct.id;

    // Track what was successfully saved
    const savedFields = {
      product: true,
      price: false,
      compareAtPrice: false,
      sku: false,
      metafields: false,
      published: false,
    };
    const warnings: string[] = [];

    // Publish product to ALL sales channels
    try {
      // Get all publications (sales channels)
      const publicationsResult: any = await shopifyGraphqlWithRefresh(
        shop.shop,
        GET_PUBLICATIONS_QUERY
      );

      const publications = publicationsResult.publications?.edges || [];
      const publishedChannels: string[] = [];

      // Publish to ALL available channels
      for (const pub of publications) {
        try {
          await shopifyGraphqlWithRefresh(
            shop.shop,
            PUBLISH_PRODUCT_MUTATION,
            {
              id: productGid,
              input: [{ publicationId: pub.node.id }]
            }
          );
          publishedChannels.push(pub.node.name);
        } catch (e) {
          console.log(`Could not publish to ${pub.node.name}`);
        }
      }

      console.log(`Product published to ${publishedChannels.length} channels:`, publishedChannels.join(', '));
      savedFields.published = publishedChannels.length > 0;
    } catch (publishError) {
      console.error('Error publishing product:', publishError);
      warnings.push('Pubblicazione canali di vendita fallita');
      // Don't fail the request, product is still created
    }

    // Update variant price, compareAtPrice and SKU using REST API
    // This is critical - retry up to 3 times if it fails
    console.log('[CREATE] Price update check - price:', price, 'type:', typeof price, 'compareAtPrice:', compareAtPrice, 'sku:', sku);

    const shouldUpdatePrice = price !== undefined && price !== null && price !== '' && price !== 0;
    const shouldUpdateCompareAt = compareAtPrice !== undefined && compareAtPrice !== null && compareAtPrice !== '' && compareAtPrice !== 0;
    const shouldUpdateSku = sku !== undefined && sku !== null && sku !== '';

    console.log('[CREATE] Should update - price:', shouldUpdatePrice, 'compareAt:', shouldUpdateCompareAt, 'sku:', shouldUpdateSku);

    if (shouldUpdatePrice || shouldUpdateCompareAt || shouldUpdateSku) {
      const variantId = createdProduct.variants.edges[0]?.node?.id;
      console.log('[CREATE] Variant ID from created product:', variantId);
      console.log('[CREATE] All variants:', JSON.stringify(createdProduct.variants.edges, null, 2));

      if (variantId) {
        // Extract numeric ID from GID (gid://shopify/ProductVariant/123 -> 123)
        const numericVariantId = variantId.split('/').pop();
        console.log('[CREATE] Numeric variant ID:', numericVariantId);

        const variantUpdateData: any = {};
        // Shopify expects price as string with decimal (e.g., "49.99")
        if (shouldUpdatePrice) {
          const priceNum = parseFloat(String(price));
          variantUpdateData.price = isNaN(priceNum) ? '0.00' : priceNum.toFixed(2);
          console.log('[CREATE] Formatted price:', variantUpdateData.price);
        }
        if (shouldUpdateCompareAt) {
          const compareNum = parseFloat(String(compareAtPrice));
          variantUpdateData.compare_at_price = isNaN(compareNum) ? null : compareNum.toFixed(2);
          console.log('[CREATE] Formatted compareAtPrice:', variantUpdateData.compare_at_price);
        }
        if (shouldUpdateSku) variantUpdateData.sku = String(sku);

        console.log('[CREATE] Variant update data:', JSON.stringify(variantUpdateData, null, 2));

        const restApiUrl = `https://${shop.shop}/admin/api/2024-01/variants/${numericVariantId}.json`;
        console.log('[CREATE] REST API URL:', restApiUrl);

        // Retry logic for price update
        const maxRetries = 3;
        let lastError = '';

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            console.log(`[CREATE] Attempting price/SKU update (attempt ${attempt}/${maxRetries})...`);
            console.log(`[CREATE] Request body:`, JSON.stringify({ variant: variantUpdateData }));

            const restResponse = await fetch(restApiUrl, {
              method: 'PUT',
              headers: {
                'X-Shopify-Access-Token': shop.accessToken,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                variant: variantUpdateData,
              }),
            });

            console.log('[CREATE] REST response status:', restResponse.status, restResponse.statusText);

            if (restResponse.ok) {
              const responseData = await restResponse.json();
              console.log('[CREATE] Full response data:', JSON.stringify(responseData, null, 2));

              // VERIFY the price was actually saved by checking the response
              const savedPrice = responseData.variant?.price;
              const savedCompareAt = responseData.variant?.compare_at_price;
              const savedSku = responseData.variant?.sku;

              console.log('[CREATE] Saved values - price:', savedPrice, 'compareAt:', savedCompareAt, 'sku:', savedSku);

              // Only mark as saved if the value in response matches what we sent
              if (shouldUpdatePrice) {
                if (savedPrice && parseFloat(savedPrice) === parseFloat(String(price))) {
                  savedFields.price = true;
                  console.log('[CREATE] Price verified as saved correctly');
                } else {
                  console.error('[CREATE] Price mismatch! Sent:', price, 'Got:', savedPrice);
                  lastError = `Prezzo non salvato correttamente (inviato: ${price}, ricevuto: ${savedPrice})`;
                }
              }
              if (shouldUpdateCompareAt) {
                if (savedCompareAt && parseFloat(savedCompareAt) === parseFloat(String(compareAtPrice))) {
                  savedFields.compareAtPrice = true;
                  console.log('[CREATE] CompareAtPrice verified as saved correctly');
                } else {
                  console.error('[CREATE] CompareAtPrice mismatch! Sent:', compareAtPrice, 'Got:', savedCompareAt);
                }
              }
              if (shouldUpdateSku) {
                if (savedSku === String(sku)) {
                  savedFields.sku = true;
                  console.log('[CREATE] SKU verified as saved correctly');
                } else {
                  console.error('[CREATE] SKU mismatch! Sent:', sku, 'Got:', savedSku);
                }
              }

              // If price was verified, break the retry loop
              if (!shouldUpdatePrice || savedFields.price) {
                break;
              }
            } else {
              lastError = await restResponse.text();
              console.error(`[CREATE] Failed to update variant price/SKU (attempt ${attempt}):`, lastError);

              // Wait before retry (exponential backoff)
              if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
              }
            }
          } catch (variantError: any) {
            lastError = variantError.message || 'Network error';
            console.error(`[CREATE] Error updating variant (attempt ${attempt}):`, variantError);

            // Wait before retry
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
          }
        }

        // If all retries failed, add warning
        if (shouldUpdatePrice && !savedFields.price) {
          warnings.push(`Prezzo (€${price}) non salvato: ${lastError}`);
        }
        if (shouldUpdateCompareAt && !savedFields.compareAtPrice) {
          warnings.push(`Prezzo originale (€${compareAtPrice}) non salvato`);
        }
        if (shouldUpdateSku && !savedFields.sku) {
          warnings.push(`SKU (${sku}) non salvato`);
        }
      } else {
        console.error('[CREATE] No variant ID found in created product!');
        warnings.push('Variante non trovata - impossibile salvare prezzi e SKU');
      }
    } else {
      console.log('[CREATE] No price/compareAt/sku to update');
    }

    // Set metafields if provided (only non-empty values)
    // NON passiamo il tipo - Shopify lo inferisce dalla definizione esistente
    if (metafields && Object.keys(metafields).length > 0) {
      const metafieldInputs = Object.entries(metafields)
        .filter(([key, value]) => {
          if (value === '' || value === null || value === undefined) return false;
          return true;
        })
        .map(([key, value]) => ({
          ownerId: productGid,
          namespace: 'landing',
          key,
          value: typeof value === 'string' ? value : JSON.stringify(value),
          // NON includere type - Shopify lo inferisce dalla definizione
        }));

      console.log('[CREATE] Metafields to save (without type):', JSON.stringify(metafieldInputs, null, 2));

      // Only send metafields if there are any after filtering
      if (metafieldInputs.length > 0) {
        const metafieldResult: any = await shopifyGraphqlWithRefresh(
          shop.shop,
          METAFIELDS_SET_MUTATION,
          { metafields: metafieldInputs }
        );

        if (metafieldResult.metafieldsSet.userErrors.length > 0) {
          console.error('[CREATE] Metafield errors:', metafieldResult.metafieldsSet.userErrors);
          const errorMessages = metafieldResult.metafieldsSet.userErrors.map((e: any) => e.message).join(', ');
          warnings.push(`Alcuni metafield non salvati: ${errorMessages}`);
        } else {
          console.log('[CREATE] Metafields saved successfully:', metafieldResult.metafieldsSet.metafields?.length || 0, 'metafields');
          savedFields.metafields = true;
        }
      } else {
        console.log('[CREATE] No metafields to save (all values are empty after filtering)');
        savedFields.metafields = true; // No metafields to save = success
      }
    } else {
      savedFields.metafields = true; // No metafields provided = success
    }

    // Save product to database
    const dbProduct = await prisma.product.create({
      data: {
        shopifyProductId: productGid,
        shopId: shop.id,
        title,
        price,
        sku,
        templateSuffix,
        metafields: metafields || {},
      },
    });

    // Determine overall success - product must be created, and if price was provided it must be saved
    const priceWasRequired = !!price;
    const priceWasSaved = savedFields.price || !priceWasRequired;
    const hasWarnings = warnings.length > 0;

    return NextResponse.json({
      success: true,
      product: {
        id: dbProduct.id,
        shopifyId: productGid,
        title: createdProduct.title,
        handle: createdProduct.handle,
      },
      savedFields,
      warnings: hasWarnings ? warnings : undefined,
      complete: priceWasSaved && savedFields.metafields && warnings.length === 0,
    });
  } catch (error: any) {
    console.error('Create product error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create product' },
      { status: 500 }
    );
  }
}
