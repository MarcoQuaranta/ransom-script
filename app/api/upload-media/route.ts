import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { shopifyGraphqlWithRefresh, STAGED_UPLOADS_CREATE_MUTATION, FILE_CREATE_MUTATION } from '@/lib/shopify';

// Query to get file by ID and check if it's ready
const FILE_GET_QUERY = `
  query getFile($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on MediaImage {
        id
        image {
          url
          originalSrc
        }
        preview {
          image {
            url
          }
        }
      }
    }
  }
`;

// Helper to wait for file to be ready
async function waitForFileReady(
  config: { shop: string; accessToken: string },
  fileId: string,
  maxAttempts: number = 10
): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    console.log(`[UPLOAD] Polling for file readiness, attempt ${i + 1}/${maxAttempts}`);

    const result: any = await shopifyGraphqlWithRefresh(config.shop, FILE_GET_QUERY, { ids: [fileId] });
    const file = result.nodes?.[0];

    if (file?.image?.url) {
      console.log('[UPLOAD] File is ready with URL:', file.image.url);
      return file.image.url;
    }

    if (file?.image?.originalSrc) {
      console.log('[UPLOAD] File is ready with originalSrc:', file.image.originalSrc);
      return file.image.originalSrc;
    }

    if (file?.preview?.image?.url) {
      console.log('[UPLOAD] File preview ready:', file.preview.image.url);
      return file.preview.image.url;
    }

    // Wait 500ms before next attempt
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('[UPLOAD] File not ready after max attempts');
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const shopId = formData.get('shopId') as string;
    const file = formData.get('file') as File;

    console.log('[UPLOAD] Starting upload process for file:', file?.name, 'size:', file?.size);

    if (!shopId || !file) {
      return NextResponse.json(
        { error: 'Missing required fields: shopId, file' },
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

    const shopConfig = { shop: shop.shop, accessToken: shop.accessToken };
    console.log('[UPLOAD] Step 1: Creating staged upload for shop:', shop.shop);

    // Step 1: Create staged upload
    const stagedUploadResult: any = await shopifyGraphqlWithRefresh(
      shop.shop,
      STAGED_UPLOADS_CREATE_MUTATION,
      {
        input: [
          {
            filename: file.name,
            mimeType: file.type || 'image/jpeg',
            resource: 'IMAGE',
            httpMethod: 'POST',
          },
        ],
      }
    );

    console.log('[UPLOAD] Staged upload result:', JSON.stringify(stagedUploadResult, null, 2));

    if (stagedUploadResult.stagedUploadsCreate.userErrors.length > 0) {
      console.error('[UPLOAD] Staged upload errors:', stagedUploadResult.stagedUploadsCreate.userErrors);
      return NextResponse.json(
        { error: stagedUploadResult.stagedUploadsCreate.userErrors },
        { status: 400 }
      );
    }

    const stagedTarget = stagedUploadResult.stagedUploadsCreate.stagedTargets[0];
    console.log('[UPLOAD] Staged target URL:', stagedTarget.url);
    console.log('[UPLOAD] Resource URL:', stagedTarget.resourceUrl);

    // Step 2: Upload file to staged URL
    console.log('[UPLOAD] Step 2: Uploading file to staged URL');

    // Read file data into ArrayBuffer to ensure it's fully loaded
    // This prevents issues with File objects being "consumed" on first read
    const fileArrayBuffer = await file.arrayBuffer();
    const fileBlob = new Blob([fileArrayBuffer], { type: file.type || 'image/jpeg' });
    console.log('[UPLOAD] File loaded into memory:', fileBlob.size, 'bytes');

    const uploadFormData = new FormData();
    stagedTarget.parameters.forEach((param: any) => {
      uploadFormData.append(param.name, param.value);
    });
    // Use the blob instead of original file to ensure fresh data
    uploadFormData.append('file', fileBlob, file.name);

    const uploadResponse = await fetch(stagedTarget.url, {
      method: 'POST',
      body: uploadFormData,
    });

    console.log('[UPLOAD] Upload response status:', uploadResponse.status);

    const uploadResponseText = await uploadResponse.text();
    console.log('[UPLOAD] Upload response body:', uploadResponseText.substring(0, 500));

    if (!uploadResponse.ok) {
      throw new Error(`Failed to upload file to Shopify: ${uploadResponse.status}`);
    }

    console.log('[UPLOAD] Step 3: Creating file record in Shopify');

    // Step 3: Create file record in Shopify
    const fileCreateResult: any = await shopifyGraphqlWithRefresh(
      shop.shop,
      FILE_CREATE_MUTATION,
      {
        files: [
          {
            originalSource: stagedTarget.resourceUrl,
            contentType: 'IMAGE',
          },
        ],
      }
    );

    console.log('[UPLOAD] File create result:', JSON.stringify(fileCreateResult, null, 2));

    if (fileCreateResult.fileCreate.userErrors.length > 0) {
      console.error('[UPLOAD] File create errors:', fileCreateResult.fileCreate.userErrors);
      return NextResponse.json(
        { error: fileCreateResult.fileCreate.userErrors },
        { status: 400 }
      );
    }

    const createdFile = fileCreateResult.fileCreate.files[0];
    console.log('[UPLOAD] Created file object:', JSON.stringify(createdFile, null, 2));

    let imageUrl: string | null = null;

    // Try to get URL immediately from the created file
    if (createdFile?.image?.url) {
      imageUrl = createdFile.image.url;
      console.log('[UPLOAD] Got immediate image.url:', imageUrl);
    } else if (createdFile?.image?.originalSrc) {
      imageUrl = createdFile.image.originalSrc;
      console.log('[UPLOAD] Got immediate originalSrc:', imageUrl);
    } else if (createdFile?.preview?.image?.url) {
      imageUrl = createdFile.preview.image.url;
      console.log('[UPLOAD] Got preview URL:', imageUrl);
    } else if (createdFile?.id) {
      // File not ready yet, poll for it
      console.log('[UPLOAD] File not ready, starting polling...');
      imageUrl = await waitForFileReady({ shop: shop.shop, accessToken: shop.accessToken }, createdFile.id);
    }

    // Fallback to resourceUrl if nothing else worked
    if (!imageUrl) {
      imageUrl = stagedTarget.resourceUrl;
      console.log('[UPLOAD] Falling back to resourceUrl:', imageUrl);
    }

    console.log('[UPLOAD] Final image URL:', imageUrl);

    return NextResponse.json({
      success: true,
      file: {
        id: createdFile?.id || 'temp',
        url: imageUrl,
      },
    });
  } catch (error: any) {
    console.error('[UPLOAD] Upload media error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to upload media' },
      { status: 500 }
    );
  }
}
