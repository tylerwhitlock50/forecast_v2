import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';

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
  const [showBOMCreator, setShowBOMCreator] = useState(false);
  const [showRouterCreator, setShowRouterCreator] = useState(false);
  const [newBOMData, setNewBOMData] = useState({
    bom_name: '',
    bom_description: '',
    version: '1.0'
  });
  const [newRouterData, setNewRouterData] = useState({
    router_name: '',
    router_description: '',
    version: '1.0'
  });

  // Initialize form when modal opens or product changes
  useEffect(() => {
    if (isOpen) {
      console.log('ProductModal - product data:', product);
      if (product) {
        // Editing existing product
        const formDataToSet = {
          unit_id: product.unit_id || '',
          unit_name: product.unit_name || '',
          unit_description: product.unit_description || '',
          base_price: product.base_price || '',
          unit_type: product.unit_type || '',
          bom: product.bom || '',
          router: product.router || ''
        };
        console.log('ProductModal - setting form data for editing:', formDataToSet);
        setFormData(formDataToSet);
      } else {
        // Creating new product
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
      setShowBOMCreator(false);
      setShowRouterCreator(false);
    }
  }, [isOpen, product]);

  // Get unique BOM IDs and Router IDs for dropdowns with descriptive names
  const uniqueBOMs = [...new Set(bomData.map(item => item.bom_id))].sort();
  const uniqueRouters = [...new Set(routerData.map(item => item.router_id))].sort();
  
  // Get BOM and Router names for display
  const getBOMDisplayName = (bomId) => {
    if (!bomId) return '';
    
    // Look for BOM definition with bom_name
    const bomDefinition = bomData.find(item => item.bom_id === bomId);
    if (bomDefinition && bomDefinition.bom_name) {
      return `${bomId} - ${bomDefinition.bom_name}`;
    }
    
    // Fallback to counting materials
    const bomItems = bomData.filter(item => item.bom_id === bomId);
    if (bomItems.length > 0) {
      const materialCount = bomItems.length;
      return `${bomId} (${materialCount} materials)`;
    }
    return bomId;
  };
  
  const getRouterDisplayName = (routerId) => {
    if (!routerId) return '';
    const router = routerData.find(item => item.router_id === routerId);
    if (router && router.router_name) {
      return `${routerId} - ${router.router_name}`;
    }
    return routerId;
  };

  // Handle BOM creation
  const handleCreateBOM = async () => {
    if (!newBOMData.bom_name.trim()) {
      toast.error('BOM name is required');
      return;
    }

    try {
      // Generate BOM ID
      const boms = Array.isArray(bomData) ? bomData : [];
      const maxId = Math.max(...boms.map(b => {
        const id = b.bom_id?.replace('BOM-', '') || '0';
        return parseInt(id) || 0;
      }), 0);
      const bomId = `BOM-${String(maxId + 1).padStart(3, '0')}`;

      const bomDataToSave = {
        ...newBOMData,
        bom_id: bomId
      };

      await actions.createBOMDefinition(bomDataToSave);
      toast.success(`BOM "${bomDataToSave.bom_name}" created successfully`);
      
      // Update the form with the new BOM
      setFormData(prev => ({ ...prev, bom: bomId }));
      setShowBOMCreator(false);
      setNewBOMData({ bom_name: '', bom_description: '', version: '1.0' });
      
      // Refresh data to get the new BOM
      await actions.fetchAllData();
    } catch (error) {
      console.error('Error creating BOM:', error);
      toast.error('Failed to create BOM');
    }
  };

  // Handle Router creation
  const handleCreateRouter = async () => {
    if (!newRouterData.router_name.trim()) {
      toast.error('Router name is required');
      return;
    }

    try {
      // Generate Router ID
      const routers = Array.isArray(routerData) ? routerData : [];
      const maxId = Math.max(...routers.map(r => {
        const id = r.router_id?.replace('R', '') || '0';
        return parseInt(id) || 0;
      }), 0);
      const routerId = `R${String(maxId + 1).padStart(4, '0')}`;

      const routerDataToSave = {
        ...newRouterData,
        router_id: routerId
      };

      await actions.createRouter(routerDataToSave);
      toast.success(`Router "${routerDataToSave.router_name}" created successfully`);
      
      // Update the form with the new Router
      setFormData(prev => ({ ...prev, router: routerId }));
      setShowRouterCreator(false);
      setNewRouterData({ router_name: '', router_description: '', version: '1.0' });
      
      // Refresh data to get the new Router
      await actions.fetchAllData();
    } catch (error) {
      console.error('Error creating Router:', error);
      toast.error('Failed to create Router');
    }
  };

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    // Remove Product ID validation requirement for new products - it will be auto-generated
    // if (!product && !formData.unit_id.trim()) {
    //   newErrors.unit_id = 'Product ID is required';
    // }
    
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

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      toast.error('Please fix the errors in the form');
      return;
    }

    try {
      // Convert base_price to number if it's a string
      let submitData = {
        ...formData,
        base_price: formData.base_price ? parseFloat(formData.base_price) : 0
      };
      
      // Auto-generate Product ID if not provided for new products
      if (!product && !submitData.unit_id.trim()) {
        // This will be handled by the backend or context
        console.log('Product ID will be auto-generated');
      }
      
      await onSave(submitData);
    } catch (error) {
      console.error('Error saving product:', error);
      toast.error('Failed to save product');
    }
  };

  // Handle input changes
  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Modal Header */}
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

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Product Information Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
              Product Information
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Product ID */}
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
                  disabled={!!product} // Disable editing of ID for existing products
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

              {/* Product Name */}
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

            {/* Description */}
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
              {/* Base Price */}
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

              {/* Product Type */}
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

          {/* Manufacturing Configuration Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
              Manufacturing Configuration
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* BOM */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Bill of Materials (BOM)
                </label>
                <div className="flex gap-2">
                  <select
                    value={formData.bom}
                    onChange={(e) => handleInputChange('bom', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  >
                    <option value="">Select BOM</option>
                    {uniqueBOMs.map(bomId => (
                      <option key={bomId} value={bomId}>{getBOMDisplayName(bomId)}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowBOMCreator(!showBOMCreator)}
                    className="px-3 py-2 text-sm font-medium text-orange-600 bg-orange-50 border border-orange-200 rounded-md hover:bg-orange-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    {showBOMCreator ? 'Cancel' : 'Create New'}
                  </button>
                </div>
                
                {/* BOM Creator */}
                {showBOMCreator && (
                  <div className="mt-3 p-4 bg-gray-50 rounded-md border border-gray-200">
                    <h4 className="text-sm font-medium text-gray-900 mb-3">Create New BOM</h4>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          BOM Name *
                        </label>
                        <input
                          type="text"
                          value={newBOMData.bom_name}
                          onChange={(e) => setNewBOMData(prev => ({ ...prev, bom_name: e.target.value }))}
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
                          placeholder="Enter BOM name"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Description
                        </label>
                        <textarea
                          value={newBOMData.bom_description}
                          onChange={(e) => setNewBOMData(prev => ({ ...prev, bom_description: e.target.value }))}
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
                          placeholder="Enter BOM description"
                          rows="2"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleCreateBOM}
                          className="px-3 py-1 text-xs font-medium text-white bg-orange-600 border border-transparent rounded-md hover:bg-orange-700 focus:outline-none focus:ring-1 focus:ring-orange-500"
                        >
                          Create BOM
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowBOMCreator(false)}
                          className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-orange-500"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Router */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Router
                </label>
                <div className="flex gap-2">
                  <select
                    value={formData.router}
                    onChange={(e) => handleInputChange('router', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  >
                    <option value="">Select Router</option>
                    {uniqueRouters.map(routerId => (
                      <option key={routerId} value={routerId}>{getRouterDisplayName(routerId)}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowRouterCreator(!showRouterCreator)}
                    className="px-3 py-2 text-sm font-medium text-orange-600 bg-orange-50 border border-orange-200 rounded-md hover:bg-orange-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    {showRouterCreator ? 'Cancel' : 'Create New'}
                  </button>
                </div>
                
                {/* Router Creator */}
                {showRouterCreator && (
                  <div className="mt-3 p-4 bg-gray-50 rounded-md border border-gray-200">
                    <h4 className="text-sm font-medium text-gray-900 mb-3">Create New Router</h4>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Router Name *
                        </label>
                        <input
                          type="text"
                          value={newRouterData.router_name}
                          onChange={(e) => setNewRouterData(prev => ({ ...prev, router_name: e.target.value }))}
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
                          placeholder="Enter router name"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Description
                        </label>
                        <input
                          type="text"
                          value={newRouterData.router_description}
                          onChange={(e) => setNewRouterData(prev => ({ ...prev, router_description: e.target.value }))}
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
                          placeholder="Enter router description"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleCreateRouter}
                          className="px-3 py-1 text-xs font-medium text-white bg-orange-600 border border-transparent rounded-md hover:bg-orange-700 focus:outline-none focus:ring-1 focus:ring-orange-500"
                        >
                          Create Router
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowRouterCreator(false)}
                          className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-orange-500"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-orange-600 border border-transparent rounded-md hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500"
            >
              {product ? 'Update Product' : 'Create Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProductModal; 