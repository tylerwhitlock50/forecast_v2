import React, { useState, useCallback } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Label } from '../../ui/label';
import { Select, SelectOption } from '../../ui/select';
import FileUpload from '../../Common/FileUpload';
import CSVTemplateDownload from './CSVTemplateDownload';
import { toast } from 'react-hot-toast';
import Papa from 'papaparse';
import { mapColumns, validateData, applyColumnMapping } from './csvImportHelpers';

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
      const validation = validateData(data, mapping, importType, existingData);
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

      const transformedData = applyColumnMapping(data, columnMapping);

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

