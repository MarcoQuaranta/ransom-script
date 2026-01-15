import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  shopifyGraphqlWithRefresh,
  PRODUCT_CREATE_MEDIA_MUTATION,
  PRODUCT_DELETE_MEDIA_MUTATION,
  PRODUCT_REORDER_MEDIA_MUTATION,
  PRODUCT_MEDIA_QUERY,
  STAGED_UPLOADS_CREATE_MUTATION,
  FILE_CREATE_MUTATION,
} from '@/lib/shopify';

// GET - Fetch images for a product
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

    // Fetch media from Shopify
    const response: any = await shopifyGraphqlWithRefresh(
      shop.shop,
      PRODUCT_MEDIA_QUERY,
      { id: productId }
    );

    const product = response.product;
    if (!product) {
      return NextResponse.json(
        { success: false, error: 'Prodotto non trovato' },
        { status: 404 }
      );
    }

    const images = product.media.edges
      .filter((edge: any) => edge.node.image) // Only MediaImage types
      .map((edge: any, index: number) => ({
        id: edge.node.id,
        url: edge.node.image.url,
        altText: edge.node.image.altText,
        position: index,
        status: edge.node.status,
      }));

    return NextResponse.json({
      success: true,
      images,
    });
  } catch (error: any) {
    console.error('Error fetching product images:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// POST - Add images to a product
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const shopId = formData.get('shopId') as string;
    const productId = formData.get('productId') as string;
    const imageUrls = formData.getAll('imageUrls') as string[];
    const files = formData.getAll('files') as File[];
    const altTexts = formData.getAll('altTexts') as string[];

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

    const mediaInputs: any[] = [];

    // Process URL images
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      if (url && url.trim()) {
        mediaInputs.push({
          originalSource: url,
          mediaContentType: 'IMAGE',
          alt: altTexts[i] || '',
        });
      }
    }

    // Process file uploads via staged uploads
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file && file.size > 0) {
        console.log(`[IMAGES] Processing file ${i + 1}/${files.length}: ${file.name}, size: ${file.size}, type: ${file.type}`);

        try {
          // Read file data into ArrayBuffer to ensure it's fully loaded
          // This prevents issues with File objects being "consumed" on first read
          const fileArrayBuffer = await file.arrayBuffer();
          const fileBlob = new Blob([fileArrayBuffer], { type: file.type || 'image/jpeg' });
          const fileName = file.name || `image-${Date.now()}.jpg`;

          console.log(`[IMAGES] File ${fileName} loaded into memory: ${fileBlob.size} bytes`);

          // Create staged upload
          const stagedResponse: any = await shopifyGraphqlWithRefresh(
            shop.shop,
            STAGED_UPLOADS_CREATE_MUTATION,
            {
              input: [{
                filename: fileName,
                mimeType: file.type || 'image/jpeg',
                httpMethod: 'POST',
                resource: 'IMAGE',
              }],
            }
          );

          if (stagedResponse.stagedUploadsCreate.userErrors?.length > 0) {
            console.error(`[IMAGES] Staged upload error for ${fileName}:`, stagedResponse.stagedUploadsCreate.userErrors);
            continue;
          }

          const stagedTarget = stagedResponse.stagedUploadsCreate.stagedTargets[0];
          console.log(`[IMAGES] Staged target for ${fileName}: ${stagedTarget.url}`);

          // Upload file to staged URL using the cloned blob
          const uploadFormData = new FormData();
          for (const param of stagedTarget.parameters) {
            uploadFormData.append(param.name, param.value);
          }
          // Use the blob instead of original file to ensure fresh data
          uploadFormData.append('file', fileBlob, fileName);

          const uploadResponse = await fetch(stagedTarget.url, {
            method: 'POST',
            body: uploadFormData,
          });

          // Check upload response
          if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            console.error(`[IMAGES] Upload failed for ${fileName}: ${uploadResponse.status} - ${errorText}`);
            continue;
          }

          console.log(`[IMAGES] Upload successful for ${fileName}: ${uploadResponse.status}`);

          // Add to media inputs using the resourceUrl
          mediaInputs.push({
            originalSource: stagedTarget.resourceUrl,
            mediaContentType: 'IMAGE',
            alt: altTexts[imageUrls.length + i] || '',
          });
        } catch (fileError: any) {
          console.error(`[IMAGES] Error processing file ${file.name}:`, fileError.message);
          continue;
        }
      }
    }

    if (mediaInputs.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Nessuna immagine da aggiungere' },
        { status: 400 }
      );
    }

    // Create product media
    const response: any = await shopifyGraphqlWithRefresh(
      shop.shop,
      PRODUCT_CREATE_MEDIA_MUTATION,
      {
        productId,
        media: mediaInputs,
      }
    );

    if (response.productCreateMedia.mediaUserErrors?.length > 0) {
      const errors = response.productCreateMedia.mediaUserErrors;
      console.error('Shopify media creation errors:', errors);
      return NextResponse.json(
        { success: false, error: errors[0].message },
        { status: 400 }
      );
    }

    // Update local product record
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
          imagesCount: {
            increment: response.productCreateMedia.media.length,
          },
        },
      });
    }

    // Don't filter - include all media even if still processing
    // The id is what we need for variant association
    const images = response.productCreateMedia.media.map((m: any) => ({
      id: m.id,
      url: m.image?.url || m.preview?.image?.url || '',
      altText: m.image?.altText || '',
      status: m.status,
    }));

    console.log('[PRODUCT-IMAGES] Uploaded', images.length, 'images:', images.map((i: any) => i.id));

    return NextResponse.json({
      success: true,
      images,
      // Return count so frontend knows how many were submitted
      totalSubmitted: mediaInputs.length,
    });
  } catch (error: any) {
    console.error('Error adding product images:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// PUT - Reorder images
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { shopId, productId, moves } = body;

    if (!shopId || !productId || !moves) {
      return NextResponse.json(
        { success: false, error: 'shopId, productId e moves sono richiesti' },
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

    // Reorder media
    const response: any = await shopifyGraphqlWithRefresh(
      shop.shop,
      PRODUCT_REORDER_MEDIA_MUTATION,
      {
        id: productId,
        moves,
      }
    );

    if (response.productReorderMedia.userErrors?.length > 0) {
      const errors = response.productReorderMedia.userErrors;
      console.error('Shopify media reorder errors:', errors);
      return NextResponse.json(
        { success: false, error: errors[0].message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      jobId: response.productReorderMedia.job?.id,
    });
  } catch (error: any) {
    console.error('Error reordering images:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// DELETE - Remove image from product
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get('shopId');
  const productId = searchParams.get('productId');
  const mediaId = searchParams.get('mediaId');

  if (!shopId || !productId || !mediaId) {
    return NextResponse.json(
      { success: false, error: 'shopId, productId e mediaId sono richiesti' },
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

    // Delete media
    const response: any = await shopifyGraphqlWithRefresh(
      shop.shop,
      PRODUCT_DELETE_MEDIA_MUTATION,
      {
        productId,
        mediaIds: [mediaId],
      }
    );

    if (response.productDeleteMedia.mediaUserErrors?.length > 0) {
      const errors = response.productDeleteMedia.mediaUserErrors;
      console.error('Shopify media delete errors:', errors);
      return NextResponse.json(
        { success: false, error: errors[0].message },
        { status: 400 }
      );
    }

    // Update local product record
    const localProduct = await prisma.product.findFirst({
      where: {
        shopId,
        shopifyProductId: productId,
      },
    });

    if (localProduct && localProduct.imagesCount > 0) {
      await prisma.product.update({
        where: { id: localProduct.id },
        data: {
          imagesCount: {
            decrement: 1,
          },
        },
      });
    }

    return NextResponse.json({
      success: true,
      deletedMediaIds: response.productDeleteMedia.deletedMediaIds,
    });
  } catch (error: any) {
    console.error('Error deleting image:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
