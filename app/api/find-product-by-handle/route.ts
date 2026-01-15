import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { shopifyGraphqlWithRefresh } from '@/lib/shopify';

const FIND_PRODUCT_BY_HANDLE_QUERY = `
  query findProductByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
      title
      handle
    }
  }
`;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get('shopId');
  const handle = searchParams.get('handle');

  if (!shopId || !handle) {
    return NextResponse.json(
      { success: false, error: 'shopId e handle sono richiesti' },
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

    const result: any = await shopifyGraphqlWithRefresh(
      shop.shop,
      FIND_PRODUCT_BY_HANDLE_QUERY,
      { handle }
    );

    if (result.productByHandle) {
      return NextResponse.json({
        success: true,
        productId: result.productByHandle.id,
        title: result.productByHandle.title,
        handle: result.productByHandle.handle,
      });
    } else {
      return NextResponse.json({
        success: false,
        error: 'Prodotto non trovato',
      });
    }
  } catch (error: any) {
    console.error('Error finding product by handle:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
