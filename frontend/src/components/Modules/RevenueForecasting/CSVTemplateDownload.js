import React from 'react';
import { Button } from '../../ui/button';
import { toast } from 'react-hot-toast';

const CSVTemplateDownload = ({ templateType, label }) => {
  const templates = {
    customers: {
      filename: 'customers_template.csv',
      path: '/templates/customers_template.csv',
      description: 'Download template for importing customers'
    },
    products: {
      filename: 'products_template.csv',
      path: '/templates/products_template.csv',
      description: 'Download template for importing products'
    },
    sales_forecast: {
      filename: 'sales_forecast_template.csv',
      path: '/templates/sales_forecast_template.csv',
      description: 'Download template for importing sales forecast data'
    }
  };

  const template = templates[templateType];

  if (!template) {
    return null;
  }

  const handleDownload = () => {
    try {
      const link = document.createElement('a');
      link.href = template.path;
      link.download = template.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(`Downloaded ${template.filename}`);
    } catch (error) {
      console.error('Error downloading template:', error);
      toast.error('Failed to download template');
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleDownload}
      title={template.description}
      className="flex items-center gap-2"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      {label || `Download ${templateType.replace('_', ' ')} Template`}
    </Button>
  );
};

export default CSVTemplateDownload;


