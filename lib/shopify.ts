import { GraphQLClient } from 'graphql-request';
import { prisma } from './db';

export interface ShopifyConfig {
  shop: string;
  accessToken: string;
}

// Token refresh buffer - refresh 5 minutes before expiry
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Refresh access token using client credentials grant
 */
async function refreshAccessToken(
  shop: string,
  clientId: string,
  clientSecret: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh token: ${response.statusText}`);
  }

  const data = await response.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  return {
    accessToken: data.access_token,
    expiresAt,
  };
}

/**
 * Get valid access token for shop, refreshing if necessary
 */
export async function getValidAccessToken(shopDomain: string): Promise<string> {
  const shop = await prisma.shop.findUnique({
    where: { shop: shopDomain },
  });

  if (!shop) {
    throw new Error(`Shop not found: ${shopDomain}`);
  }

  // Check if token needs refresh
  const needsRefresh =
    !shop.tokenExpiresAt ||
    shop.tokenExpiresAt.getTime() - Date.now() < TOKEN_REFRESH_BUFFER_MS;

  if (needsRefresh && shop.clientId && shop.clientSecret) {
    console.log(`[Token] Refreshing token for ${shopDomain}...`);

    const { accessToken, expiresAt } = await refreshAccessToken(
      shopDomain,
      shop.clientId,
      shop.clientSecret
    );

    // Update token in database
    await prisma.shop.update({
      where: { shop: shopDomain },
      data: {
        accessToken,
        tokenExpiresAt: expiresAt,
      },
    });

    console.log(`[Token] Token refreshed, expires at ${expiresAt.toISOString()}`);
    return accessToken;
  }

  return shop.accessToken;
}

/**
 * Create Shopify client with auto-refreshing token
 */
export async function createShopifyClientWithRefresh(shopDomain: string) {
  const accessToken = await getValidAccessToken(shopDomain);
  const endpoint = `https://${shopDomain}/admin/api/2024-01/graphql.json`;

  return new GraphQLClient(endpoint, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
  });
}

export function createShopifyClient(config: ShopifyConfig) {
  const endpoint = `https://${config.shop}/admin/api/2024-01/graphql.json`;

  return new GraphQLClient(endpoint, {
    headers: {
      'X-Shopify-Access-Token': config.accessToken,
      'Content-Type': 'application/json',
    },
  });
}

export async function shopifyGraphql<T = any>(
  config: ShopifyConfig,
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  const client = createShopifyClient(config);

  try {
    const data = await client.request<T>(query, variables);
    return data;
  } catch (error: any) {
    console.error('Shopify GraphQL Error:', JSON.stringify({
      message: error.message,
      response: error.response,
      errors: error.response?.errors,
    }, null, 2));
    const errorMessage = error.response?.errors?.[0]?.message
      || error.message
      || 'Shopify API error';
    throw new Error(errorMessage);
  }
}

/**
 * Execute GraphQL query with auto-refreshing token
 */
export async function shopifyGraphqlWithRefresh<T = any>(
  shopDomain: string,
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  const client = await createShopifyClientWithRefresh(shopDomain);

  try {
    const data = await client.request<T>(query, variables);
    return data;
  } catch (error: any) {
    // If token error (401 or message includes 'access token'), try refreshing once more
    const isAuthError = error.response?.status === 401
      || error.response?.errors?.[0]?.message?.includes('access token')
      || error.message?.includes('401');

    if (isAuthError) {
      console.log('[Token] Auth error detected (401), forcing token refresh...');
      const shop = await prisma.shop.findUnique({ where: { shop: shopDomain } });

      if (shop?.clientId && shop?.clientSecret) {
        const { accessToken, expiresAt } = await refreshAccessToken(
          shopDomain,
          shop.clientId,
          shop.clientSecret
        );

        await prisma.shop.update({
          where: { shop: shopDomain },
          data: { accessToken, tokenExpiresAt: expiresAt },
        });

        // Retry with new token
        const newClient = await createShopifyClientWithRefresh(shopDomain);
        return await newClient.request<T>(query, variables);
      }
    }

    console.error('Shopify GraphQL Error:', JSON.stringify({
      message: error.message,
      response: error.response,
      errors: error.response?.errors,
    }, null, 2));
    const errorMessage = error.response?.errors?.[0]?.message
      || error.message
      || 'Shopify API error';
    throw new Error(errorMessage);
  }
}

// GraphQL mutations and queries
export const PRODUCT_CREATE_MUTATION = `
  mutation productCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        title
        handle
        status
        variants(first: 10) {
          edges {
            node {
              id
              price
              sku
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_UPDATE_MUTATION = `
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        title
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const METAFIELDS_SET_MUTATION = `
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const METAFIELD_DEFINITION_CREATE_MUTATION = `
  mutation metafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        namespace
        key
        name
        type {
          name
        }
        pinnedPosition
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const METAFIELD_DEFINITION_PIN_MUTATION = `
  mutation metafieldDefinitionPin($definitionId: ID!) {
    metafieldDefinitionPin(definitionId: $definitionId) {
      pinnedDefinition {
        id
        pinnedPosition
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const STAGED_UPLOADS_CREATE_MUTATION = `
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const FILE_CREATE_MUTATION = `
  mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        ... on MediaImage {
          id
          alt
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
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_GET_QUERY = `
  query getProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      descriptionHtml
      vendor
      productType
      templateSuffix
      variants(first: 10) {
        edges {
          node {
            id
            title
            price
            sku
          }
        }
      }
      images(first: 50) {
        edges {
          node {
            id
            url
            altText
          }
        }
      }
      metafields(first: 100) {
        edges {
          node {
            id
            namespace
            key
            value
            type
          }
        }
      }
    }
  }
`;

export const PUBLISH_PRODUCT_MUTATION = `
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      publishable {
        availablePublicationsCount {
          count
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const GET_PUBLICATIONS_QUERY = `
  query getPublications {
    publications(first: 10) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`;

export const PRODUCT_DELETE_MUTATION = `
  mutation productDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) {
      deletedProductId
      userErrors {
        field
        message
      }
    }
  }
`;

export const UNPUBLISH_PRODUCT_MUTATION = `
  mutation publishableUnpublish($id: ID!, $input: [PublicationInput!]!) {
    publishableUnpublish(id: $id, input: $input) {
      publishable {
        availablePublicationsCount {
          count
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCTS_LIST_QUERY = `
  query getProducts($first: Int!, $query: String) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          handle
          status
          templateSuffix
          featuredImage {
            url
          }
          variants(first: 1) {
            edges {
              node {
                id
                price
                sku
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// ============================================
// INVENTORY MUTATIONS
// ============================================

// Disable inventory tracking for a variant
export const INVENTORY_ITEM_UPDATE_MUTATION = `
  mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem {
        id
        tracked
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ============================================
// VARIANT MUTATIONS
// ============================================

// Create product options (required before creating variants)
export const PRODUCT_OPTIONS_CREATE_MUTATION = `
  mutation productOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!) {
    productOptionsCreate(productId: $productId, options: $options) {
      userErrors {
        field
        message
        code
      }
      product {
        id
        options {
          id
          name
          position
          optionValues {
            id
            name
          }
        }
      }
    }
  }
`;

// Delete a product option
export const PRODUCT_OPTION_DELETE_MUTATION = `
  mutation productOptionDelete($productId: ID!, $optionId: ID!) {
    productOptionDelete(productId: $productId, optionId: $optionId) {
      userErrors {
        field
        message
        code
      }
      deletedOptionId
      product {
        id
        options {
          id
          name
        }
      }
    }
  }
`;

// Update a product option (rename or update values)
export const PRODUCT_OPTION_UPDATE_MUTATION = `
  mutation productOptionUpdate($productId: ID!, $optionId: ID!, $option: OptionUpdateInput!) {
    productOptionUpdate(productId: $productId, optionId: $optionId, option: $option) {
      userErrors {
        field
        message
        code
      }
      product {
        id
        options {
          id
          name
          optionValues {
            id
            name
          }
        }
      }
    }
  }
`;

// Bulk delete product variants
export const PRODUCT_VARIANTS_BULK_DELETE_MUTATION = `
  mutation productVariantsBulkDelete($productId: ID!, $variantsIds: [ID!]!) {
    productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
      userErrors {
        field
        message
        code
      }
      product {
        id
        title
      }
    }
  }
`;

// Create product with options (for variants)
export const PRODUCT_CREATE_WITH_OPTIONS_MUTATION = `
  mutation productCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        title
        handle
        status
        options {
          id
          name
          values
        }
        variants(first: 100) {
          edges {
            node {
              id
              title
              price
              compareAtPrice
              sku
              inventoryQuantity
              selectedOptions {
                name
                value
              }
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Bulk create variants
export const PRODUCT_VARIANTS_BULK_CREATE_MUTATION = `
  mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants {
        id
        title
        price
        compareAtPrice
        sku
        inventoryQuantity
        selectedOptions {
          name
          value
        }
        inventoryItem {
          id
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Bulk update variants
export const PRODUCT_VARIANTS_BULK_UPDATE_MUTATION = `
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        title
        price
        compareAtPrice
        sku
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Delete variant
export const PRODUCT_VARIANT_DELETE_MUTATION = `
  mutation productVariantDelete($id: ID!) {
    productVariantDelete(id: $id) {
      deletedProductVariantId
      userErrors {
        field
        message
      }
    }
  }
`;

// ============================================
// PRODUCT MEDIA MUTATIONS
// ============================================

// Create product media (attach images to product)
export const PRODUCT_CREATE_MEDIA_MUTATION = `
  mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        ... on MediaImage {
          id
          status
          image {
            url
            altText
          }
        }
      }
      mediaUserErrors {
        field
        message
        code
      }
    }
  }
`;

// Delete product media
export const PRODUCT_DELETE_MEDIA_MUTATION = `
  mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

// Reorder product media
export const PRODUCT_REORDER_MEDIA_MUTATION = `
  mutation productReorderMedia($id: ID!, $moves: [MoveInput!]!) {
    productReorderMedia(id: $id, moves: $moves) {
      job {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ============================================
// METAFIELD DEFINITIONS QUERY
// ============================================

export const METAFIELD_DEFINITIONS_QUERY = `
  query metafieldDefinitions($ownerType: MetafieldOwnerType!, $first: Int!) {
    metafieldDefinitions(ownerType: $ownerType, first: $first) {
      edges {
        node {
          id
          namespace
          key
          name
          description
          type {
            name
          }
          validations {
            name
            value
          }
        }
      }
    }
  }
`;

// ============================================
// ENHANCED PRODUCT QUERIES
// ============================================

// Get product with full variant and media data
export const PRODUCT_FULL_QUERY = `
  query getProductFull($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      descriptionHtml
      vendor
      productType
      templateSuffix
      options {
        id
        name
        values
      }
      variants(first: 100) {
        edges {
          node {
            id
            title
            price
            compareAtPrice
            sku
            inventoryQuantity
            selectedOptions {
              name
              value
            }
          }
        }
      }
      media(first: 50) {
        edges {
          node {
            ... on MediaImage {
              id
              status
              image {
                url
                altText
              }
            }
          }
        }
      }
      metafields(first: 100) {
        edges {
          node {
            id
            namespace
            key
            value
            type
          }
        }
      }
    }
  }
`;

// Get product variants only
export const PRODUCT_VARIANTS_QUERY = `
  query getProductVariants($id: ID!) {
    product(id: $id) {
      id
      options {
        id
        name
        values
      }
      variants(first: 100) {
        edges {
          node {
            id
            title
            price
            compareAtPrice
            sku
            inventoryQuantity
            selectedOptions {
              name
              value
            }
            inventoryItem {
              id
              tracked
            }
          }
        }
      }
    }
  }
`;

// Get product media only
export const PRODUCT_MEDIA_QUERY = `
  query getProductMedia($id: ID!) {
    product(id: $id) {
      id
      media(first: 50) {
        edges {
          node {
            ... on MediaImage {
              id
              status
              image {
                url
                altText
              }
            }
          }
        }
      }
    }
  }
`;
