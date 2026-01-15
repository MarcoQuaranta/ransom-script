'use client';

import { useState, useRef, useCallback } from 'react';
import { ProductImage } from '@/types/shopify';

interface ImageGalleryProps {
  images: ProductImage[];
  onImagesChange: (images: ProductImage[]) => void;
  shopId: string;
  productId?: string;
  maxImages?: number;
  onImageDelete?: (imageUrl: string) => void; // Callback to track deleted images for multi-shop edit
}

export default function ImageGallery({
  images,
  onImagesChange,
  shopId,
  productId,
  maxImages = 50,
  onImageDelete,
}: ImageGalleryProps) {
  const [urlInput, setUrlInput] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files).filter((file) =>
        file.type.startsWith('image/')
      );

      if (files.length > 0) {
        await handleFileUpload(files);
      }
    },
    [images, maxImages]
  );

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      await handleFileUpload(files);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileUpload = async (files: File[]) => {
    const remainingSlots = maxImages - images.length;
    const filesToUpload = files.slice(0, remainingSlots);

    if (filesToUpload.length === 0) {
      alert(`Hai raggiunto il limite massimo di ${maxImages} immagini`);
      return;
    }

    // If we have a productId, upload immediately to Shopify
    if (productId) {
      // Add pending images first
      const pendingImages: ProductImage[] = filesToUpload.map((file, index) => ({
        url: URL.createObjectURL(file),
        file,
        position: images.length + index,
        status: 'pending' as const,
      }));

      onImagesChange([...images, ...pendingImages]);
      setUploading(true);

      try {
        const formData = new FormData();
        formData.append('shopId', shopId);
        formData.append('productId', productId);
        filesToUpload.forEach((file) => formData.append('files', file));

        const response = await fetch('/api/product-images', {
          method: 'POST',
          body: formData,
        });

        const result = await response.json();
        if (result.success) {
          // Replace pending images with uploaded ones
          const uploadedImages = result.images.map((img: any, index: number) => ({
            ...img,
            position: images.length + index,
            status: 'ready' as const,
          }));

          // Remove pending and add uploaded
          const nonPendingImages = images.filter((img) => img.status !== 'pending');
          onImagesChange([...nonPendingImages, ...uploadedImages]);
        } else {
          // Remove pending images on error
          onImagesChange(images.filter((img) => img.status !== 'pending'));
          alert(`Errore upload: ${result.error}`);
        }
      } catch (error) {
        console.error('Upload error:', error);
        onImagesChange(images.filter((img) => img.status !== 'pending'));
        alert('Errore durante l\'upload');
      } finally {
        setUploading(false);
      }
    } else {
      // No productId - add images as ready (will be uploaded when product is created)
      const newImages: ProductImage[] = filesToUpload.map((file, index) => ({
        url: URL.createObjectURL(file),
        file,
        position: images.length + index,
        status: 'ready' as const,
      }));

      onImagesChange([...images, ...newImages]);
    }
  };

  const addUrlImage = () => {
    if (!urlInput.trim()) return;

    if (images.length >= maxImages) {
      alert(`Hai raggiunto il limite massimo di ${maxImages} immagini`);
      return;
    }

    // Validate URL
    try {
      new URL(urlInput);
    } catch {
      alert('URL non valido');
      return;
    }

    const newImage: ProductImage = {
      url: urlInput.trim(),
      position: images.length,
      status: 'ready',
    };

    onImagesChange([...images, newImage]);
    setUrlInput('');
  };

  const removeImage = async (index: number) => {
    const image = images[index];

    // Track image URL for multi-shop deletion
    if (image.url && onImageDelete) {
      onImageDelete(image.url);
    }

    // If image has an ID and productId, delete from Shopify
    if (image.id && productId) {
      try {
        const response = await fetch(
          `/api/product-images?shopId=${shopId}&productId=${productId}&mediaId=${image.id}`,
          { method: 'DELETE' }
        );
        const result = await response.json();
        if (!result.success) {
          alert(`Errore eliminazione: ${result.error}`);
          return;
        }
      } catch (error) {
        console.error('Delete error:', error);
        alert('Errore durante l\'eliminazione');
        return;
      }
    }

    const newImages = images.filter((_, i) => i !== index);
    // Update positions
    newImages.forEach((img, i) => (img.position = i));
    onImagesChange(newImages);
  };

  // Drag and drop reordering
  const handleImageDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleImageDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newImages = [...images];
    const draggedImage = newImages[draggedIndex];
    newImages.splice(draggedIndex, 1);
    newImages.splice(index, 0, draggedImage);

    // Update positions
    newImages.forEach((img, i) => (img.position = i));

    setDraggedIndex(index);
    onImagesChange(newImages);
  };

  const handleImageDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
          isDragging
            ? 'border-teal-500 bg-teal-50'
            : 'border-gray-300 hover:border-teal-400'
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <div className="space-y-2">
          <p className="text-gray-600">
            Trascina le immagini qui oppure
          </p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            className="px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600"
            disabled={uploading}
          >
            {uploading ? 'Caricamento...' : 'Seleziona File'}
          </button>
          <p className="text-sm text-gray-500">
            PNG, JPG, GIF fino a 20MB ({images.length}/{maxImages} immagini)
          </p>
        </div>
      </div>

      {/* URL Input */}
      <div className="flex gap-2">
        <input
          type="url"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addUrlImage();
            }
          }}
          placeholder="Oppure incolla un URL immagine..."
          className="flex-1 px-3 py-2 border rounded-lg"
        />
        <button
          type="button"
          onClick={addUrlImage}
          className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
        >
          Aggiungi URL
        </button>
      </div>

      {/* Image Grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {images.map((image, index) => (
            <div
              key={image.id || image.url || index}
              className={`relative aspect-square rounded-lg overflow-hidden border-2 cursor-move ${
                draggedIndex === index ? 'border-teal-500 opacity-50' : 'border-gray-200'
              } ${image.status === 'pending' ? 'opacity-50' : ''}`}
              draggable
              onDragStart={() => handleImageDragStart(index)}
              onDragOver={(e) => handleImageDragOver(e, index)}
              onDragEnd={handleImageDragEnd}
            >
              <img
                src={image.url}
                alt={image.altText || `Immagine ${index + 1}`}
                className="w-full h-full object-cover"
              />

              {/* Position badge */}
              <span className="absolute top-1 left-1 bg-black/50 text-white text-xs px-2 py-1 rounded">
                {index + 1}
              </span>

              {/* Status indicator */}
              {image.status === 'pending' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              {/* Delete button */}
              <button
                type="button"
                onClick={() => removeImage(index)}
                className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600"
                disabled={image.status === 'pending'}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {images.length === 0 && (
        <p className="text-gray-500 text-sm italic text-center">
          Nessuna immagine. Carica o aggiungi immagini per la galleria prodotto.
        </p>
      )}

      <p className="text-xs text-gray-500">
        La prima immagine sarà quella principale. Trascina per riordinare.
      </p>
    </div>
  );
}
