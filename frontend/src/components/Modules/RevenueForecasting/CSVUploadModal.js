import React, { useState, useCallback } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Label } from '../../ui/label';
import { Select, SelectOption } from '../../ui/select';
import FileUpload from '../../Common/FileUpload';
import CSVTemplateDownload from './CSVTemplateDownload';
import { toast } from 'react-hot-toast';
import Papa from 'papaparse';

const CSVUploadModal = ({ 
  isOpen, 
  onClose, 
  onImport, 
  importType = 'sales_forecast', // 'sales_forecast', 'customers', 'products'
  existingData = { customers: [], products: [] }
}) => {
  const [file, setFile] = useState(null);
  const [previewData, setPreviewData] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [importOptions, setImportOptions] = useState({
    mode: 'append', // 'append' or 'replace'
    autoCreate: true, // Auto-create missing customers/products
    skipInvalid: true, // Skip invalid rows vs stop on error
    merge_strategy: 'skip', // 'skip', 'update', 'create_new' (for customers/products)
  });
  const [errors, setErrors] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [missingItems, setMissingItems] = useState({ customers: [], products: [] });
  const [isProcessing, setIsProcessing] = useState(false);
  const [columnMapping, setColumnMapping] = useState({});

  const parseCSV = useCallback((csvText) => {
    return new Promise((resolve, reject) => {
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim(),
        complete: (results) => {
          if (results.errors.length > 0) {
            reject(new Error(`CSV parsing errors: ${results.errors.map(e => e.message).join(', ')}`));
            return;
          }
          resolve(results.data);
        },
        error: (error) => {
          reject(error);
        }
      });
    });
  }, []);

  const validateAndPreview = useCallback(async (file) => {
    try {
      setIsProcessing(true);
      const text = await file.text();
      const data = await parseCSV(text);
      
      if (data.length === 0) {
        toast.error('CSV file is empty');
        setIsProcessing(false);
        return;
      }

      // Get headers from first row
      const csvHeaders = Object.keys(data[0]);
      setHeaders(csvHeaders);
      
      // Map columns based on import type
      const mapping = mapColumns(csvHeaders, importType);
      setColumnMapping(mapping);
      
      // Validate and detect missing items
      const validation = validateData(data, mapping, importType);
      setErrors(validation.errors);
      setWarnings(validation.warnings);
      setMissingItems(validation.missingItems);
      
      // Show preview (first 10 rows)
      setPreviewData(data.slice(0, 10));
      
      toast.success(`Parsed ${data.length} rows. ${validation.errors.length} errors, ${validation.warnings.length} warnings.`);
    } catch (error) {
      console.error('Error parsing CSV:', error);
      toast.error(`Failed to parse CSV: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [importType, parseCSV]);

  const mapColumns = (csvHeaders, type) => {
    const mapping = {};
    const expectedColumns = getExpectedColumns(type);
    
    csvHeaders.forEach(header => {
      const normalized = header.toLowerCase().trim();
      // Try to find matching expected column
      for (const [expectedKey, expectedAliases] of Object.entries(expectedColumns)) {
        if (expectedAliases.some(alias => normalized.includes(alias.toLowerCase()))) {
          mapping[header] = expectedKey;
          break;
        }
      }
    });
    
    return mapping;
  };

  const getExpectedColumns = (type) => {
    switch (type) {
      case 'customers':
        return {
          customer_id: ['customer_id', 'customer id', 'id'],
          customer_name: ['customer_name', 'customer name', 'name'],
          customer_type: ['customer_type', 'customer type', 'type'],
          region: ['region']
        };
      case 'products':
        return {
          unit_id: ['unit_id', 'product_id', 'product id', 'id'],
          unit_name: ['unit_name', 'product_name', 'product name', 'name'],
          unit_description: ['unit_description', 'description', 'desc'],
          base_price: ['base_price', 'price', 'unit_price'],
          unit_type: ['unit_type', 'type'],
          bom_id: ['bom_id', 'bom'],
          router_id: ['router_id', 'router']
        };
      case 'sales_forecast':
        return {
          customer_id: ['customer_id', 'customer id', 'customer'],
          product_id: ['product_id', 'unit_id', 'product id', 'product'],
          period: ['period', 'date', 'month'],
          quantity: ['quantity', 'qty', 'q'],
          price: ['price', 'unit_price', 'unit price']
        };
      default:
        return {};
    }
  };

  const validateData = (data, mapping, type) => {
    const errors = [];
    const warnings = [];
    const missingItems = { customers: [], products: [] };
    
    const requiredFields = getRequiredFields(type);
    
    data.forEach((row, index) => {
      const rowNum = index + 2; // +2 because index is 0-based and we skip header
      
      // Check required fields
      requiredFields.forEach(field => {
        const mappedKey = Object.keys(mapping).find(k => mapping[k] === field);
        const value = mappedKey ? row[mappedKey] : row[field];
        
        if (!value || (typeof value === 'string' && value.trim() === '')) {
          errors.push({
            row: rowNum,
            field,
            message: `Missing required field: ${field}`
          });
        }
      });
      
      // Type-specific validation
      if (type === 'sales_forecast') {
        const customerId = row[mapping.customer_id] || row.customer_id;
        const productId = row[mapping.product_id] || row.product_id;
        
        // Check if customer exists
        if (customerId && !existingData.customers.find(c => c.customer_id === customerId)) {
          if (!missingItems.customers.find(c => c.id === customerId)) {
            missingItems.customers.push({ id: customerId, name: customerId });
          }
          warnings.push({
            row: rowNum,
            message: `Customer ${customerId} does not exist`
          });
        }
        
        // Check if product exists
        if (productId && !existingData.products.find(p => (p.unit_id || p.id) === productId)) {
          if (!missingItems.products.find(p => p.id === productId)) {
            missingItems.products.push({ id: productId, name: productId });
          }
          warnings.push({
            row: rowNum,
            message: `Product ${productId} does not exist`
          });
        }
        
        // Validate period format
        const period = row[mapping.period] || row.period;
        if (period && !/^\d{4}-\d{2}/.test(period)) {
          warnings.push({
            row: rowNum,
            message: `Invalid period format: ${period}. Expected YYYY-MM`
          });
        }
        
        // Validate numeric fields
        const quantity = parseFloat(row[mapping.quantity] || row.quantity);
        const price = parseFloat(row[mapping.price] || row.price);
        
        if (isNaN(quantity) || quantity < 0) {
          errors.push({
            row: rowNum,
            field: 'quantity',
            message: `Invalid quantity: ${row[mapping.quantity] || row.quantity}`
          });
        }
        
        if (isNaN(price) || price < 0) {
          errors.push({
            row: rowNum,
            field: 'price',
            message: `Invalid price: ${row[mapping.price] || row.price}`
          });
        }
      }
    });
    
    return { errors, warnings, missingItems };
  };

  const getRequiredFields = (type) => {
    switch (type) {
      case 'customers':
        return ['customer_id', 'customer_name'];
      case 'products':
        return ['unit_id', 'unit_name'];
      case 'sales_forecast':
        return ['customer_id', 'product_id', 'period', 'quantity', 'price'];
      default:
        return [];
    }
  };

  const handleFileSelect = useCallback((selectedFile) => {
    setFile(selectedFile);
    setPreviewData([]);
    setErrors([]);
    setWarnings([]);
    setMissingItems({ customers: [], products: [] });
    validateAndPreview(selectedFile);
  }, [validateAndPreview]);

  const handleImport = useCallback(async () => {
    if (!file) {
      toast.error('Please select a file first');
      return;
    }

    if (errors.length > 0 && !importOptions.skipInvalid) {
      toast.error('Please fix errors before importing');
      return;
    }

    try {
      setIsProcessing(true);
      const text = await file.text();
      const data = await parseCSV(text);
      
      // Transform data using column mapping
      const transformedData = data.map(row => {
        const transformed = {};
        Object.entries(columnMapping).forEach(([csvHeader, expectedKey]) => {
          transformed[expectedKey] = row[csvHeader];
        });
        // Also include any unmapped columns
        Object.keys(row).forEach(key => {
          if (!columnMapping[key]) {
            transformed[key] = row[key];
          }
        });
        return transformed;
      });

      await onImport({
        data: transformedData,
        options: {
          ...importOptions,
          merge_strategy: importOptions.merge_strategy || 'skip'
        },
        missingItems,
        errors: errors.filter(e => !importOptions.skipInvalid),
        warnings
      });
      
      toast.success('Import completed successfully');
      onClose();
    } catch (error) {
      console.error('Error during import:', error);
      toast.error(`Import failed: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [file, importOptions, missingItems, errors, warnings, columnMapping, onImport, onClose, parseCSV]);

  if (!isOpen) return null;

  return (
    <Modal onClick={onClose}>
      <div onClick={e => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>
            Import {importType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
          </ModalTitle>
          <ModalClose onClick={onClose} />
        </ModalHeader>
        <ModalContent className="space-y-6">
          {/* Template Download */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-gray-700">Need a template?</p>
              <p className="text-xs text-gray-500">Download a CSV template to get started</p>
            </div>
            <CSVTemplateDownload templateType={importType} />
          </div>

          {/* File Upload */}
          <div className="space-y-2">
            <Label>Select CSV File</Label>
            <FileUpload
              onFileSelect={handleFileSelect}
              accept=".csv"
              disabled={isProcessing}
            />
            {file && (
              <p className="text-sm text-gray-600 mt-2">
                Selected: {file.name} ({(file.size / 1024).toFixed(2)} KB)
              </p>
            )}
          </div>

          {/* Import Options */}
          {file && (
            <div className="space-y-4 p-4 border border-gray-200 rounded-lg">
              <h3 className="text-sm font-semibold text-gray-900">Import Options</h3>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="mode">Import Mode</Label>
                  <Select
                    id="mode"
                    value={importOptions.mode}
                    onChange={(e) => setImportOptions(prev => ({ ...prev, mode: e.target.value }))}
                    className="w-40"
                  >
                    <SelectOption value="append">Append</SelectOption>
                    <SelectOption value="replace">Replace</SelectOption>
                  </Select>
                </div>

                {importType === 'sales_forecast' && (
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="autoCreate">Auto-create Missing Items</Label>
                      <p className="text-xs text-gray-500">Create customers/products that don't exist</p>
                    </div>
                    <input
                      id="autoCreate"
                      type="checkbox"
                      checked={importOptions.autoCreate}
                      onChange={(e) => setImportOptions(prev => ({ ...prev, autoCreate: e.target.checked }))}
                      className="w-4 h-4"
                    />
                  </div>
                )}

                {(importType === 'customers' || importType === 'products') && (
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="merge_strategy">Duplicate Handling</Label>
                      <p className="text-xs text-gray-500">What to do if item already exists</p>
                    </div>
                    <Select
                      id="merge_strategy"
                      value={importOptions.merge_strategy}
                      onChange={(e) => setImportOptions(prev => ({ ...prev, merge_strategy: e.target.value }))}
                      className="w-40"
                    >
                      <SelectOption value="skip">Skip</SelectOption>
                      <SelectOption value="update">Update</SelectOption>
                      <SelectOption value="create_new">Create New</SelectOption>
                    </Select>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="skipInvalid">Skip Invalid Rows</Label>
                    <p className="text-xs text-gray-500">Continue importing even if some rows have errors</p>
                  </div>
                  <input
                    id="skipInvalid"
                    type="checkbox"
                    checked={importOptions.skipInvalid}
                    onChange={(e) => setImportOptions(prev => ({ ...prev, skipInvalid: e.target.checked }))}
                    className="w-4 h-4"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Missing Items Warning */}
          {missingItems.customers.length > 0 || missingItems.products.length > 0 ? (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <h3 className="text-sm font-semibold text-yellow-900 mb-2">Missing Items Detected</h3>
              {missingItems.customers.length > 0 && (
                <p className="text-sm text-yellow-800 mb-1">
                  {missingItems.customers.length} customer(s) not found: {missingItems.customers.map(c => c.id).join(', ')}
                </p>
              )}
              {missingItems.products.length > 0 && (
                <p className="text-sm text-yellow-800">
                  {missingItems.products.length} product(s) not found: {missingItems.products.map(p => p.id).join(', ')}
                </p>
              )}
              {importOptions.autoCreate && (
                <p className="text-xs text-yellow-700 mt-2">
                  These items will be created automatically with minimal data. Complete details on the validation page.
                </p>
              )}
            </div>
          ) : null}

          {/* Errors and Warnings */}
          {errors.length > 0 && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg max-h-40 overflow-y-auto">
              <h3 className="text-sm font-semibold text-red-900 mb-2">
                Errors ({errors.length})
              </h3>
              <ul className="text-xs text-red-800 space-y-1">
                {errors.slice(0, 5).map((error, idx) => (
                  <li key={idx}>Row {error.row}: {error.message}</li>
                ))}
                {errors.length > 5 && <li>... and {errors.length - 5} more</li>}
              </ul>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg max-h-40 overflow-y-auto">
              <h3 className="text-sm font-semibold text-yellow-900 mb-2">
                Warnings ({warnings.length})
              </h3>
              <ul className="text-xs text-yellow-800 space-y-1">
                {warnings.slice(0, 5).map((warning, idx) => (
                  <li key={idx}>Row {warning.row}: {warning.message}</li>
                ))}
                {warnings.length > 5 && <li>... and {warnings.length - 5} more</li>}
              </ul>
            </div>
          )}

          {/* Data Preview */}
          {previewData.length > 0 && (
            <div className="space-y-2">
              <Label>Preview (first 10 rows)</Label>
              <div className="border border-gray-200 rounded-lg overflow-x-auto max-h-64">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      {headers.map((header, idx) => (
                        <th key={idx} className="px-2 py-1 text-left font-medium text-gray-700">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {previewData.map((row, rowIdx) => (
                      <tr key={rowIdx} className="hover:bg-gray-50">
                        {headers.map((header, colIdx) => (
                          <td key={colIdx} className="px-2 py-1 text-gray-600">
                            {row[header] || '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </ModalContent>
        <ModalFooter>
          <Button variant="outline" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={!file || isProcessing || (errors.length > 0 && !importOptions.skipInvalid)}
            className="bg-orange-600 hover:bg-orange-700"
          >
            {isProcessing ? 'Processing...' : 'Import'}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
};

export default CSVUploadModal;

