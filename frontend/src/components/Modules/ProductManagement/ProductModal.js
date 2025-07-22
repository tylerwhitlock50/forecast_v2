import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';


const ProductModal = ({ isOpen, onClose, onSave, product, bomData, routerData }) => {
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
    <div className="product-modal-overlay" onClick={onClose}>
      <div className="product-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{product ? 'Edit Product' : 'Add New Product'}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="product-form">
          <div className="form-section">
            <h3>Product Information</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Product ID</label>
                <input
                  type="text"
                  value={formData.unit_id}
                  onChange={(e) => handleInputChange('unit_id', e.target.value)}
                  className={errors.unit_id ? 'error' : ''}
                  placeholder={product ? "e.g., PROD-001" : "Auto-generated if left empty"}
                  disabled={!!product} // Disable editing of ID for existing products
                />
                {errors.unit_id && <span className="error-message">{errors.unit_id}</span>}
              </div>

              <div className="form-group">
                <label>Product Name *</label>
                <input
                  type="text"
                  value={formData.unit_name}
                  onChange={(e) => handleInputChange('unit_name', e.target.value)}
                  className={errors.unit_name ? 'error' : ''}
                  placeholder="Enter product name"
                />
                {errors.unit_name && <span className="error-message">{errors.unit_name}</span>}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={formData.unit_description}
                  onChange={(e) => handleInputChange('unit_description', e.target.value)}
                  placeholder="Enter product description"
                  rows="3"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Base Price</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.base_price}
                  onChange={(e) => handleInputChange('base_price', e.target.value)}
                  className={errors.base_price ? 'error' : ''}
                  placeholder="0.00"
                />
                {errors.base_price && <span className="error-message">{errors.base_price}</span>}
              </div>

              <div className="form-group">
                <label>Product Type</label>
                <select
                  value={formData.unit_type}
                  onChange={(e) => handleInputChange('unit_type', e.target.value)}
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

          <div className="form-section">
            <h3>Manufacturing Configuration</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Bill of Materials (BOM)</label>
                <select
                  value={formData.bom}
                  onChange={(e) => handleInputChange('bom', e.target.value)}
                >
                  <option value="">Select BOM</option>
                  {uniqueBOMs.map(bomId => (
                    <option key={bomId} value={bomId}>{getBOMDisplayName(bomId)}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Router</label>
                <select
                  value={formData.router}
                  onChange={(e) => handleInputChange('router', e.target.value)}
                >
                  <option value="">Select Router</option>
                  {uniqueRouters.map(routerId => (
                    <option key={routerId} value={routerId}>{getRouterDisplayName(routerId)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {product ? 'Update Product' : 'Create Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProductModal; 