import React from 'react';
import CSVUploadModal from './CSVUploadModal';
import api from '../../../lib/apiClient';
import { toast } from 'react-hot-toast';

const CustomerImportModal = ({ isOpen, onClose, onComplete }) => {
  const handleImport = async (importData) => {
    try {
      const { data, options } = importData;
      
      const response = await api.post('/forecast/bulk_create_customers', {
        customers: data,
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
      console.error('Error importing customers:', error);
      toast.error(`Import failed: ${error.message}`);
      throw error;
    }
  };

  return (
    <CSVUploadModal
      isOpen={isOpen}
      onClose={onClose}
      onImport={handleImport}
      importType="customers"
      existingData={{ customers: [], products: [] }}
    />
  );
};

export default CustomerImportModal;

