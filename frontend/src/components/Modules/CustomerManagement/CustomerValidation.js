import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';

const CustomerValidation = ({ customers }) => {
  const validationResults = useMemo(() => {
    const issues = [];
    const warnings = [];
    const stats = {
      total: customers.length,
      valid: 0,
      withIssues: 0,
      withWarnings: 0
    };

    customers.forEach((customer, index) => {
      const customerIssues = [];
      const customerWarnings = [];

      // Required field validation
      if (!customer.customer_name || (typeof customer.customer_name === 'string' && customer.customer_name.trim() === '') || customer.customer_name === null || customer.customer_name === undefined) {
        customerIssues.push('Missing customer name');
      }

      if (!customer.customer_id || (typeof customer.customer_id === 'string' && customer.customer_id.trim() === '') || customer.customer_id === null || customer.customer_id === undefined) {
        customerIssues.push('Missing customer ID');
      }

      // Email validation
      if (customer.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customer.email)) {
          customerIssues.push('Invalid email format');
        }
      } else {
        customerWarnings.push('No email address provided');
      }

      // Phone validation
      if (customer.phone) {
        const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
        const cleanPhone = customer.phone.replace(/[\s\-\(\)]/g, '');
        if (!phoneRegex.test(cleanPhone)) {
          customerWarnings.push('Phone number format may be invalid');
        }
      } else {
        customerWarnings.push('No phone number provided');
      }

      // Duplicate check
      const duplicateName = customers.find((c, i) => 
        i !== index && 
        c.customer_name && 
        c.customer_name.toLowerCase() === customer.customer_name?.toLowerCase()
      );
      if (duplicateName) {
        customerWarnings.push('Duplicate customer name detected');
      }

      // Data completeness check
      const hasCompleteProfile = customer.customer_name && customer.email && customer.phone && customer.address;
      if (!hasCompleteProfile) {
        customerWarnings.push('Incomplete profile information');
      }

      // Add to overall stats
      if (customerIssues.length > 0) {
        issues.push({
          customer,
          issues: customerIssues
        });
        stats.withIssues++;
      } else if (customerWarnings.length > 0) {
        warnings.push({
          customer,
          warnings: customerWarnings
        });
        stats.withWarnings++;
      } else {
        stats.valid++;
      }
    });

    return { issues, warnings, stats };
  }, [customers]);

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
                    <span className="font-semibold">{item.customer.customer_name || 'Unnamed Customer'}</span>
                    <Badge variant="outline" className="text-xs">{item.customer.customer_id}</Badge>
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
                    <span className="font-semibold">{item.customer.customer_name || 'Unnamed Customer'}</span>
                    <Badge variant="outline" className="text-xs">{item.customer.customer_id}</Badge>
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
            <p className="text-gray-600">Your customer database looks great! All records are valid and complete.</p>
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

export default CustomerValidation; 