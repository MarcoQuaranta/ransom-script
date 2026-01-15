import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  shopifyGraphqlWithRefresh,
  PRODUCT_VARIANTS_BULK_CREATE_MUTATION,
  PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
  PRODUCT_VARIANT_DELETE_MUTATION,
  PRODUCT_VARIANTS_QUERY,
  PRODUCT_OPTIONS_CREATE_MUTATION,
  PRODUCT_OPTION_DELETE_MUTATION,
  PRODUCT_OPTION_UPDATE_MUTATION,
  PRODUCT_VARIANTS_BULK_DELETE_MUTATION,
  INVENTORY_ITEM_UPDATE_MUTATION,
} from '@/lib/shopify';
import { VariantCombination, VariantOption } from '@/types/shopify';
import { generateVariantCombinations, validateVariantOptions } from '@/lib/variants';

// GET - Fetch variants for a product
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get('shopId');
  const productId = searchParams.get('productId');

  if (!shopId || !productId) {
    return NextResponse.json(
      { success: false, error: 'shopId e productId sono richiesti' },
      { status: 400 }
    );
  }

  try {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
    });

    if (!shop) {
      return NextResponse.json(
        { success: false, error: 'Shop non trovato' },
        { status: 404 }
      );
    }

    // Fetch variants from Shopify
    const response: any = await shopifyGraphqlWithRefresh(
      shop.shop,
      PRODUCT_VARIANTS_QUERY,
      { id: productId }
    );

    const product = response.product;
    if (!product) {
      return NextResponse.json(
        { success: false, error: 'Prodotto non trovato' },
        { status: 404 }
      );
    }

    const options: VariantOption[] = product.options.map((opt: any) => ({
      name: opt.name,
      values: opt.values,
    }));

    const variants: VariantCombination[] = product.variants.edges.map((edge: any) => ({
      id: edge.node.id,
      options: edge.node.selectedOptions.reduce((acc: Record<string, string>, opt: any) => {
        acc[opt.name] = opt.value;
        return acc;
      }, {}),
      price: edge.node.price,
      compareAtPrice: edge.node.compareAtPrice,
      sku: edge.node.sku,
      inventoryQuantity: edge.node.inventoryQuantity,
    }));

    return NextResponse.json({
      success: true,
      options,
      variants,
    });
  } catch (error: any) {
    console.error('Error fetching variants:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// POST - Create variants for a product
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { shopId, productId, options, variants } = body;

    console.log('[VARIANTS API] Received request:');
    console.log('[VARIANTS API] shopId:', shopId);
    console.log('[VARIANTS API] productId:', productId);
    console.log('[VARIANTS API] options:', JSON.stringify(options, null, 2));
    console.log('[VARIANTS API] variants:', JSON.stringify(variants, null, 2));

    if (!shopId || !productId) {
      return NextResponse.json(
        { success: false, error: 'shopId e productId sono richiesti' },
        { status: 400 }
      );
    }

    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
    });

    if (!shop) {
      return NextResponse.json(
        { success: false, error: 'Shop non trovato' },
        { status: 404 }
      );
    }

    // Validate options
    if (options && options.length > 0) {
      const validation = validateVariantOptions(options);
      if (!validation.valid) {
        return NextResponse.json(
          { success: false, error: validation.error },
          { status: 400 }
        );
      }
    }

    // Step 1: Check existing product options and handle mismatches
    // We need to properly sync options before creating variants
    if (options && options.length > 0) {
      // First, fetch the product's current state
      const currentProductResponse: any = await shopifyGraphqlWithRefresh(
        shop.shop,
        PRODUCT_VARIANTS_QUERY,
        { id: productId }
      );

      const currentProduct = currentProductResponse.product;
      const currentOptions = currentProduct?.options || [];
      const currentVariants = currentProduct?.variants?.edges || [];

      console.log('[VARIANTS API] Current options:', JSON.stringify(currentOptions, null, 2));
      console.log('[VARIANTS API] Current variants count:', currentVariants.length);

      // Check if current options match what we want
      const wantedOptionNames = (options as VariantOption[]).map((o) => o.name);
      const currentOptionNames = currentOptions.map((o: any) => o.name);

      // Check if it's just the default "Title" option with "Default Title" value
      const isDefaultOnly =
        currentOptions.length === 1 &&
        currentOptions[0].name === 'Title' &&
        currentOptions[0].values?.length === 1 &&
        currentOptions[0].values[0] === 'Default Title';

      // Check if options match what we want to create
      const optionsMatch =
        currentOptionNames.length === wantedOptionNames.length &&
        currentOptionNames.every((name: string, i: number) => name === wantedOptionNames[i]);

      console.log('[VARIANTS API] Is default only:', isDefaultOnly);
      console.log('[VARIANTS API] Options match:', optionsMatch);

      // If options don't match, we need to reset them
      if (!optionsMatch) {
        console.log('[VARIANTS API] Options mismatch - need to reset product options');

        // Step 1a: Delete all existing variants (keep at least one if Shopify requires it)
        if (currentVariants.length > 0) {
          // Delete all variants except possibly one (we'll create new ones)
          const variantIdsToDelete = currentVariants.map((edge: any) => edge.node.id);

          // Shopify requires at least one variant, so we might need to be careful here
          // Delete in batches if there are many
          console.log('[VARIANTS API] Deleting', variantIdsToDelete.length, 'existing variants');

          try {
            const deleteResponse: any = await shopifyGraphqlWithRefresh(
              shop.shop,
              PRODUCT_VARIANTS_BULK_DELETE_MUTATION,
              {
                productId,
                variantsIds: variantIdsToDelete,
              }
            );

            if (deleteResponse.productVariantsBulkDelete?.userErrors?.length > 0) {
              console.warn('[VARIANTS API] Variant delete warnings:', deleteResponse.productVariantsBulkDelete.userErrors);
              // Don't fail - continue with what we can do
            }
          } catch (delErr: any) {
            console.warn('[VARIANTS API] Could not delete variants:', delErr.message);
            // Continue anyway
          }
        }

        // Step 1b: Delete existing options that don't match
        for (const existingOption of currentOptions) {
          // Skip if this option name is in our wanted options
          if (wantedOptionNames.includes(existingOption.name)) {
            continue;
          }

          console.log('[VARIANTS API] Deleting option:', existingOption.name, existingOption.id);

          try {
            const deleteOptResponse: any = await shopifyGraphqlWithRefresh(
              shop.shop,
              PRODUCT_OPTION_DELETE_MUTATION,
              {
                productId,
                optionId: existingOption.id,
              }
            );

            if (deleteOptResponse.productOptionDelete?.userErrors?.length > 0) {
              console.warn('[VARIANTS API] Option delete warnings:', deleteOptResponse.productOptionDelete.userErrors);
            }
          } catch (optDelErr: any) {
            console.warn('[VARIANTS API] Could not delete option:', optDelErr.message);
          }
        }

        // Step 1c: Create new options
        const optionInputs = (options as VariantOption[]).map((opt, index) => ({
          name: opt.name,
          position: index + 1,
          values: opt.values.map((v) => ({ name: v })),
        }));

        console.log('[VARIANTS API] Creating new options:', JSON.stringify(optionInputs, null, 2));

        try {
          const optionsResponse: any = await shopifyGraphqlWithRefresh(
            shop.shop,
            PRODUCT_OPTIONS_CREATE_MUTATION,
            {
              productId,
              options: optionInputs,
            }
          );

          console.log('[VARIANTS API] Options create response:', JSON.stringify(optionsResponse, null, 2));

          if (optionsResponse.productOptionsCreate?.userErrors?.length > 0) {
            const errors = optionsResponse.productOptionsCreate.userErrors;
            // Ignore "already exists" errors
            const realErrors = errors.filter((e: any) => !e.message?.includes('already exists'));
            if (realErrors.length > 0) {
              console.error('[VARIANTS API] Options creation errors:', realErrors);
              return NextResponse.json(
                { success: false, error: realErrors[0].message },
                { status: 400 }
              );
            }
          }
        } catch (optErr: any) {
          console.error('[VARIANTS API] Options creation exception:', optErr);
          return NextResponse.json(
            { success: false, error: `Errore creazione opzioni: ${optErr.message}` },
            { status: 500 }
          );
        }
      } else {
        // Options match - we may just need to add missing values
        console.log('[VARIANTS API] Options match - checking if values need updating');

        // Update each option with any missing values
        for (let i = 0; i < (options as VariantOption[]).length; i++) {
          const wantedOption = (options as VariantOption[])[i];
          const existingOption = currentOptions.find((o: any) => o.name === wantedOption.name);

          if (existingOption) {
            const existingValues = existingOption.values || [];
            const missingValues = wantedOption.values.filter((v) => !existingValues.includes(v));

            if (missingValues.length > 0) {
              console.log(`[VARIANTS API] Adding missing values to ${wantedOption.name}:`, missingValues);

              // Add missing values via option update
              const allValues = [...existingValues, ...missingValues];
              try {
                await shopifyGraphqlWithRefresh(shop.shop, PRODUCT_OPTION_UPDATE_MUTATION, {
                  productId,
                  optionId: existingOption.id,
                  option: {
                    values: allValues.map((v: string) => ({ name: v })),
                  },
                });
              } catch (updateErr: any) {
                console.warn('[VARIANTS API] Could not update option values:', updateErr.message);
              }
            }
          }
        }
      }
    }

    // Step 2: Fetch existing variants
    const existingVariantsResponse: any = await shopifyGraphqlWithRefresh(
      shop.shop,
      PRODUCT_VARIANTS_QUERY,
      { id: productId }
    );

    const existingVariants = existingVariantsResponse.product?.variants?.edges || [];
    console.log('[VARIANTS API] Existing variants:', existingVariants.length);

    // Build a set of existing variant option combinations for quick lookup
    const existingCombinations = new Set(
      existingVariants.map((edge: any) => {
        const opts = edge.node.selectedOptions.map((o: any) => `${o.name}:${o.value}`).sort().join('|');
        return opts;
      })
    );

    // Step 3: Separate variants into "to create" and "to update"
    const variantsToCreate: any[] = [];
    const variantsToUpdate: any[] = [];

    for (const variant of variants as VariantCombination[]) {
      const comboKey = Object.entries(variant.options).map(([n, v]) => `${n}:${v}`).sort().join('|');

      if (existingCombinations.has(comboKey)) {
        // Find the existing variant ID
        const existingEdge = existingVariants.find((edge: any) => {
          const opts = edge.node.selectedOptions.map((o: any) => `${o.name}:${o.value}`).sort().join('|');
          return opts === comboKey;
        });

        if (existingEdge) {
          // Format price correctly for Shopify (string with 2 decimals)
          const priceNum = parseFloat(String(variant.price || '0'));
          const compareNum = variant.compareAtPrice ? parseFloat(String(variant.compareAtPrice)) : null;

          const updateInput: any = {
            id: existingEdge.node.id,
            price: isNaN(priceNum) ? '0.00' : priceNum.toFixed(2),
            compareAtPrice: compareNum && !isNaN(compareNum) ? compareNum.toFixed(2) : null,
          };
          // Include mediaId only if it's a valid Shopify GID
          if (variant.imageId && variant.imageId.startsWith('gid://shopify/')) {
            updateInput.mediaId = variant.imageId;
          }
          console.log('[VARIANTS API] Update input:', JSON.stringify(updateInput));
          variantsToUpdate.push(updateInput);
        }
      } else {
        // Need to create this variant
        // Format price correctly for Shopify (string with 2 decimals)
        const priceNum = parseFloat(String(variant.price || '0'));
        const compareNum = variant.compareAtPrice ? parseFloat(String(variant.compareAtPrice)) : null;

        const createInput: any = {
          price: isNaN(priceNum) ? '0.00' : priceNum.toFixed(2),
          compareAtPrice: compareNum && !isNaN(compareNum) ? compareNum.toFixed(2) : null,
          optionValues: Object.entries(variant.options).map(([name, value]) => ({
            optionName: name,
            name: value,
          })),
        };
        // Include mediaId only if it's a valid Shopify GID
        if (variant.imageId && variant.imageId.startsWith('gid://shopify/')) {
          createInput.mediaId = variant.imageId;
        }
        console.log('[VARIANTS API] Create input:', JSON.stringify(createInput));
        variantsToCreate.push(createInput);
      }
    }

    console.log('[VARIANTS API] Variants to create:', variantsToCreate.length);
    console.log('[VARIANTS API] Variants to update:', variantsToUpdate.length);

    let allVariants: any[] = [];

    // Step 4: Create missing variants
    if (variantsToCreate.length > 0) {
      console.log('[VARIANTS API] Creating variants:', JSON.stringify(variantsToCreate, null, 2));

      const createResponse: any = await shopifyGraphqlWithRefresh(
        shop.shop,
        PRODUCT_VARIANTS_BULK_CREATE_MUTATION,
        {
          productId,
          variants: variantsToCreate,
        }
      );

      console.log('[VARIANTS API] Create response:', JSON.stringify(createResponse, null, 2));

      if (createResponse.productVariantsBulkCreate?.userErrors?.length > 0) {
        const errors = createResponse.productVariantsBulkCreate.userErrors;
        console.error('[VARIANTS API] Create errors:', errors);
        return NextResponse.json(
          { success: false, error: errors[0].message },
          { status: 400 }
        );
      }

      allVariants = allVariants.concat(createResponse.productVariantsBulkCreate?.productVariants || []);
    }

    // Step 5: Update existing variants with correct prices
    if (variantsToUpdate.length > 0) {
      console.log('[VARIANTS API] Updating variants:', JSON.stringify(variantsToUpdate, null, 2));

      const updateResponse: any = await shopifyGraphqlWithRefresh(
        shop.shop,
        PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
        {
          productId,
          variants: variantsToUpdate,
        }
      );

      console.log('[VARIANTS API] Update response:', JSON.stringify(updateResponse, null, 2));

      if (updateResponse.productVariantsBulkUpdate?.userErrors?.length > 0) {
        const errors = updateResponse.productVariantsBulkUpdate.userErrors;
        console.error('[VARIANTS API] Update errors:', errors);
        return NextResponse.json(
          { success: false, error: errors[0].message },
          { status: 400 }
        );
      }

      allVariants = allVariants.concat(updateResponse.productVariantsBulkUpdate?.productVariants || []);
    }

    // Update local product record
    const totalVariants = variantsToCreate.length + variantsToUpdate.length;
    const localProduct = await prisma.product.findFirst({
      where: {
        shopId,
        shopifyProductId: productId,
      },
    });

    if (localProduct) {
      await prisma.product.update({
        where: { id: localProduct.id },
        data: {
          variantsCount: totalVariants,
          hasMultipleVariants: totalVariants > 1,
        },
      });
    }

    // Step 6: Disable inventory tracking for all variants
    // Re-fetch variants to get all inventoryItem IDs
    const finalVariantsResponse: any = await shopifyGraphqlWithRefresh(
      shop.shop,
      PRODUCT_VARIANTS_QUERY,
      { id: productId }
    );

    const finalVariants = finalVariantsResponse.product?.variants?.edges || [];
    console.log('[VARIANTS API] Disabling inventory tracking for', finalVariants.length, 'variants');

    for (const edge of finalVariants) {
      const inventoryItemId = edge.node.inventoryItem?.id;
      if (inventoryItemId) {
        try {
          await shopifyGraphqlWithRefresh(
            shop.shop,
            INVENTORY_ITEM_UPDATE_MUTATION,
            {
              id: inventoryItemId,
              input: { tracked: false },
            }
          );
        } catch (invErr) {
          console.error('[VARIANTS API] Failed to disable tracking for', inventoryItemId, invErr);
        }
      }
    }

    console.log('[VARIANTS API] Success! Total variants:', allVariants.length);

    return NextResponse.json({
      success: true,
      variants: allVariants,
      created: variantsToCreate.length,
      updated: variantsToUpdate.length,
    });
  } catch (error: any) {
    console.error('Error creating variants:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// PUT - Update variants
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { shopId, productId, variants } = body;

    if (!shopId || !productId || !variants) {
      return NextResponse.json(
        { success: false, error: 'shopId, productId e variants sono richiesti' },
        { status: 400 }
      );
    }

    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
    });

    if (!shop) {
      return NextResponse.json(
        { success: false, error: 'Shop non trovato' },
        { status: 404 }
      );
    }

    // Build update inputs
    const variantInputs = (variants as VariantCombination[]).map(variant => {
      const input: any = {
        id: variant.id,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice || null,
        sku: variant.sku || null,
      };
      // Include mediaId only if it's a valid Shopify GID
      if (variant.imageId && variant.imageId.startsWith('gid://shopify/')) {
        input.mediaId = variant.imageId;
      }
      return input;
    });

    // Update variants via Shopify API
    const response: any = await shopifyGraphqlWithRefresh(
      shop.shop,
      PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
      {
        productId,
        variants: variantInputs,
      }
    );

    if (response.productVariantsBulkUpdate.userErrors?.length > 0) {
      const errors = response.productVariantsBulkUpdate.userErrors;
      console.error('Shopify variant update errors:', errors);
      return NextResponse.json(
        { success: false, error: errors[0].message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      variants: response.productVariantsBulkUpdate.productVariants,
    });
  } catch (error: any) {
    console.error('Error updating variants:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// DELETE - Delete a variant
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get('shopId');
  const variantId = searchParams.get('variantId');

  if (!shopId || !variantId) {
    return NextResponse.json(
      { success: false, error: 'shopId e variantId sono richiesti' },
      { status: 400 }
    );
  }

  try {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
    });

    if (!shop) {
      return NextResponse.json(
        { success: false, error: 'Shop non trovato' },
        { status: 404 }
      );
    }

    // Delete variant via Shopify API
    const response: any = await shopifyGraphqlWithRefresh(
      shop.shop,
      PRODUCT_VARIANT_DELETE_MUTATION,
      { id: variantId }
    );

    if (response.productVariantDelete.userErrors?.length > 0) {
      const errors = response.productVariantDelete.userErrors;
      console.error('Shopify variant delete errors:', errors);
      return NextResponse.json(
        { success: false, error: errors[0].message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      deletedVariantId: response.productVariantDelete.deletedProductVariantId,
    });
  } catch (error: any) {
    console.error('Error deleting variant:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
