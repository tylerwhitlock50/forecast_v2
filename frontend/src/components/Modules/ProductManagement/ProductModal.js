import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import UnitCostPreview from '../../Common/UnitCostPreview';

const nextSequentialId = (items, field, prefix, width) => {
  const list = Array.isArray(items) ? items : [];
  const maxId = list.reduce((max, item) => {
    const raw = item?.[field] || '';
    const digits = raw.replace(prefix, '');
    const n = parseInt(digits, 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `${prefix}${String(maxId + 1).padStart(width, '0')}`;
};

const ProductModal = ({ isOpen, onClose, onSave, product, bomData, routerData, actions }) => {
  const [formData, setFormData] = useState({
    unit_id: '',
    unit_name: '',
    unit_description: '',
    base_price: '',
    unit_type: '',
    bom: '',
    router: ''
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (product) {
      setFormData({
        unit_id: product.unit_id || '',
        unit_name: product.unit_name || '',
        unit_description: product.unit_description || '',
        base_price: product.base_price || '',
        unit_type: product.unit_type || '',
        bom: product.bom || '',
        router: product.router || ''
      });
    } else {
      setFormData({
        unit_id: '',
        unit_name: '',
        unit_description: '',
        base_price: '',
        unit_type: '',
        bom: '',
        router: ''
      });
    }
    setErrors({});
  }, [isOpen, product]);

  const uniqueBOMs = [...new Set((bomData || []).map(item => item.bom_id))].sort();
  const uniqueRouters = [...new Set((routerData || []).map(item => item.router_id))].sort();

  const getBOMDisplayName = (bomId) => {
    if (!bomId) return '';
    const bomDefinition = (bomData || []).find(item => item.bom_id === bomId);
    if (bomDefinition && bomDefinition.bom_name) {
      return `${bomId} - ${bomDefinition.bom_name}`;
    }
    const bomItems = (bomData || []).filter(item => item.bom_id === bomId);
    if (bomItems.length > 0) {
      return `${bomId} (${bomItems.length} materials)`;
    }
    return bomId;
  };

  const getRouterDisplayName = (routerId) => {
    if (!routerId) return '';
    const router = (routerData || []).find(item => item.router_id === routerId);
    if (router && router.router_name) {
      return `${routerId} - ${router.router_name}`;
    }
    return routerId;
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.unit_name.trim()) {
      newErrors.unit_name = 'Product name is required';
    }
    if (formData.base_price && isNaN(parseFloat(formData.base_price))) {
      newErrors.base_price = 'Base price must be a valid number';
    }
    if (formData.base_price && parseFloat(formData.base_price) < 0) {
      newErrors.base_price = 'Base price cannot be negative';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      toast.error('Please fix the errors in the form');
      return;
    }

    setSubmitting(true);
    try {
      let { bom, router } = formData;
      const productName = formData.unit_name.trim();

      // Auto-create BOM if left blank
      if (!bom) {
        const newBomId = nextSequentialId(bomData, 'bom_id', 'BOM-', 3);
        await actions.createBOMDefinition({
          bom_id: newBomId,
          bom_name: `${productName} BOM`,
          bom_description: `Auto-created for ${productName}`,
          version: '1.0'
        }, { silent: true });
        bom = newBomId;
      }

      // Auto-create Router if left blank
      if (!router) {
        const newRouterId = nextSequentialId(routerData, 'router_id', 'R', 4);
        await actions.createRouter({
          router_id: newRouterId,
          router_name: `${productName} Routing`,
          router_description: `Auto-created for ${productName}`,
          version: '1.0'
        }, { silent: true });
        router = newRouterId;
      }

      const submitData = {
        ...formData,
        bom,
        router,
        base_price: formData.base_price ? parseFloat(formData.base_price) : 0
      };

      await onSave(submitData);
    } catch (error) {
      console.error('Error saving product:', error);
      toast.error('Failed to save product');
    } finally {
      setSubmitting(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {product ? 'Edit Product' : 'Add New Product'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
              Product Information
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Product ID
                </label>
                <input
                  type="text"
                  value={formData.unit_id}
                  onChange={(e) => handleInputChange('unit_id', e.target.value)}
                  className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 ${
                    errors.unit_id ? 'border-red-500' : 'border-gray-300'
                  } ${!!product ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                  placeholder={product ? "e.g., PROD-001" : "Auto-generated if left empty"}
                  disabled={!!product}
                />
                {!product && (
                  <p className="mt-1 text-sm text-gray-500">
                    Product ID will be auto-generated if left empty
                  </p>
                )}
                {errors.unit_id && (
                  <p className="mt-1 text-sm text-red-600">{errors.unit_id}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Product Name *
                </label>
                <input
                  type="text"
                  value={formData.unit_name}
                  onChange={(e) => handleInputChange('unit_name', e.target.value)}
                  className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 ${
                    errors.unit_name ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="Enter product name"
                />
                {errors.unit_name && (
                  <p className="mt-1 text-sm text-red-600">{errors.unit_name}</p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
              <textarea
                value={formData.unit_description}
                onChange={(e) => handleInputChange('unit_description', e.target.value)}
                placeholder="Enter product description"
                rows="3"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Base Price
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.base_price}
                  onChange={(e) => handleInputChange('base_price', e.target.value)}
                  className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 ${
                    errors.base_price ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="0.00"
                />
                {errors.base_price && (
                  <p className="mt-1 text-sm text-red-600">{errors.base_price}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Product Type
                </label>
                <select
                  value={formData.unit_type}
                  onChange={(e) => handleInputChange('unit_type', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                >
                  <option value="">Select Type</option>
                  <option value="each">Each</option>
                  <option value="unit">Unit</option>
                  <option value="piece">Piece</option>
                  <option value="set">Set</option>
                  <option value="kit">Kit</option>
                  <option value="box">Box</option>
                  <option value="case">Case</option>
                  <option value="pallet">Pallet</option>
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
              Manufacturing Configuration
            </h3>
            <p className="text-sm text-gray-500">
              Leave either dropdown empty to auto-create a matching BOM or Router for this product.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Bill of Materials (BOM)
                </label>
                <select
                  value={formData.bom}
                  onChange={(e) => handleInputChange('bom', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                >
                  <option value="">Auto-create new BOM</option>
                  {uniqueBOMs.map(bomId => (
                    <option key={bomId} value={bomId}>{getBOMDisplayName(bomId)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Router
                </label>
                <select
                  value={formData.router}
                  onChange={(e) => handleInputChange('router', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                >
                  <option value="">Auto-create new Router</option>
                  {uniqueRouters.map(routerId => (
                    <option key={routerId} value={routerId}>{getRouterDisplayName(routerId)}</option>
                  ))}
                </select>
              </div>
            </div>

            <UnitCostPreview
              bomId={formData.bom || null}
              bomVersion={product?.bom_version || '1.0'}
              routerId={formData.router || null}
              className="mt-2"
            />
          </div>

          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-orange-600 border border-transparent rounded-md hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : (product ? 'Update Product' : 'Create Product')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProductModal;
