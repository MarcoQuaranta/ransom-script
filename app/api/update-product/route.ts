import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { shopifyGraphqlWithRefresh, METAFIELDS_SET_MUTATION, PRODUCT_UPDATE_MUTATION } from '@/lib/shopify';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('[UPDATE] Received request body:', JSON.stringify(body, null, 2));

    const {
      productId,
      shopId,
      title,
      description,
      price,
      compareAtPrice,
      sku,
      tags,
      metafields,
    } = body;

    console.log('[UPDATE] productId:', productId);
    console.log('[UPDATE] shopId:', shopId);

    if (!productId || !shopId) {
      return NextResponse.json(
        { error: 'Missing required fields: productId, shopId' },
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

    // Get product from DB - try by local ID first, then by Shopify ID
    let product = await prisma.product.findUnique({
      where: { id: productId },
    });

    // If not found by local ID, try by Shopify ID
    if (!product) {
      product = await prisma.product.findFirst({
        where: { shopifyProductId: productId },
      });
    }

    // Track what was successfully saved
    const savedFields = {
      product: false,
      price: false,
      compareAtPrice: false,
      sku: false,
      metafields: false,
    };
    const warnings: string[] = [];

    // If still not found, create a local record for this Shopify product
    let shopifyProductId = productId;
    if (!product) {
      // productId is the Shopify GID, use it directly
      if (productId.startsWith('gid://shopify/Product/')) {
        shopifyProductId = productId;
        // Create local record
        product = await prisma.product.create({
          data: {
            shopifyProductId: productId,
            shopId: shop.id,
            title: title || 'Untitled',
            metafields: metafields || {},
          },
        });
        console.log('[UPDATE] Created local product record for Shopify product:', productId);
      } else {
        return NextResponse.json({ error: 'Product not found' }, { status: 404 });
      }
    } else {
      shopifyProductId = product.shopifyProductId;
    }

    // Update product basic info if provided
    if (title || description !== undefined || tags) {
      const productInput: any = {
        id: shopifyProductId,
      };
      if (title) productInput.title = title;
      if (description !== undefined) productInput.descriptionHtml = description;
      if (tags && Array.isArray(tags)) productInput.tags = tags;

      const productResult: any = await shopifyGraphqlWithRefresh(
        shop.shop,
        PRODUCT_UPDATE_MUTATION,
        { input: productInput }
      );

      if (productResult.productUpdate.userErrors.length > 0) {
        return NextResponse.json(
          { error: productResult.productUpdate.userErrors },
          { status: 400 }
        );
      }
      savedFields.product = true;
    } else {
      savedFields.product = true; // No basic fields to update = success
    }

    // Update variant price, compareAtPrice and SKU using REST API
    // This is critical - retry up to 3 times if it fails
    console.log('[UPDATE] Price update check - price:', price, 'type:', typeof price, 'compareAtPrice:', compareAtPrice, 'sku:', sku);

    const shouldUpdatePrice = price !== undefined && price !== null && price !== '' && price !== 0;
    const shouldUpdateCompareAt = compareAtPrice !== undefined && compareAtPrice !== null && compareAtPrice !== '' && compareAtPrice !== 0;
    const shouldUpdateSku = sku !== undefined && sku !== null && sku !== '';

    console.log('[UPDATE] Should update - price:', shouldUpdatePrice, 'compareAt:', shouldUpdateCompareAt, 'sku:', shouldUpdateSku);

    if (shouldUpdatePrice || shouldUpdateCompareAt || shouldUpdateSku) {
      // First get the variant ID from Shopify
      const getProductQuery = `
        query getProduct($id: ID!) {
          product(id: $id) {
            variants(first: 1) {
              edges {
                node {
                  id
                }
              }
            }
          }
        }
      `;

      const productData: any = await shopifyGraphqlWithRefresh(
        shop.shop,
        getProductQuery,
        { id: shopifyProductId }
      );

      const variantId = productData.product?.variants?.edges[0]?.node?.id;
      console.log('[UPDATE] Variant ID:', variantId);

      if (variantId) {
        const numericVariantId = variantId.split('/').pop();
        console.log('[UPDATE] Numeric variant ID:', numericVariantId);

        const variantUpdateData: any = {};
        // Shopify expects price as string with decimal (e.g., "49.99")
        if (shouldUpdatePrice) {
          const priceNum = parseFloat(String(price));
          variantUpdateData.price = isNaN(priceNum) ? '0.00' : priceNum.toFixed(2);
          console.log('[UPDATE] Formatted price:', variantUpdateData.price);
        }
        if (shouldUpdateCompareAt) {
          const compareNum = parseFloat(String(compareAtPrice));
          variantUpdateData.compare_at_price = isNaN(compareNum) ? null : compareNum.toFixed(2);
          console.log('[UPDATE] Formatted compareAtPrice:', variantUpdateData.compare_at_price);
        }
        if (shouldUpdateSku) variantUpdateData.sku = String(sku);

        console.log('[UPDATE] Variant update data:', JSON.stringify(variantUpdateData, null, 2));

        const restApiUrl = `https://${shop.shop}/admin/api/2024-01/variants/${numericVariantId}.json`;
        console.log('[UPDATE] REST API URL:', restApiUrl);

        // Retry logic for price update
        const maxRetries = 3;
        let lastError = '';

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            console.log(`[UPDATE] Attempting price/SKU update (attempt ${attempt}/${maxRetries})...`);
            console.log(`[UPDATE] Request body:`, JSON.stringify({ variant: variantUpdateData }));

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

            console.log('[UPDATE] REST response status:', restResponse.status, restResponse.statusText);

            if (restResponse.ok) {
              const responseData = await restResponse.json();
              console.log('[UPDATE] Full response data:', JSON.stringify(responseData, null, 2));

              // VERIFY the price was actually saved by checking the response
              const savedPrice = responseData.variant?.price;
              const savedCompareAt = responseData.variant?.compare_at_price;
              const savedSku = responseData.variant?.sku;

              console.log('[UPDATE] Saved values - price:', savedPrice, 'compareAt:', savedCompareAt, 'sku:', savedSku);

              // Only mark as saved if the value in response matches what we sent
              if (shouldUpdatePrice) {
                if (savedPrice && parseFloat(savedPrice) === parseFloat(String(price))) {
                  savedFields.price = true;
                  console.log('[UPDATE] Price verified as saved correctly');
                } else {
                  console.error('[UPDATE] Price mismatch! Sent:', price, 'Got:', savedPrice);
                  lastError = `Prezzo non salvato correttamente (inviato: ${price}, ricevuto: ${savedPrice})`;
                }
              }
              if (shouldUpdateCompareAt) {
                if (savedCompareAt && parseFloat(savedCompareAt) === parseFloat(String(compareAtPrice))) {
                  savedFields.compareAtPrice = true;
                  console.log('[UPDATE] CompareAtPrice verified as saved correctly');
                } else {
                  console.error('[UPDATE] CompareAtPrice mismatch! Sent:', compareAtPrice, 'Got:', savedCompareAt);
                }
              }
              if (shouldUpdateSku) {
                if (savedSku === String(sku)) {
                  savedFields.sku = true;
                  console.log('[UPDATE] SKU verified as saved correctly');
                } else {
                  console.error('[UPDATE] SKU mismatch! Sent:', sku, 'Got:', savedSku);
                }
              }

              // If price was verified, break the retry loop
              if (!shouldUpdatePrice || savedFields.price) {
                break;
              }
            } else {
              lastError = await restResponse.text();
              console.error(`[UPDATE] Failed to update variant price/SKU (attempt ${attempt}):`, lastError);

              // Wait before retry (exponential backoff)
              if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
              }
            }
          } catch (variantError: any) {
            lastError = variantError.message || 'Network error';
            console.error(`[UPDATE] Error updating variant (attempt ${attempt}):`, variantError);

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
        console.error('[UPDATE] No variant ID found!');
        warnings.push('Variante non trovata - impossibile salvare prezzi e SKU');
      }
    } else {
      console.log('[UPDATE] No price/compareAt/sku to update');
    }

    // Update metafields if provided (only non-empty values)
    // NON passiamo il tipo - Shopify lo inferisce dalla definizione esistente
    if (metafields && Object.keys(metafields).length > 0) {
      const metafieldInputs = Object.entries(metafields)
        .filter(([key, value]) => {
          if (value === '' || value === null || value === undefined) return false;
          return true;
        })
        .map(([key, value]) => ({
          ownerId: shopifyProductId,
          namespace: 'custom',
          key,
          value: typeof value === 'string' ? value : JSON.stringify(value),
          // NON includere type - Shopify lo inferisce dalla definizione
        }));

      console.log('[UPDATE] Metafields to save:', JSON.stringify(metafieldInputs, null, 2));

      // Only send metafields if there are any after filtering
      if (metafieldInputs.length > 0) {
        const metafieldResult: any = await shopifyGraphqlWithRefresh(
          shop.shop,
          METAFIELDS_SET_MUTATION,
          { metafields: metafieldInputs }
        );

        console.log('[UPDATE] Metafield result:', JSON.stringify(metafieldResult, null, 2));

        if (metafieldResult.metafieldsSet.userErrors.length > 0) {
          console.error('[UPDATE] Metafield errors:', metafieldResult.metafieldsSet.userErrors);
          const errorMessages = metafieldResult.metafieldsSet.userErrors.map((e: any) => e.message).join(', ');
          warnings.push(`Alcuni metafield non salvati: ${errorMessages}`);
        } else {
          console.log('[UPDATE] Metafields saved successfully:', metafieldResult.metafieldsSet.metafields?.length || 0);
          savedFields.metafields = true;
        }
      } else {
        console.log('[UPDATE] No metafields to update (all values are empty)');
        savedFields.metafields = true; // No metafields to save = success
      }
    } else {
      savedFields.metafields = true; // No metafields provided = success
    }

    // Update product in database (use local product ID)
    if (product) {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          ...(title && { title }),
          ...(price && { price }),
          ...(sku && { sku }),
          ...(metafields && { metafields }),
        },
      });
    }

    // Determine overall success
    const priceWasRequired = !!price;
    const priceWasSaved = savedFields.price || !priceWasRequired;
    const hasWarnings = warnings.length > 0;

    return NextResponse.json({
      success: true,
      message: 'Product updated successfully',
      savedFields,
      warnings: hasWarnings ? warnings : undefined,
      complete: priceWasSaved && savedFields.metafields && warnings.length === 0,
    });
  } catch (error: any) {
    console.error('Update product error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update product' },
      { status: 500 }
    );
  }
}
