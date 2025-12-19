
import React, { useRef } from 'react';
import { UploadIcon, TrashIcon } from './Icons';
import { UploadedImage } from '../types';

interface ImageUploaderProps {
  label: string;
  subLabel?: string;
  images: UploadedImage[];
  onImagesUpload: (newImages: UploadedImage[]) => void;
  onRemove: (id: string) => void;
  icon?: React.ReactNode;
  multiple?: boolean;
  maxCount?: number;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({ 
  label, 
  images, 
  onImagesUpload, 
  onRemove,
  icon,
  multiple = true,
  maxCount = 5
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isFull = images.length >= maxCount;

  const resizeImage = (file: File, maxWidth = 1024): Promise<{base64: string, mimeType: string}> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxWidth) {
              height *= maxWidth / width;
              width = maxWidth;
            }
          } else {
            if (height > maxWidth) {
              width *= maxWidth / height;
              height = maxWidth;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve({
            base64: canvas.toDataURL('image/jpeg', 0.8),
            mimeType: 'image/jpeg'
          });
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const processFile = async (file: File): Promise<UploadedImage> => {
    const resized = await resizeImage(file);
    return {
      id: Math.random().toString(36).substr(2, 9),
      file,
      previewUrl: URL.createObjectURL(file),
      base64: resized.base64,
      mimeType: resized.mimeType,
    };
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    const remainingSlots = maxCount - images.length;
    const filesToProcess = files.slice(0, remainingSlots);
    
    const newImages = await Promise.all(filesToProcess.map(processFile));
    onImagesUpload(newImages);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (isFull) return;

    const files = Array.from(e.dataTransfer.files)
      .filter((f) => (f as File).type.startsWith('image/')) as File[];
    
    if (files.length === 0) return;

    const remainingSlots = maxCount - images.length;
    const filesToProcess = files.slice(0, remainingSlots);

    const newImages = await Promise.all(filesToProcess.map(processFile));
    onImagesUpload(newImages);
  };

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between text-sm font-medium text-gray-300">
        <div className="flex items-center gap-2">
          {icon}
          {label}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded transition-colors ${isFull ? 'bg-red-500/20 text-red-400' : 'bg-slate-700 text-slate-400'}`}>
          {images.length} / {maxCount}
        </span>
      </div>
      
      <div className="space-y-3">
        <div 
          onClick={() => !isFull && fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl transition-all p-4 flex flex-col items-center justify-center group ${
            isFull 
            ? 'border-gray-700 bg-gray-800/10 cursor-not-allowed' 
            : 'border-gray-600 bg-gray-800/30 hover:bg-gray-800 hover:border-indigo-500 cursor-pointer'
          }`}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept="image/*" 
            multiple={multiple}
            disabled={isFull}
            className="hidden" 
          />
          <div className={`p-2 rounded-full transition-colors ${
            isFull ? 'bg-gray-800 text-gray-600' : 'bg-gray-700/50 group-hover:bg-indigo-500/20 text-gray-400 group-hover:text-indigo-400'
          }`}>
            <UploadIcon className="w-5 h-5" />
          </div>
          <p className={`mt-2 text-xs transition-colors ${isFull ? 'text-gray-600' : 'text-gray-400 group-hover:text-gray-300'}`}>
            {isFull ? 'Limit reached' : (multiple ? 'Add images' : 'Upload image')}
          </p>
        </div>

        {images.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {images.map((img) => (
              <div key={img.id} className="relative aspect-square rounded-lg overflow-hidden border border-slate-700 group">
                <img src={img.previewUrl} alt="Preview" className="w-full h-full object-cover" />
                <button 
                  onClick={(e) => { e.stopPropagation(); onRemove(img.id); }}
                  className="absolute inset-0 bg-red-500/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageUploader;
