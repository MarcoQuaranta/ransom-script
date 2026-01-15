'use client';

import { useState, useEffect } from 'react';
import { VariantOption, VariantCombination, ProductImage } from '@/types/shopify';
import VariantBuilder from './VariantBuilder';
import ImageGallery from './ImageGallery';

interface Shop {
  id: string;
  name: string;
  shop: string;
}

interface ProductFormProps {
  shops: Shop[];
  selectedShopId?: string;
  product?: any;
  onSuccess?: () => void;
}

// Generate random 5-digit SKU
const generateSku = () => {
  return Math.floor(10000 + Math.random() * 90000).toString();
};

export default function ProductForm({ shops, selectedShopId, product, onSuccess }: ProductFormProps) {
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [loadingProduct, setLoadingProduct] = useState(false);

  // Selected shops for product creation
  const [selectedShops, setSelectedShops] = useState<string[]>(() => {
    // Default: select the shop that was selected in dashboard, or first shop
    if (selectedShopId) return [selectedShopId];
    if (shops.length > 0) return [shops[0].id];
    return [];
  });

  // For edit mode, use the selectedShopId (single shop)
  const shopId = selectedShopId || (shops.length > 0 ? shops[0].id : '');

  // Edit mode
  const isEditing = !!product?.shopifyId || !!product?.id;

  // AI generation
  const [exampleUrl, setExampleUrl] = useState('');

  // Manual JSON import
  const [manualJson, setManualJson] = useState('');
  const [jsonError, setJsonError] = useState('');

  // Basic product data
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [compareAtPrice, setCompareAtPrice] = useState('');
  const [discountPercent, setDiscountPercent] = useState('');
  const [tags, setTags] = useState('');
  const [sku, setSku] = useState(() => isEditing ? '' : generateSku());

  // Calculate compareAtPrice when price or discount changes
  const handlePriceChange = (newPrice: string) => {
    setPrice(newPrice);
    if (newPrice && discountPercent) {
      const priceNum = parseFloat(newPrice);
      const discountNum = parseFloat(discountPercent);
      if (!isNaN(priceNum) && !isNaN(discountNum) && discountNum > 0 && discountNum < 100) {
        const originalPrice = priceNum / (1 - discountNum / 100);
        setCompareAtPrice(originalPrice.toFixed(2));
      }
    }
  };

  const handleDiscountChange = (newDiscount: string) => {
    setDiscountPercent(newDiscount);
    if (price && newDiscount) {
      const priceNum = parseFloat(price);
      const discountNum = parseFloat(newDiscount);
      if (!isNaN(priceNum) && !isNaN(discountNum) && discountNum > 0 && discountNum < 100) {
        const originalPrice = priceNum / (1 - discountNum / 100);
        setCompareAtPrice(originalPrice.toFixed(2));
      }
    } else if (!newDiscount) {
      setCompareAtPrice('');
    }
  };

  // Variants
  const [variantOptions, setVariantOptions] = useState<VariantOption[]>([]);
  const [variantCombinations, setVariantCombinations] = useState<VariantCombination[]>([]);

  // Product images (Shopify gallery/carousel)
  const [productImages, setProductImages] = useState<ProductImage[]>([]);

  // Bullets
  const [bullet1, setBullet1] = useState('');
  const [bullet2, setBullet2] = useState('');
  const [bullet3, setBullet3] = useState('');

  // Angle 1
  const [angle1ImageFile, setAngle1ImageFile] = useState<File | null>(null);
  const [angle1ImageUrl, setAngle1ImageUrl] = useState('');
  const [angle1Title, setAngle1Title] = useState('');
  const [angle1Text, setAngle1Text] = useState('');

  // Angle 2
  const [angle2ImageFile, setAngle2ImageFile] = useState<File | null>(null);
  const [angle2ImageUrl, setAngle2ImageUrl] = useState('');
  const [angle2Title, setAngle2Title] = useState('');
  const [angle2Text, setAngle2Text] = useState('');

  // Angle 3
  const [angle3ImageFile, setAngle3ImageFile] = useState<File | null>(null);
  const [angle3ImageUrl, setAngle3ImageUrl] = useState('');
  const [angle3Title, setAngle3Title] = useState('');
  const [angle3Text, setAngle3Text] = useState('');

  // Lifestyle section
  const [lifestyleMainTitle, setLifestyleMainTitle] = useState('');
  const [lifestyleLeftTitle, setLifestyleLeftTitle] = useState('');
  const [lifestyleLeftIconFile, setLifestyleLeftIconFile] = useState<File | null>(null);
  const [lifestyleLeftText, setLifestyleLeftText] = useState('');
  const [lifestyleImageFile, setLifestyleImageFile] = useState<File | null>(null);
  const [lifestyleImageUrl, setLifestyleImageUrl] = useState('');
  const [lifestyleRightTitle, setLifestyleRightTitle] = useState('');
  const [lifestyleRightIconFile, setLifestyleRightIconFile] = useState<File | null>(null);
  const [lifestyleRightText, setLifestyleRightText] = useState('');

  // Size Guide
  const [sizeGuide2, setSizeGuide2] = useState('');

  // Product handle (for finding product on other shops in edit mode)
  const [productHandle, setProductHandle] = useState('');

  // Load product data when editing
  useEffect(() => {
    console.log('[ProductForm] useEffect triggered, product:', product);
    console.log('[ProductForm] isEditing:', isEditing);
    if (product?.shopifyId || product?.id) {
      const productId = product.shopifyId || product.id;
      console.log('[ProductForm] Loading product data for:', productId);
      loadProductData(productId);
    }
  }, [product, shopId]);

  const loadProductData = async (productId: string) => {
    setLoadingProduct(true);
    try {
      const res = await fetch(`/api/get-product?shopId=${shopId}&productId=${productId}`);
      const data = await res.json();

      if (data.success && data.product) {
        const p = data.product;

        // Basic info
        setTitle(p.title || '');
        setDescription(p.description || '');
        setPrice(p.price || '');
        setCompareAtPrice(p.compareAtPrice || '');
        setTags(p.tags || '');
        setSku(p.sku || '');

        // Metafields
        const mf = p.metafields || {};
        setBullet1(mf.bullet_1 || '');
        setBullet2(mf.bullet_2 || '');
        setBullet3(mf.bullet_3 || '');

        setAngle1Title(mf.angle_1_title || '');
        setAngle1Text(mf.angle_1_text || '');
        setAngle1ImageUrl(mf.angle_1_image || '');

        setAngle2Title(mf.angle_2_title || '');
        setAngle2Text(mf.angle_2_text || '');
        setAngle2ImageUrl(mf.angle_2_image || '');

        setAngle3Title(mf.angle_3_title || '');
        setAngle3Text(mf.angle_3_text || '');
        setAngle3ImageUrl(mf.angle_3_image || '');

        setLifestyleMainTitle(mf.lifestyle_main_title || '');
        setLifestyleLeftTitle(mf.lifestyle_left_title || '');
        setLifestyleLeftText(mf.lifestyle_left_text || '');
        setLifestyleRightTitle(mf.lifestyle_right_title || '');
        setLifestyleRightText(mf.lifestyle_right_text || '');
        setLifestyleImageUrl(mf.lifestyle_image || '');

        setSizeGuide2(mf.size_guide2 || '');

        // Options and variants
        if (p.options && p.options.length > 0) {
          setVariantOptions(p.options.map((opt: any) => ({
            name: opt.name,
            values: opt.values,
          })));
        }

        if (p.variants && p.variants.length > 0) {
          // Only set variant combinations if there are actual options (not just default)
          const hasRealOptions = p.options && p.options.length > 0;
          if (hasRealOptions) {
            setVariantCombinations(p.variants.map((v: any) => ({
              id: v.id,
              options: v.options,
              price: v.price,
              compareAtPrice: v.compareAtPrice,
              sku: v.sku,
              imageId: v.imageId || undefined,
              imageUrl: v.imageUrl || undefined,
            })));
          }
        }

        // Images
        if (p.images && p.images.length > 0) {
          setProductImages(p.images.map((img: any) => ({
            id: img.id,
            url: img.url,
            altText: img.altText,
          })));
        }

        // Save handle for multi-shop edit
        if (p.handle) {
          setProductHandle(p.handle);
        }

        console.log('[EDIT] Product data loaded:', p);
      }
    } catch (error) {
      console.error('Error loading product:', error);
    } finally {
      setLoadingProduct(false);
    }
  };

  // AI Generation from URL
  const handleAIGenerate = async () => {
    if (!exampleUrl) {
      alert('Inserisci un URL di esempio');
      return;
    }

    setAiLoading(true);
    try {
      const res = await fetch('/api/gemini/generate-from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId,
          url: exampleUrl,
          fields: [
            'bullet_1', 'bullet_2', 'bullet_3',
            'angle_1_title', 'angle_1_text',  // DESIGN
            'angle_2_title', 'angle_2_text',  // FIT & COMFORT
            'angle_3_title', 'angle_3_text',  // MATERIALS
            'lifestyle_main_title',
            'lifestyle_left_title', 'lifestyle_left_text',
            'lifestyle_right_title', 'lifestyle_right_text'
          ],
        }),
      });

      const data = await res.json();
      console.log('AI Response:', JSON.stringify(data, null, 2));

      // Helper function to apply content to form fields
      const applyContent = (content: any) => {
        if (!content) return;
        if (content.title) setTitle(content.title);
        if (content.description) setDescription(content.description);

        const mf = content.metafields || {};
        console.log('Metafields:', JSON.stringify(mf, null, 2));
        if (mf.bullet_1) setBullet1(mf.bullet_1);
        if (mf.bullet_2) setBullet2(mf.bullet_2);
        if (mf.bullet_3) setBullet3(mf.bullet_3);
        if (mf.angle_1_title) setAngle1Title(mf.angle_1_title);
        if (mf.angle_1_text) setAngle1Text(mf.angle_1_text);
        if (mf.angle_2_title) setAngle2Title(mf.angle_2_title);
        if (mf.angle_2_text) setAngle2Text(mf.angle_2_text);
        if (mf.angle_3_title) setAngle3Title(mf.angle_3_title);
        if (mf.angle_3_text) setAngle3Text(mf.angle_3_text);
        if (mf.lifestyle_main_title) setLifestyleMainTitle(mf.lifestyle_main_title);
        if (mf.lifestyle_left_title) setLifestyleLeftTitle(mf.lifestyle_left_title);
        if (mf.lifestyle_left_text) setLifestyleLeftText(mf.lifestyle_left_text);
        if (mf.lifestyle_right_title) setLifestyleRightTitle(mf.lifestyle_right_title);
        if (mf.lifestyle_right_text) setLifestyleRightText(mf.lifestyle_right_text);
      };

      if (res.ok && data.success) {
        // Full success - all fields generated
        applyContent(data.content);
      } else if (data.partialContent) {
        // Partial success - some fields generated, show error but apply what we got
        applyContent(data.partialContent);

        // Show detailed error with missing fields info
        const details = data.details;
        const summaryMessage = details
          ? `Generati ${details.totalGenerated}/${details.totalRequired} campi.`
          : '';

        alert(`⚠️ Generazione AI incompleta\n\n${summaryMessage}\n\nI campi generati sono stati applicati al form.\nCompila manualmente i campi mancanti (evidenziati in rosso se vuoti).\n\nDettagli:\n${data.error}`);
      } else {
        // Complete failure
        alert(`Errore AI: ${data.error}`);
      }
    } catch (error) {
      console.error('AI generation error:', error);
      alert('Errore durante la generazione AI');
    } finally {
      setAiLoading(false);
    }
  };

  // Manual JSON import handler
  const handleJsonImport = () => {
    setJsonError('');

    if (!manualJson.trim()) {
      setJsonError('Inserisci il JSON');
      return;
    }

    try {
      // Clean JSON (remove markdown code blocks if present)
      let cleanJson = manualJson.trim();
      if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.slice(7);
      }
      if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.slice(3);
      }
      if (cleanJson.endsWith('```')) {
        cleanJson = cleanJson.slice(0, -3);
      }
      cleanJson = cleanJson.trim();

      const data = JSON.parse(cleanJson);

      // Apply fields - support both flat and nested metafields structure
      const mf = data.metafields || data;

      // Description (can be at root or in metafields)
      if (data.description) setDescription(data.description);

      // Bullets
      if (mf.bullet_1) setBullet1(mf.bullet_1);
      if (mf.bullet_2) setBullet2(mf.bullet_2);
      if (mf.bullet_3) setBullet3(mf.bullet_3);

      // Angles
      if (mf.angle_1_title) setAngle1Title(mf.angle_1_title);
      if (mf.angle_1_text) setAngle1Text(mf.angle_1_text);
      if (mf.angle_2_title) setAngle2Title(mf.angle_2_title);
      if (mf.angle_2_text) setAngle2Text(mf.angle_2_text);
      if (mf.angle_3_title) setAngle3Title(mf.angle_3_title);
      if (mf.angle_3_text) setAngle3Text(mf.angle_3_text);

      // Lifestyle
      if (mf.lifestyle_main_title) setLifestyleMainTitle(mf.lifestyle_main_title);
      if (mf.lifestyle_left_title) setLifestyleLeftTitle(mf.lifestyle_left_title);
      if (mf.lifestyle_left_text) setLifestyleLeftText(mf.lifestyle_left_text);
      if (mf.lifestyle_right_title) setLifestyleRightTitle(mf.lifestyle_right_title);
      if (mf.lifestyle_right_text) setLifestyleRightText(mf.lifestyle_right_text);

      // Count applied fields
      const appliedFields = [
        mf.bullet_1, mf.bullet_2, mf.bullet_3,
        mf.angle_1_title, mf.angle_1_text,
        mf.angle_2_title, mf.angle_2_text,
        mf.angle_3_title, mf.angle_3_text,
        mf.lifestyle_main_title,
        mf.lifestyle_left_title, mf.lifestyle_left_text,
        mf.lifestyle_right_title, mf.lifestyle_right_text
      ].filter(Boolean).length;

      alert(`JSON importato! ${appliedFields} campi applicati al form.\n\nOra inserisci manualmente:\n- Titolo prodotto\n- Prezzi\n- Immagini prodotto\n- Immagini Angle\n- GIF Lifestyle`);

      setManualJson(''); // Clear textarea after success
    } catch (error) {
      console.error('JSON parse error:', error);
      setJsonError('JSON non valido. Controlla la sintassi.');
    }
  };

  // Upload file and get Shopify file GID
  const uploadFileForMetafield = async (file: File, targetShopId: string): Promise<string | null> => {
    try {
      const formData = new FormData();
      formData.append('shopId', targetShopId);
      formData.append('file', file);

      const res = await fetch('/api/upload-media', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        return data.file?.id || null;
      }
    } catch (err) {
      console.error('Upload error:', err);
    }
    return null;
  };

  // Result type for product creation/update
  interface ProductOperationResult {
    success: boolean;
    warnings: string[];
    complete: boolean;
  }

  // Track images to delete (for edit mode with multiple shops)
  const [imagesToDelete, setImagesToDelete] = useState<string[]>([]);

  // Update product on a single shop
  const updateProductOnShop = async (
    targetShopId: string,
    shopName: string,
    shopIndex: number,
    totalShops: number,
    productHandle: string
  ): Promise<ProductOperationResult> => {
    const prefix = totalShops > 1 ? `[${shopIndex + 1}/${totalShops}] ${shopName}: ` : '';

    // ========== STEP 1: Find product on this shop by handle ==========
    setLoadingMessage(`${prefix}Ricerca prodotto...`);

    const findResponse = await fetch(`/api/find-product-by-handle?shopId=${targetShopId}&handle=${productHandle}`);
    const findResult = await findResponse.json();

    if (!findResult.success || !findResult.productId) {
      throw new Error(`Prodotto non trovato su ${shopName}`);
    }

    const targetProductId = findResult.productId;

    // ========== STEP 2: Upload metafield images ==========
    setLoadingMessage(`${prefix}Caricamento immagini metafield...`);

    const uploads: { key: string; file: File }[] = [];
    if (angle1ImageFile) uploads.push({ key: 'angle_1_image', file: angle1ImageFile });
    if (angle2ImageFile) uploads.push({ key: 'angle_2_image', file: angle2ImageFile });
    if (angle3ImageFile) uploads.push({ key: 'angle_3_image', file: angle3ImageFile });
    if (lifestyleLeftIconFile) uploads.push({ key: 'lifestyle_left_icon', file: lifestyleLeftIconFile });
    if (lifestyleImageFile) uploads.push({ key: 'lifestyle_image', file: lifestyleImageFile });
    if (lifestyleRightIconFile) uploads.push({ key: 'lifestyle_right_icon', file: lifestyleRightIconFile });

    const uploadedGids: Record<string, string> = {};
    for (const upload of uploads) {
      const gid = await uploadFileForMetafield(upload.file, targetShopId);
      if (gid) uploadedGids[upload.key] = gid;
    }

    // ========== STEP 3: Build metafields ==========
    const metafields: Record<string, string> = {};

    if (bullet1) metafields.bullet_1 = bullet1;
    if (bullet2) metafields.bullet_2 = bullet2;
    if (bullet3) metafields.bullet_3 = bullet3;

    if (uploadedGids.angle_1_image) metafields.angle_1_image = uploadedGids.angle_1_image;
    if (angle1Title) metafields.angle_1_title = angle1Title;
    if (angle1Text) metafields.angle_1_text = angle1Text;

    if (uploadedGids.angle_2_image) metafields.angle_2_image = uploadedGids.angle_2_image;
    if (angle2Title) metafields.angle_2_title = angle2Title;
    if (angle2Text) metafields.angle_2_text = angle2Text;

    if (uploadedGids.angle_3_image) metafields.angle_3_image = uploadedGids.angle_3_image;
    if (angle3Title) metafields.angle_3_title = angle3Title;
    if (angle3Text) metafields.angle_3_text = angle3Text;

    if (lifestyleMainTitle) metafields.lifestyle_main_title = lifestyleMainTitle;
    if (lifestyleLeftTitle) metafields.lifestyle_left_title = lifestyleLeftTitle;
    if (uploadedGids.lifestyle_left_icon) metafields.lifestyle_left_icon = uploadedGids.lifestyle_left_icon;
    if (lifestyleLeftText) metafields.lifestyle_left_text = lifestyleLeftText;
    if (uploadedGids.lifestyle_image) metafields.lifestyle_image = uploadedGids.lifestyle_image;
    if (lifestyleRightTitle) metafields.lifestyle_right_title = lifestyleRightTitle;
    if (uploadedGids.lifestyle_right_icon) metafields.lifestyle_right_icon = uploadedGids.lifestyle_right_icon;
    if (lifestyleRightText) metafields.lifestyle_right_text = lifestyleRightText;

    if (sizeGuide2) metafields.size_guide2 = sizeGuide2;

    // ========== STEP 4: Update product ==========
    setLoadingMessage(`${prefix}Aggiornamento prodotto...`);

    const parsedTags = tags.split(',').map(t => t.trim()).filter(t => t.length > 0);

    const payload = {
      productId: targetProductId,
      shopId: targetShopId,
      title,
      description,
      price: parseFloat(price) || 0,
      compareAtPrice: parseFloat(compareAtPrice) || null,
      sku: sku || undefined,
      tags: parsedTags,
      metafields,
    };

    const response = await fetch('/api/update-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Errore aggiornamento prodotto');
    }

    const updateResult = await response.json();
    const productWarnings: string[] = updateResult.warnings || [];

    // ========== STEP 5: Delete removed images ==========
    if (imagesToDelete.length > 0) {
      setLoadingMessage(`${prefix}Rimozione immagini...`);

      // Get images from this shop's product to find matching ones to delete
      const imagesResponse = await fetch(`/api/product-images?shopId=${targetShopId}&productId=${targetProductId}`);
      const imagesResult = await imagesResponse.json();

      if (imagesResult.success && imagesResult.images) {
        // Find images to delete by URL match (since IDs differ across shops)
        for (const imgUrl of imagesToDelete) {
          const matchingImage = imagesResult.images.find((img: any) =>
            img.url === imgUrl || img.url?.includes(imgUrl.split('/').pop())
          );

          if (matchingImage?.id) {
            try {
              await fetch(
                `/api/product-images?shopId=${targetShopId}&productId=${targetProductId}&mediaId=${matchingImage.id}`,
                { method: 'DELETE' }
              );
            } catch (e) {
              console.error(`Failed to delete image on ${shopName}:`, e);
            }
          }
        }
      }
    }

    // ========== STEP 6: Upload new gallery images ==========
    let imageUrlToMediaId: Record<string, string> = {};
    const newImages = productImages.filter(img => !img.id && (img.file || img.url));

    if (newImages.length > 0) {
      setLoadingMessage(`${prefix}Caricamento ${newImages.length} nuove immagini...`);

      const imageFormData = new FormData();
      imageFormData.append('shopId', targetShopId);
      imageFormData.append('productId', targetProductId);

      // Track blob URLs in order for mapping
      const orderedBlobUrls: string[] = [];

      // URLs first (same order as API)
      newImages.forEach((img) => {
        if (img.url && !img.url.startsWith('blob:')) {
          imageFormData.append('imageUrls', img.url);
          orderedBlobUrls.push(img.url);
        }
      });

      // Files second
      newImages.forEach((img) => {
        if (img.file && img.url) {
          imageFormData.append('files', img.file);
          orderedBlobUrls.push(img.url);
        }
      });

      console.log(`[IMAGES] Uploading to ${shopName} with blob URLs:`, orderedBlobUrls);

      const imgResponse = await fetch('/api/product-images', {
        method: 'POST',
        body: imageFormData,
      });

      const imgResult = await imgResponse.json();

      if (!imgResult.success) {
        console.error(`[IMAGES] Upload to ${shopName} failed:`, imgResult.error);
        productWarnings.push(`Errore caricamento immagini: ${imgResult.error}`);
      } else {
        console.log(`[IMAGES] Upload to ${shopName} success, received:`, imgResult.images?.length, 'images');

        // Build blob URL -> mediaId mapping
        if (imgResult.images) {
          imgResult.images.forEach((uploadedImg: any, idx: number) => {
            if (uploadedImg.id) {
              const blobUrl = orderedBlobUrls[idx];
              if (blobUrl) {
                imageUrlToMediaId[blobUrl] = uploadedImg.id;
              }
            }
          });
        }
      }
    }

    // ========== STEP 7: Update variants ==========
    if (variantOptions.length > 0 && variantCombinations.length > 0) {
      setLoadingMessage(`${prefix}Aggiornamento varianti...`);

      // Get main price as fallback for variants with no price
      const mainPrice = parseFloat(price) || 0;
      const mainCompareAt = parseFloat(compareAtPrice) || 0;

      // Map blob URLs to Shopify mediaIds AND ensure prices are set
      const updatedCombinations = variantCombinations.map(combo => {
        let mediaId: string | undefined = undefined;

        // Try to find mediaId from imageUrl (blob URL)
        if (combo.imageUrl && imageUrlToMediaId[combo.imageUrl]) {
          mediaId = imageUrlToMediaId[combo.imageUrl];
        }
        // Or from imageId if it's a blob URL
        else if (combo.imageId && imageUrlToMediaId[combo.imageId]) {
          mediaId = imageUrlToMediaId[combo.imageId];
        }
        // Keep existing imageId if it's already a Shopify ID
        else if (combo.imageId && combo.imageId.startsWith('gid://')) {
          mediaId = combo.imageId;
        }

        // Ensure variant has a valid price - use main price if variant price is 0 or empty
        const variantPrice = parseFloat(String(combo.price)) || 0;
        const variantCompareAt = parseFloat(String(combo.compareAtPrice)) || 0;

        const finalPrice = variantPrice > 0 ? variantPrice : mainPrice;
        const finalCompareAt = variantCompareAt > 0 ? variantCompareAt : (mainCompareAt > 0 ? mainCompareAt : undefined);

        console.log(`[VARIANTS UPDATE] Price for ${JSON.stringify(combo.options)}: variant=${variantPrice}, main=${mainPrice}, final=${finalPrice}`);

        return {
          ...combo,
          price: finalPrice.toFixed(2),
          compareAtPrice: finalCompareAt ? finalCompareAt.toFixed(2) : undefined,
          imageId: mediaId,
        };
      });

      const variantRes = await fetch('/api/variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: targetShopId,
          productId: targetProductId,
          options: variantOptions,
          variants: updatedCombinations,
        }),
      });

      const variantData = await variantRes.json();

      if (!variantRes.ok || !variantData.success) {
        console.error(`[VARIANTS] Update on ${shopName} failed:`, variantData.error);
        productWarnings.push(`Errore varianti: ${variantData.error}`);
      } else {
        console.log(`[VARIANTS] Updated on ${shopName} successfully:`, variantData.variants?.length || 0, 'variants');
      }
    }

    return {
      success: true,
      warnings: productWarnings,
      complete: updateResult.complete !== false && productWarnings.length === 0,
    };
  };

  // Create product on a single shop
  const createProductOnShop = async (
    targetShopId: string,
    shopName: string,
    shopIndex: number,
    totalShops: number
  ): Promise<ProductOperationResult> => {
    const prefix = totalShops > 1 ? `[${shopIndex + 1}/${totalShops}] ${shopName}: ` : '';

    // ========== STEP 1: Upload metafield images ==========
    setLoadingMessage(`${prefix}Caricamento immagini metafield...`);

    const uploads: { key: string; file: File }[] = [];
    if (angle1ImageFile) uploads.push({ key: 'angle_1_image', file: angle1ImageFile });
    if (angle2ImageFile) uploads.push({ key: 'angle_2_image', file: angle2ImageFile });
    if (angle3ImageFile) uploads.push({ key: 'angle_3_image', file: angle3ImageFile });
    if (lifestyleLeftIconFile) uploads.push({ key: 'lifestyle_left_icon', file: lifestyleLeftIconFile });
    if (lifestyleImageFile) uploads.push({ key: 'lifestyle_image', file: lifestyleImageFile });
    if (lifestyleRightIconFile) uploads.push({ key: 'lifestyle_right_icon', file: lifestyleRightIconFile });

    const uploadedGids: Record<string, string> = {};
    for (const upload of uploads) {
      const gid = await uploadFileForMetafield(upload.file, targetShopId);
      if (gid) uploadedGids[upload.key] = gid;
    }

    // ========== STEP 2: Build metafields ==========
    const metafields: Record<string, string> = {};

    if (bullet1) metafields.bullet_1 = bullet1;
    if (bullet2) metafields.bullet_2 = bullet2;
    if (bullet3) metafields.bullet_3 = bullet3;

    if (uploadedGids.angle_1_image) metafields.angle_1_image = uploadedGids.angle_1_image;
    if (angle1Title) metafields.angle_1_title = angle1Title;
    if (angle1Text) metafields.angle_1_text = angle1Text;

    if (uploadedGids.angle_2_image) metafields.angle_2_image = uploadedGids.angle_2_image;
    if (angle2Title) metafields.angle_2_title = angle2Title;
    if (angle2Text) metafields.angle_2_text = angle2Text;

    if (uploadedGids.angle_3_image) metafields.angle_3_image = uploadedGids.angle_3_image;
    if (angle3Title) metafields.angle_3_title = angle3Title;
    if (angle3Text) metafields.angle_3_text = angle3Text;

    if (lifestyleMainTitle) metafields.lifestyle_main_title = lifestyleMainTitle;
    if (lifestyleLeftTitle) metafields.lifestyle_left_title = lifestyleLeftTitle;
    if (uploadedGids.lifestyle_left_icon) metafields.lifestyle_left_icon = uploadedGids.lifestyle_left_icon;
    if (lifestyleLeftText) metafields.lifestyle_left_text = lifestyleLeftText;
    if (uploadedGids.lifestyle_image) metafields.lifestyle_image = uploadedGids.lifestyle_image;
    if (lifestyleRightTitle) metafields.lifestyle_right_title = lifestyleRightTitle;
    if (uploadedGids.lifestyle_right_icon) metafields.lifestyle_right_icon = uploadedGids.lifestyle_right_icon;
    if (lifestyleRightText) metafields.lifestyle_right_text = lifestyleRightText;

    if (sizeGuide2) metafields.size_guide2 = sizeGuide2;

    // ========== STEP 3: Create product ==========
    setLoadingMessage(`${prefix}Creazione prodotto su Shopify...`);

    const productOptions = variantOptions.length > 0
      ? variantOptions.map(opt => ({ name: opt.name, values: opt.values }))
      : undefined;

    const parsedTags = tags
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const payload = {
      shopId: targetShopId,
      title,
      description,
      price: parseFloat(price) || 0,
      compareAtPrice: parseFloat(compareAtPrice) || null,
      sku: sku || generateSku(),
      tags: parsedTags,
      templateSuffix: 'landing',
      metafields,
      options: productOptions,
    };

    const response = await fetch('/api/create-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Errore creazione prodotto');
    }

    const result = await response.json();
    const createdProductId = result.product?.shopifyProductId || result.product?.shopifyId;

    if (!createdProductId) {
      throw new Error('ID prodotto non ricevuto da Shopify');
    }

    // Collect warnings from product creation
    const productWarnings: string[] = result.warnings || [];
    const isComplete = result.complete !== false;

    console.log(`[PRODUCT] Created on ${shopName} with ID:`, createdProductId);
    if (productWarnings.length > 0) {
      console.log(`[PRODUCT] Warnings on ${shopName}:`, productWarnings);
    }

    // ========== STEP 4: Upload gallery images and get mediaIds ==========
    let imageUrlToMediaId: Record<string, string> = {};
    const newImages = productImages.filter(img => !img.id && (img.file || img.url));

    if (newImages.length > 0) {
      setLoadingMessage(`${prefix}Caricamento ${newImages.length} immagini galleria...`);

      const imageFormData = new FormData();
      imageFormData.append('shopId', targetShopId);
      imageFormData.append('productId', createdProductId);

      // Track blob URLs in order for mapping
      const orderedBlobUrls: string[] = [];

      // URLs first (same order as API)
      newImages.forEach((img) => {
        if (img.url && !img.url.startsWith('blob:')) {
          imageFormData.append('imageUrls', img.url);
          orderedBlobUrls.push(img.url);
        }
      });

      // Files second
      newImages.forEach((img) => {
        if (img.file && img.url) {
          imageFormData.append('files', img.file);
          orderedBlobUrls.push(img.url);
        }
      });

      console.log(`[IMAGES] Uploading to ${shopName} with blob URLs:`, orderedBlobUrls);

      const imgResponse = await fetch('/api/product-images', {
        method: 'POST',
        body: imageFormData,
      });

      const imgResult = await imgResponse.json();

      if (!imgResult.success) {
        console.error(`[IMAGES] Upload to ${shopName} failed:`, imgResult.error);
      } else {
        console.log(`[IMAGES] Upload to ${shopName} success, received:`, imgResult.images?.length, 'images');

        // Build blob URL -> mediaId mapping
        if (imgResult.images) {
          imgResult.images.forEach((uploadedImg: any, idx: number) => {
            if (uploadedImg.id) {
              const blobUrl = orderedBlobUrls[idx];
              if (blobUrl) {
                imageUrlToMediaId[blobUrl] = uploadedImg.id;
                console.log(`[IMAGES] Mapped: ${blobUrl.substring(0, 50)}... -> ${uploadedImg.id}`);
              }
            }
          });
        }
      }
    }

    // ========== STEP 5: Create variants with correct mediaIds ==========
    if (variantOptions.length > 0 && variantCombinations.length > 0) {
      setLoadingMessage(`${prefix}Creazione varianti e associazione immagini...`);

      // Get main price as fallback for variants with no price
      const mainPrice = parseFloat(price) || 0;
      const mainCompareAt = parseFloat(compareAtPrice) || 0;

      // Map blob URLs to Shopify mediaIds AND ensure prices are set
      const updatedCombinations = variantCombinations.map(combo => {
        let mediaId: string | undefined = undefined;

        // Try to find mediaId from imageUrl (blob URL)
        if (combo.imageUrl && imageUrlToMediaId[combo.imageUrl]) {
          mediaId = imageUrlToMediaId[combo.imageUrl];
          console.log(`[VARIANTS] ${JSON.stringify(combo.options)} -> ${mediaId}`);
        }
        // Or from imageId if it's a blob URL
        else if (combo.imageId && imageUrlToMediaId[combo.imageId]) {
          mediaId = imageUrlToMediaId[combo.imageId];
          console.log(`[VARIANTS] ${JSON.stringify(combo.options)} -> ${mediaId}`);
        }

        // Ensure variant has a valid price - use main price if variant price is 0 or empty
        const variantPrice = parseFloat(String(combo.price)) || 0;
        const variantCompareAt = parseFloat(String(combo.compareAtPrice)) || 0;

        const finalPrice = variantPrice > 0 ? variantPrice : mainPrice;
        const finalCompareAt = variantCompareAt > 0 ? variantCompareAt : (mainCompareAt > 0 ? mainCompareAt : undefined);

        console.log(`[VARIANTS] Price for ${JSON.stringify(combo.options)}: variant=${variantPrice}, main=${mainPrice}, final=${finalPrice}`);

        return {
          ...combo,
          price: finalPrice.toFixed(2),
          compareAtPrice: finalCompareAt ? finalCompareAt.toFixed(2) : undefined,
          imageId: mediaId,
        };
      });

      const variantRes = await fetch('/api/variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: targetShopId,
          productId: createdProductId,
          options: variantOptions,
          variants: updatedCombinations,
        }),
      });

      const variantData = await variantRes.json();

      if (!variantRes.ok || !variantData.success) {
        throw new Error(variantData.error || 'Errore creazione varianti');
      }

      console.log(`[VARIANTS] Created on ${shopName} successfully:`, variantData.variants?.length || 0, 'variants');
    }

    return {
      success: true,
      warnings: productWarnings,
      complete: isComplete && productWarnings.length === 0,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isEditing) {
        // ========== EDIT MODE: Multiple shops ==========
        const shopsToUpdate = selectedShops
          .map(id => shops.find(s => s.id === id))
          .filter((s): s is Shop => s !== undefined);

        if (shopsToUpdate.length === 0) {
          throw new Error('Seleziona almeno uno shop');
        }

        if (!productHandle) {
          throw new Error('Handle prodotto non disponibile');
        }

        const results: { shop: string; success: boolean; error?: string; warnings?: string[]; complete?: boolean }[] = [];

        for (let i = 0; i < shopsToUpdate.length; i++) {
          const shop = shopsToUpdate[i];
          try {
            const updateResult = await updateProductOnShop(
              shop.id,
              shop.name || shop.shop,
              i,
              shopsToUpdate.length,
              productHandle
            );
            results.push({
              shop: shop.name || shop.shop,
              success: true,
              warnings: updateResult.warnings,
              complete: updateResult.complete,
            });
          } catch (error: any) {
            results.push({
              shop: shop.name || shop.shop,
              success: false,
              error: error.message
            });
          }
        }

        // Show results
        setLoadingMessage('');
        const successCount = results.filter(r => r.success).length;
        const failedShops = results.filter(r => !r.success);
        const shopsWithWarnings = results.filter(r => r.success && r.warnings && r.warnings.length > 0);

        let message = '';

        if (failedShops.length === 0 && shopsWithWarnings.length === 0) {
          message = `✅ Prodotto aggiornato con successo su ${successCount} shop!\n\nTutti i dati sono stati salvati correttamente.`;
        } else {
          message = `Prodotto aggiornato su ${successCount}/${results.length} shop.`;

          if (failedShops.length > 0) {
            message += `\n\n❌ ERRORI:`;
            failedShops.forEach(r => {
              message += `\n• ${r.shop}: ${r.error}`;
            });
          }

          if (shopsWithWarnings.length > 0) {
            message += `\n\n⚠️ AVVISI:`;
            shopsWithWarnings.forEach(r => {
              message += `\n\n${r.shop}:`;
              r.warnings?.forEach(w => {
                message += `\n  • ${w}`;
              });
            });
          }
        }

        alert(message);

        // Clear deleted images tracking
        setImagesToDelete([]);
        onSuccess?.();

      } else {
        // ========== CREATE MODE: Multiple shops ==========
        const shopsToCreate = selectedShops
          .map(id => shops.find(s => s.id === id))
          .filter((s): s is Shop => s !== undefined);

        if (shopsToCreate.length === 0) {
          throw new Error('Seleziona almeno uno shop');
        }

        const results: { shop: string; success: boolean; error?: string; warnings?: string[]; complete?: boolean }[] = [];

        for (let i = 0; i < shopsToCreate.length; i++) {
          const shop = shopsToCreate[i];
          try {
            const createResult = await createProductOnShop(shop.id, shop.name || shop.shop, i, shopsToCreate.length);
            results.push({
              shop: shop.name || shop.shop,
              success: true,
              warnings: createResult.warnings,
              complete: createResult.complete,
            });
          } catch (error: any) {
            results.push({ shop: shop.name || shop.shop, success: false, error: error.message });
          }
        }

        // Show results
        setLoadingMessage('');
        const successCount = results.filter(r => r.success).length;
        const failedShops = results.filter(r => !r.success);
        const shopsWithWarnings = results.filter(r => r.success && r.warnings && r.warnings.length > 0);
        const incompleteShops = results.filter(r => r.success && r.complete === false);

        // Build detailed message
        let message = '';

        if (failedShops.length === 0 && shopsWithWarnings.length === 0) {
          // All complete with no warnings
          message = `✅ Prodotto creato con successo su ${successCount} shop!\n\nTutti i dati sono stati inseriti correttamente.`;
        } else {
          // Some issues
          message = `Prodotto creato su ${successCount}/${results.length} shop.`;

          if (failedShops.length > 0) {
            message += `\n\n❌ ERRORI (prodotto NON creato):`;
            failedShops.forEach(r => {
              message += `\n• ${r.shop}: ${r.error}`;
            });
          }

          if (shopsWithWarnings.length > 0) {
            message += `\n\n⚠️ AVVISI (prodotto creato ma con problemi):`;
            shopsWithWarnings.forEach(r => {
              message += `\n\n${r.shop}:`;
              r.warnings?.forEach(w => {
                message += `\n  • ${w}`;
              });
            });
          }

          if (incompleteShops.length > 0 && shopsWithWarnings.length === 0) {
            message += `\n\n⚠️ Alcuni shop potrebbero avere dati incompleti.`;
          }
        }

        alert(message);
        onSuccess?.();
      }

    } catch (error: any) {
      console.error('Form submission error:', error);
      alert(`Errore: ${error.message || 'Errore durante il salvataggio'}`);
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  // Image upload component
  const ImageUpload = ({
    label,
    file,
    setFile,
  }: {
    label: string;
    file: File | null;
    setFile: (f: File | null) => void;
  }) => (
    <div className="bg-gray-50 p-4 rounded-lg">
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <input
        type="file"
        accept="image/*,image/gif"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
        className="w-full text-sm"
      />
      {file && (
        <div className="mt-2">
          <img
            src={URL.createObjectURL(file)}
            alt="Preview"
            className="h-24 w-24 object-cover rounded"
          />
        </div>
      )}
    </div>
  );

  // Loading state while fetching product data for edit
  if (loadingProduct) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Caricamento dati prodotto...</div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 relative">
      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-8 rounded-lg shadow-xl flex flex-col items-center gap-4 max-w-sm mx-4">
            <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-800 font-medium text-center">
              {loadingMessage || 'Elaborazione in corso...'}
            </p>
          </div>
        </div>
      )}

      {/* Edit mode indicator */}
      {isEditing && (
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <p className="text-blue-800 font-medium">
            Stai modificando: {title || 'Prodotto'}
          </p>
        </div>
      )}

      {/* Shop Selection - For both create and edit */}
      {shops.length > 1 && (
        <div className="bg-indigo-50 p-6 rounded-lg border border-indigo-200">
          <h3 className="text-lg font-bold mb-3 text-indigo-800">
            {isEditing ? 'Modifica Prodotto Su' : 'Crea Prodotto Su'}
          </h3>
          <p className="text-sm text-indigo-600 mb-4">
            {isEditing
              ? 'Seleziona gli shop su cui applicare le modifiche'
              : 'Seleziona gli shop su cui creare il prodotto'}
          </p>
          <div className="flex flex-wrap gap-4">
            {shops.map((shop) => (
              <label
                key={shop.id}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer border-2 transition-colors ${
                  selectedShops.includes(shop.id)
                    ? 'bg-indigo-100 border-indigo-500 text-indigo-900'
                    : 'bg-white border-gray-200 hover:border-indigo-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedShops.includes(shop.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedShops([...selectedShops, shop.id]);
                    } else {
                      // Prevent unchecking if it's the only one selected
                      if (selectedShops.length > 1) {
                        setSelectedShops(selectedShops.filter(id => id !== shop.id));
                      }
                    }
                  }}
                  className="w-4 h-4 text-indigo-600 rounded"
                />
                <span className="font-medium">{shop.name || shop.shop}</span>
              </label>
            ))}
          </div>
          {selectedShops.length > 1 && (
            <p className="text-sm text-indigo-700 mt-3 font-medium">
              {isEditing
                ? `Le modifiche verranno applicate a ${selectedShops.length} shop`
                : `Il prodotto verrà creato su ${selectedShops.length} shop`}
            </p>
          )}
        </div>
      )}

      {/* AI Generation da URL */}
      <div className="bg-purple-50 p-6 rounded-lg border border-purple-200">
        <h3 className="text-lg font-bold mb-3 text-purple-800">Genera con AI</h3>
        <p className="text-sm text-purple-600 mb-3">
          Inserisci un URL di esempio e l'AI genererà i testi.
        </p>
        <div className="flex gap-2">
          <input
            type="url"
            value={exampleUrl}
            onChange={(e) => setExampleUrl(e.target.value)}
            placeholder="https://esempio.com/prodotto"
            className="flex-1 rounded-md border-gray-300 shadow-sm px-4 py-2 border"
          />
          <button
            type="button"
            onClick={handleAIGenerate}
            disabled={aiLoading || !exampleUrl}
            className="bg-purple-600 text-white px-6 py-2 rounded-md hover:bg-purple-700 disabled:bg-gray-400 font-medium"
          >
            {aiLoading ? 'Generando...' : 'Genera'}
          </button>
        </div>
      </div>

      {/* Manual JSON Import */}
      <div className="bg-emerald-50 p-6 rounded-lg border border-emerald-200">
        <h3 className="text-lg font-bold mb-3 text-emerald-800">Importa da JSON</h3>
        <p className="text-sm text-emerald-600 mb-3">
          Incolla il JSON con i metafield (description, bullets, angles, lifestyle).
          Dovrai inserire manualmente: titolo, prezzi, immagini.
        </p>
        <textarea
          value={manualJson}
          onChange={(e) => {
            setManualJson(e.target.value);
            setJsonError('');
          }}
          placeholder={`{
  "description": "...",
  "bullet_1": "<strong>...</strong>: ...",
  "bullet_2": "...",
  "bullet_3": "...",
  "angle_1_title": "...",
  "angle_1_text": "...",
  "angle_2_title": "...",
  "angle_2_text": "...",
  "angle_3_title": "...",
  "angle_3_text": "...",
  "lifestyle_main_title": "...",
  "lifestyle_left_title": "...",
  "lifestyle_left_text": "...",
  "lifestyle_right_title": "...",
  "lifestyle_right_text": "..."
}`}
          rows={12}
          className={`w-full rounded-md shadow-sm px-4 py-2 border font-mono text-sm ${
            jsonError ? 'border-red-500 bg-red-50' : 'border-gray-300'
          }`}
        />
        {jsonError && (
          <p className="text-red-600 text-sm mt-2">{jsonError}</p>
        )}
        <button
          type="button"
          onClick={handleJsonImport}
          disabled={!manualJson.trim()}
          className="mt-3 bg-emerald-600 text-white px-6 py-2 rounded-md hover:bg-emerald-700 disabled:bg-gray-400 font-medium"
        >
          Importa JSON
        </button>
      </div>

      {/* Info Base Prodotto */}
      <div className="bg-white p-6 rounded-lg border">
        <h3 className="text-lg font-bold mb-4">Informazioni Prodotto</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome Prodotto *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full rounded-md border-gray-300 shadow-sm px-4 py-2 border"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descrizione</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border-gray-300 shadow-sm px-4 py-2 border"
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prezzo Finale (€) *</label>
              <input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => handlePriceChange(e.target.value)}
                required
                className="w-full rounded-md border-gray-300 shadow-sm px-4 py-2 border"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sconto (%)</label>
              <input
                type="number"
                step="1"
                min="0"
                max="99"
                value={discountPercent}
                onChange={(e) => handleDiscountChange(e.target.value)}
                placeholder="es: 20"
                className="w-full rounded-md border-gray-300 shadow-sm px-4 py-2 border"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prezzo Originale (€)</label>
              <input
                type="number"
                step="0.01"
                value={compareAtPrice}
                onChange={(e) => {
                  setCompareAtPrice(e.target.value);
                  setDiscountPercent(''); // Clear discount if manually edited
                }}
                placeholder="Calcolato auto"
                className={`w-full rounded-md shadow-sm px-4 py-2 border ${
                  discountPercent ? 'bg-green-50 border-green-300' : 'border-gray-300'
                }`}
              />
              {discountPercent && compareAtPrice && (
                <p className="text-xs text-green-600 mt-1">Calcolato da sconto {discountPercent}%</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SKU</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="12345"
                  className="flex-1 rounded-md border-gray-300 shadow-sm px-4 py-2 border"
                />
                <button
                  type="button"
                  onClick={() => setSku(generateSku())}
                  className="px-3 py-2 bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 text-sm"
                  title="Genera nuovo SKU"
                >
                  🔄
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tag</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="es: sport, uomo, estate, novità"
                className="w-full rounded-md border-gray-300 shadow-sm px-4 py-2 border"
              />
              <p className="text-xs text-gray-500 mt-1">Separa i tag con virgola</p>
            </div>
          </div>
        </div>
      </div>

      {/* Immagini Prodotto (Carosello) */}
      <div className="bg-white p-6 rounded-lg border">
        <h3 className="text-lg font-bold mb-4">Immagini Prodotto (Carosello)</h3>
        <ImageGallery
          images={productImages}
          onImagesChange={setProductImages}
          shopId={shopId}
          productId={product?.shopifyProductId}
          onImageDelete={(url) => {
            if (isEditing) {
              setImagesToDelete(prev => [...prev, url]);
            }
          }}
        />
      </div>

      {/* Varianti */}
      <div className="bg-white p-6 rounded-lg border">
        <h3 className="text-lg font-bold mb-4">Varianti</h3>
        <VariantBuilder
          options={variantOptions}
          combinations={variantCombinations}
          onOptionsChange={setVariantOptions}
          onCombinationsChange={setVariantCombinations}
          defaultPrice={price || '0.00'}
          defaultCompareAtPrice={compareAtPrice || undefined}
          availableImages={productImages.filter(img => img.url && (img.id || img.status === 'ready'))}
        />
      </div>

      {/* Bullets */}
      <div className="bg-white p-6 rounded-lg border">
        <h3 className="text-lg font-bold mb-2">Bullet Points</h3>
        <p className="text-sm text-gray-500 mb-4">Format: <code>&lt;strong&gt;Keyword&lt;/strong&gt;: brief description</code></p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bullet 1</label>
            <input
              type="text"
              value={bullet1}
              onChange={(e) => setBullet1(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm px-4 py-2 border"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bullet 2</label>
            <input
              type="text"
              value={bullet2}
              onChange={(e) => setBullet2(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm px-4 py-2 border"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bullet 3</label>
            <input
              type="text"
              value={bullet3}
              onChange={(e) => setBullet3(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm px-4 py-2 border"
            />
          </div>
        </div>
      </div>

      {/* Angle 1 - DESIGN */}
      <div className="bg-blue-50 p-6 rounded-lg border border-blue-200">
        <h3 className="text-lg font-bold mb-4 text-blue-800">Angle 1 - DESIGN</h3>
        <p className="text-sm text-blue-600 mb-4">Focus on aesthetics, style, visual appeal</p>
        <div className="space-y-4">
          <ImageUpload label="Immagine" file={angle1ImageFile} setFile={setAngle1ImageFile} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Titolo</label>
            <input
              type="text"
              value={angle1Title}
              onChange={(e) => setAngle1Title(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm px-4 py-2 border"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Testo</label>
            <textarea
              value={angle1Text}
              onChange={(e) => setAngle1Text(e.target.value)}
              rows={3}
              className="w-full rounded-md border-gray-300 shadow-sm px-4 py-2 border"
            />
          </div>
        </div>
      </div>

      {/* Angle 2 - FIT & COMFORT */}
      <div className="bg-green-50 p-6 rounded-lg border border-green-200">
        <h3 className="text-lg font-bold mb-4 text-green-800">Angle 2 - FIT & COMFORT</h3>
        <p className="text-sm text-green-600 mb-4">Focus on fit, comfort, functionality, wearability</p>
        <div className="space-y-4">
          <ImageUpload label="Immagine" file={angle2ImageFile} setFile={setAngle2ImageFile} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Titolo</label>
            <input
              type="text"
              value={angle2Title}
              onChange={(e) => setAngle2Title(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm px-4 py-2 border"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Testo</label>
            <textarea
              value={angle2Text}
              onChange={(e) => setAngle2Text(e.target.value)}
              rows={3}
              className="w-full rounded-md border-gray-300 shadow-sm px-4 py-2 border"
            />
          </div>
        </div>
      </div>

      {/* Angle 3 - MATERIALS */}
      <div className="bg-orange-50 p-6 rounded-lg border border-orange-200">
        <h3 className="text-lg font-bold mb-4 text-orange-800">Angle 3 - MATERIALS</h3>
        <p className="text-sm text-orange-600 mb-4">Focus on fabric quality, materials, durability</p>
        <div className="space-y-4">
          <ImageUpload label="Immagine" file={angle3ImageFile} setFile={setAngle3ImageFile} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Titolo</label>
            <input
              type="text"
              value={angle3Title}
              onChange={(e) => setAngle3Title(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm px-4 py-2 border"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Testo</label>
            <textarea
              value={angle3Text}
              onChange={(e) => setAngle3Text(e.target.value)}
              rows={3}
              className="w-full rounded-md border-gray-300 shadow-sm px-4 py-2 border"
            />
          </div>
        </div>
      </div>

      {/* Lifestyle Section */}
      <div className="bg-pink-50 p-6 rounded-lg border border-pink-200">
        <h3 className="text-lg font-bold mb-4 text-pink-800">Sezione Lifestyle</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Titolo Principale</label>
            <input
              type="text"
              value={lifestyleMainTitle}
              onChange={(e) => setLifestyleMainTitle(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm px-4 py-2 border"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            {/* Left */}
            <div className="bg-white p-4 rounded-lg">
              <h4 className="font-semibold mb-3 text-pink-700">Sinistra</h4>
              <ImageUpload label="Icona" file={lifestyleLeftIconFile} setFile={setLifestyleLeftIconFile} />
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Titolo</label>
                <input
                  type="text"
                  value={lifestyleLeftTitle}
                  onChange={(e) => setLifestyleLeftTitle(e.target.value)}
                  className="w-full rounded-md border-gray-300 shadow-sm px-3 py-2 border text-sm"
                />
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Testo</label>
                <textarea
                  value={lifestyleLeftText}
                  onChange={(e) => setLifestyleLeftText(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border-gray-300 shadow-sm px-3 py-2 border text-sm"
                />
              </div>
            </div>

            {/* Center - GIF */}
            <div className="bg-white p-4 rounded-lg">
              <h4 className="font-semibold mb-3 text-pink-700">Centro (GIF)</h4>
              <ImageUpload label="GIF/Immagine" file={lifestyleImageFile} setFile={setLifestyleImageFile} />
            </div>

            {/* Right */}
            <div className="bg-white p-4 rounded-lg">
              <h4 className="font-semibold mb-3 text-pink-700">Destra</h4>
              <ImageUpload label="Icona" file={lifestyleRightIconFile} setFile={setLifestyleRightIconFile} />
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Titolo</label>
                <input
                  type="text"
                  value={lifestyleRightTitle}
                  onChange={(e) => setLifestyleRightTitle(e.target.value)}
                  className="w-full rounded-md border-gray-300 shadow-sm px-3 py-2 border text-sm"
                />
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Testo</label>
                <textarea
                  value={lifestyleRightText}
                  onChange={(e) => setLifestyleRightText(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border-gray-300 shadow-sm px-3 py-2 border text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Size Guide */}
      <div className="bg-yellow-50 p-6 rounded-lg border border-yellow-200">
        <h3 className="text-lg font-bold mb-4 text-yellow-800">Size Guide (HTML)</h3>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Size Guide HTML Table
          </label>
          <textarea
            value={sizeGuide2}
            onChange={(e) => setSizeGuide2(e.target.value)}
            rows={10}
            placeholder="<table>...</table>"
            className="w-full rounded-md border-gray-300 shadow-sm px-4 py-2 border font-mono text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">
            Insert HTML for the size guide table (e.g. &lt;table&gt;...&lt;/table&gt;)
          </p>
        </div>
      </div>

      {/* Submit */}
      <div className="sticky bottom-0 bg-white border-t p-4">
        <button
          type="submit"
          disabled={loading || aiLoading}
          className="w-full bg-indigo-600 text-white px-6 py-3 rounded-md hover:bg-indigo-700 disabled:bg-gray-400 font-bold"
        >
          {loading ? 'Salvataggio...' : isEditing ? 'Aggiorna Prodotto' : 'Crea Prodotto'}
        </button>
      </div>
    </form>
  );
}
