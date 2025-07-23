import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';

const ProductValidation = ({ products }) => {
  const validationResults = useMemo(() => {
    const issues = [];
    const warnings = [];
    const stats = {
      total: products.length,
      valid: 0,
      withIssues: 0,
      withWarnings: 0
    };

    products.forEach((product, index) => {
      const productIssues = [];
      const productWarnings = [];

      // Required field validation
      if (!product.unit_name || (typeof product.unit_name === 'string' && product.unit_name.trim() === '') || product.unit_name === null || product.unit_name === undefined) {
        productIssues.push('Missing product name');
      }

      if (!product.unit_id || (typeof product.unit_id === 'string' && product.unit_id.trim() === '') || product.unit_id === null || product.unit_id === undefined) {
        productIssues.push('Missing product ID');
      }

      // Price validation
      if (product.base_price) {
        const price = parseFloat(product.base_price);
        if (isNaN(price)) {
          productIssues.push('Invalid price format');
        } else if (price < 0) {
          productIssues.push('Price cannot be negative');
        } else if (price === 0) {
          productWarnings.push('Product has zero price');
        }
      } else {
        productWarnings.push('No base price provided');
      }

      // BOM validation
      if (!product.bom || (typeof product.bom === 'string' && product.bom.trim() === '') || product.bom === null || product.bom === undefined) {
        productWarnings.push('No BOM assigned');
      }

      // Router validation
      if (!product.router || (typeof product.router === 'string' && product.router.trim() === '') || product.router === null || product.router === undefined) {
        productWarnings.push('No router assigned');
      }

      // Duplicate check
      const duplicateName = products.find((p, i) => 
        i !== index && 
        p.unit_name && 
        p.unit_name.toLowerCase() === product.unit_name?.toLowerCase()
      );
      if (duplicateName) {
        productWarnings.push('Duplicate product name detected');
      }

      const duplicateId = products.find((p, i) => 
        i !== index && 
        p.unit_id && 
        p.unit_id.toLowerCase() === product.unit_id?.toLowerCase()
      );
      if (duplicateId) {
        productIssues.push('Duplicate product ID detected');
      }

      // Data completeness check
      const hasCompleteProfile = product.unit_name && product.base_price && product.bom && product.router;
      if (!hasCompleteProfile) {
        productWarnings.push('Incomplete product profile');
      }

      // Description check
      if (!product.unit_description || (typeof product.unit_description === 'string' && product.unit_description.trim() === '') || product.unit_description === null || product.unit_description === undefined) {
        productWarnings.push('No product description provided');
      }

      // Add to overall stats
      if (productIssues.length > 0) {
        issues.push({
          product,
          issues: productIssues
        });
        stats.withIssues++;
      } else if (productWarnings.length > 0) {
        warnings.push({
          product,
          warnings: productWarnings
        });
        stats.withWarnings++;
      } else {
        stats.valid++;
      }
    });

    return { issues, warnings, stats };
  }, [products]);

  const getSeverityClass = (type) => {
    return type === 'error' ? 'validation-error' : 'validation-warning';
  };

  const getSeverityIcon = (type) => {
    return type === 'error' ? '❌' : '⚠️';
  };

  const summaryCards = [
    {
      icon: "✅",
      value: validationResults.stats.valid,
      label: "Valid Records",
      color: "text-green-600"
    },
    {
      icon: "⚠️",
      value: validationResults.stats.withWarnings,
      label: "With Warnings",
      color: "text-yellow-600"
    },
    {
      icon: "❌",
      value: validationResults.stats.withIssues,
      label: "With Issues",
      color: "text-red-600"
    },
    {
      icon: "📊",
      value: validationResults.stats.total,
      label: "Total Records",
      color: "text-blue-600"
    }
  ];

  return (
    <div className="space-y-6">
      {/* Validation Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((card, index) => (
          <Card key={index} className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <span>{card.icon}</span>
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${card.color}`}>
                {card.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Critical Issues */}
      {validationResults.issues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-red-600 flex items-center gap-2">
              <span>❌</span>
              Critical Issues ({validationResults.issues.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {validationResults.issues.map((item, index) => (
                <div key={index} className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-red-600">❌</span>
                    <span className="font-semibold">{item.product.unit_name || 'Unnamed Product'}</span>
                    <Badge variant="outline" className="text-xs">{item.product.unit_id}</Badge>
                  </div>
                  <div className="ml-6 space-y-1">
                    {item.issues.map((issue, issueIndex) => (
                      <div key={issueIndex} className="flex items-start gap-2 text-sm text-red-800">
                        <span className="text-red-400 mt-1">•</span>
                        <span>{issue}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Warnings */}
      {validationResults.warnings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-yellow-600 flex items-center gap-2">
              <span>⚠️</span>
              Warnings ({validationResults.warnings.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {validationResults.warnings.map((item, index) => (
                <div key={index} className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-yellow-600">⚠️</span>
                    <span className="font-semibold">{item.product.unit_name || 'Unnamed Product'}</span>
                    <Badge variant="outline" className="text-xs">{item.product.unit_id}</Badge>
                  </div>
                  <div className="ml-6 space-y-1">
                    {item.warnings.map((warning, warningIndex) => (
                      <div key={warningIndex} className="flex items-start gap-2 text-sm text-yellow-800">
                        <span className="text-yellow-400 mt-1">•</span>
                        <span>{warning}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Clear Message */}
      {validationResults.issues.length === 0 && validationResults.warnings.length === 0 && (
        <Card>
          <CardContent className="text-center py-12">
            <div className="text-6xl mb-4">🎉</div>
            <h4 className="text-2xl font-bold text-green-600 mb-2">All Clear!</h4>
            <p className="text-gray-600">Your product database looks great! All records are valid and complete.</p>
          </CardContent>
        </Card>
      )}

      {/* Data Quality Score */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Data Quality Score</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center justify-center w-32 h-32 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white">
              <div className="text-center">
                <div className="text-2xl font-bold">
                  {Math.round((validationResults.stats.valid / validationResults.stats.total) * 100)}%
                </div>
                <div className="text-xs">Quality Score</div>
              </div>
            </div>
            <div className="flex-1 ml-8 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">Valid Records:</span>
                <span className="font-semibold">{validationResults.stats.valid}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">Records with Issues:</span>
                <span className="font-semibold text-red-600">{validationResults.stats.withIssues}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">Records with Warnings:</span>
                <span className="font-semibold text-yellow-600">{validationResults.stats.withWarnings}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {validationResults.issues.length > 0 && (
              <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <span className="text-xl">🔧</span>
                <span className="text-sm text-red-800">
                  Fix {validationResults.issues.length} critical issues to improve data quality.
                </span>
              </div>
            )}
            
            {validationResults.warnings.length > 0 && (
              <div className="flex items-start gap-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <span className="text-xl">📝</span>
                <span className="text-sm text-yellow-800">
                  Address {validationResults.warnings.length} warnings to enhance data completeness.
                </span>
              </div>
            )}
            
            {validationResults.stats.valid < validationResults.stats.total * 0.8 && (
              <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <span className="text-xl">📊</span>
                <span className="text-sm text-blue-800">
                  Consider implementing data validation rules to prevent future issues.
                </span>
              </div>
            )}
            
            {validationResults.stats.valid === validationResults.stats.total && (
              <div className="flex items-start gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <span className="text-xl">🌟</span>
                <span className="text-sm text-green-800">
                  Excellent data quality! Consider setting up automated validation checks.
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ProductValidation; 