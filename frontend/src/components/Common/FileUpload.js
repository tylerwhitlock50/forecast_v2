import React, { useCallback, useState } from 'react';
import { toast } from 'react-hot-toast';

const FileUpload = ({ 
  onFileSelect, 
  accept = '.csv',
  maxSize = 5 * 1024 * 1024, // 5MB default
  className = '',
  disabled = false
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [, setDragCounter] = useState(0); // counter only tracks nested dragenter/dragleave

  const validateFile = (file) => {
    if (!file) return { valid: false, error: 'No file selected' };
    
    // Check file type
    if (accept && !file.name.toLowerCase().endsWith('.csv')) {
      return { valid: false, error: 'File must be a CSV file' };
    }
    
    // Check file size
    if (file.size > maxSize) {
      return { 
        valid: false, 
        error: `File size exceeds ${(maxSize / 1024 / 1024).toFixed(1)}MB limit` 
      };
    }
    
    return { valid: true };
  };

  const handleFile = useCallback((file) => {
    const validation = validateFile(file);
    if (!validation.valid) {
      toast.error(validation.error);
      return;
    }
    
    onFileSelect(file);
    // validateFile is re-created each render but only closes over maxSize/accept, which are props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onFileSelect, maxSize]);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => prev + 1);
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => {
      const newCount = prev - 1;
      if (newCount === 0) {
        setIsDragging(false);
      }
      return newCount;
    });
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setDragCounter(0);

    if (disabled) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
      e.dataTransfer.clearData();
    }
  }, [handleFile, disabled]);

  const handleFileInput = useCallback((e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  }, [handleFile]);

  return (
    <div
      className={`relative border-2 border-dashed rounded-lg p-8 transition-colors ${
        isDragging
          ? 'border-orange-500 bg-orange-50'
          : 'border-gray-300 hover:border-gray-400'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={() => !disabled && document.getElementById('file-input')?.click()}
    >
      <input
        id="file-input"
        type="file"
        accept={accept}
        onChange={handleFileInput}
        className="hidden"
        disabled={disabled}
      />
      <div className="flex flex-col items-center justify-center text-center">
        <svg
          className={`w-12 h-12 mb-4 ${isDragging ? 'text-orange-500' : 'text-gray-400'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="text-sm font-medium text-gray-700 mb-1">
          {isDragging ? 'Drop file here' : 'Drag and drop CSV file here'}
        </p>
        <p className="text-xs text-gray-500">
          or click to browse
        </p>
        <p className="text-xs text-gray-400 mt-2">
          Maximum file size: {(maxSize / 1024 / 1024).toFixed(1)}MB
        </p>
      </div>
    </div>
  );
};

export default FileUpload;


