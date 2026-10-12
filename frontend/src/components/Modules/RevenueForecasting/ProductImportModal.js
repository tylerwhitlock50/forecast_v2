import React from 'react';
import CSVUploadModal from './CSVUploadModal';
import api from '../../../lib/apiClient';
import { toast } from 'react-hot-toast';

const ProductImportModal = ({ isOpen, onClose, onComplete }) => {
  const handleImport = async (importData) => {
    try {
      const { data } = importData;
      
      const response = await api.post('/forecast/bulk_create_products', {
        products: data,
        options: {
          merge_strategy: importData.options?.merge_strategy || 'skip'
        }
      });
      
      if (response.status === 'success') {
        toast.success(response.message);
        if (onComplete) {
          await onComplete();
        }
        return true;
      } else {
        throw new Error(response.message || 'Import failed');
      }
    } catch (error) {
      console.error('Error importing products:', error);
      toast.error(`Import failed: ${error.message}`);
      throw error;
    }
  };

  return (
    <CSVUploadModal
      isOpen={isOpen}
      onClose={onClose}
      onImport={handleImport}
      importType="products"
      existingData={{ customers: [], products: [] }}
    />
  );
};

export default ProductImportModal;

