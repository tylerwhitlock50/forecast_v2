import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';

const BOMValidation = ({ boms, bomItems, units }) => {
  // Ensure arrays are defined and not null
  const safeBoms = boms || [];
  const safeBomItems = bomItems || [];
  
  const validationResults = useMemo(() => {
    const issues = [];
    const warnings = [];
    
    // 1. BOMs without items
    const bomsWithoutItems = safeBoms.filter(bom => {
      const itemCount = safeBomItems.filter(item => item.bom_id === bom.bom_id).length;
      return itemCount === 0;
    });
    
    if (bomsWithoutItems.length > 0) {
      issues.push({
        type: 'error',
        category: 'Missing Data',
        title: 'BOMs Without Items',
        description: `${bomsWithoutItems.length} BOMs have no items defined`,
        items: bomsWithoutItems.map(bom => bom.bom_id),
        severity: 'high'
      });
    }
    
    // 2. Items without material descriptions
    const itemsWithoutDescription = safeBomItems.filter(item => 
      !item.material_description || (typeof item.material_description === 'string' && item.material_description.trim() === '') || item.material_description === null || item.material_description === undefined
    );
    
    if (itemsWithoutDescription.length > 0) {
      issues.push({
        type: 'error',
        category: 'Missing Data',
        title: 'Items Without Description',
        description: `${itemsWithoutDescription.length} BOM items missing material descriptions`,
        items: itemsWithoutDescription.map(item => `${item.bom_id} Line ${item.bom_line}`),
        severity: 'high'
      });
    }
    
    // 3. Items with zero or negative quantities
    const itemsWithBadQuantity = safeBomItems.filter(item => 
      !item.qty || item.qty <= 0
    );
    
    if (itemsWithBadQuantity.length > 0) {
      warnings.push({
        type: 'warning',
        category: 'Data Quality',
        title: 'Items With Invalid Quantities',
        description: `${itemsWithBadQuantity.length} items have zero or negative quantities`,
        items: itemsWithBadQuantity.map(item => `${item.bom_id} Line ${item.bom_line}: ${item.material_description}`),
        severity: 'medium'
      });
    }
    
    // 4. Items without unit prices
    const itemsWithoutPrice = safeBomItems.filter(item => 
      !item.unit_price || item.unit_price <= 0
    );
    
    if (itemsWithoutPrice.length > 0) {
      warnings.push({
        type: 'warning',
        category: 'Costing',
        title: 'Items Without Unit Prices',
        description: `${itemsWithoutPrice.length} items missing unit prices`,
        items: itemsWithoutPrice.map(item => `${item.bom_id} Line ${item.bom_line}: ${item.material_description}`),
        severity: 'medium'
      });
    }
    
    // 5. Items without target costs
    const itemsWithoutTarget = safeBomItems.filter(item => 
      !item.target_cost || item.target_cost <= 0
    );
    
    if (itemsWithoutTarget.length > 0) {
      warnings.push({
        type: 'warning',
        category: 'Costing',
        title: 'Items Without Target Costs',
        description: `${itemsWithoutTarget.length} items missing target costs`,
        items: itemsWithoutTarget.map(item => `${item.bom_id} Line ${item.bom_line}: ${item.material_description}`),
        severity: 'low'
      });
    }
    
    // 6. Cost variance validation
    const itemsWithHighVariance = safeBomItems.filter(item => {
      if (!item.material_cost || !item.target_cost) return false;
      const variance = Math.abs(item.material_cost - item.target_cost);
      const variancePercent = (variance / item.target_cost) * 100;
      return variancePercent > 20; // More than 20% variance
    });
    
    if (itemsWithHighVariance.length > 0) {
      warnings.push({
        type: 'warning',
        category: 'Costing',
        title: 'High Cost Variance',
        description: `${itemsWithHighVariance.length} items have >20% cost variance from target`,
        items: itemsWithHighVariance.map(item => {
          const variance = ((item.material_cost - item.target_cost) / item.target_cost * 100).toFixed(1);
          return `${item.bom_id} Line ${item.bom_line}: ${variance}% variance`;
        }),
        severity: 'medium'
      });
    }
    
    // 7. Duplicate line numbers within BOMs
    const duplicateLines = [];
    const bomGroups = safeBomItems.reduce((acc, item) => {
      const key = `${item.bom_id}-${item.version}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
    
    Object.entries(bomGroups).forEach(([bomKey, items]) => {
      const lineNumbers = items.map(item => item.bom_line);
      const duplicates = lineNumbers.filter((line, index) => lineNumbers.indexOf(line) !== index);
      if (duplicates.length > 0) {
        duplicateLines.push(bomKey);
      }
    });
    
    if (duplicateLines.length > 0) {
      issues.push({
        type: 'error',
        category: 'Data Integrity',
        title: 'Duplicate Line Numbers',
        description: `${duplicateLines.length} BOMs have duplicate line numbers`,
        items: duplicateLines,
        severity: 'high'
      });
    }
    
    // 8. Inconsistent unit usage
    const unitUsage = safeBomItems.reduce((acc, item) => {
      const desc = item.material_description?.toLowerCase() || '';
      if (!acc[desc]) acc[desc] = new Set();
      acc[desc].add(item.unit);
      return acc;
    }, {});
    
    const inconsistentUnits = Object.entries(unitUsage)
      .filter(([desc, units]) => units.size > 1)
      .map(([desc, units]) => `${desc}: ${Array.from(units).join(', ')}`);
    
    if (inconsistentUnits.length > 0) {
      warnings.push({
        type: 'warning',
        category: 'Data Quality',
        title: 'Inconsistent Units',
        description: `${inconsistentUnits.length} materials use different units`,
        items: inconsistentUnits.slice(0, 10), // Limit to 10 items
        severity: 'low'
      });
    }
    
    // 9. BOMs with very few items (potential incomplete BOMs)
    const sparseBOMs = safeBoms.filter(bom => {
      const itemCount = safeBomItems.filter(item => item.bom_id === bom.bom_id).length;
      return itemCount > 0 && itemCount < 3;
    });
    
    if (sparseBOMs.length > 0) {
      warnings.push({
        type: 'warning',
        category: 'Completeness',
        title: 'BOMs With Few Items',
        description: `${sparseBOMs.length} BOMs have less than 3 items (possibly incomplete)`,
        items: sparseBOMs.map(bom => `${bom.bom_id} (${safeBomItems.filter(item => item.bom_id === bom.bom_id).length} items)`),
        severity: 'low'
      });
    }
    
    // 10. Cost calculation mismatches
    const costMismatches = safeBomItems.filter(item => {
      if (!item.qty || !item.unit_price || !item.material_cost) return false;
      const expectedCost = item.qty * item.unit_price;
      const actualCost = item.material_cost;
      const difference = Math.abs(expectedCost - actualCost);
      return difference > 0.01; // More than 1 cent difference
    });
    
    if (costMismatches.length > 0) {
      warnings.push({
        type: 'warning',
        category: 'Calculations',
        title: 'Cost Calculation Mismatches',
        description: `${costMismatches.length} items have material cost ≠ quantity × unit price`,
        items: costMismatches.map(item => {
          const expected = (item.qty * item.unit_price).toFixed(2);
          const actual = item.material_cost.toFixed(2);
          return `${item.bom_id} Line ${item.bom_line}: Expected $${expected}, Actual $${actual}`;
        }),
        severity: 'medium'
      });
    }
    
    return { issues, warnings };
  }, [safeBoms, safeBomItems]);

  const allValidations = [...validationResults.issues, ...validationResults.warnings];
  const errorCount = validationResults.issues.length;
  const warningCount = validationResults.warnings.length;

  const getValidationIcon = (type) => {
    switch (type) {
      case 'error': return '❌';
      case 'warning': return '⚠️';
      default: return 'ℹ️';
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high': return '#dc3545';
      case 'medium': return '#ffc107';
      case 'low': return '#17a2b8';
      default: return '#6c757d';
    }
  };

  const getHealthScore = () => {
    const totalItems = safeBomItems.length;
    const totalBOMs = safeBoms.length;
    
    if (totalItems === 0) return 0;
    
    // Calculate health based on various factors
    let score = 100;
    
    // Deduct for errors (major impact)
    score -= errorCount * 10;
    
    // Deduct for warnings (minor impact)
    score -= warningCount * 2;
    
    // Bonus for completeness
    const completeItems = bomItems.filter(item => 
      item.material_description && 
      item.qty > 0 && 
      item.unit_price > 0 && 
      item.material_cost > 0
    ).length;
    
    const completenessBonus = (completeItems / totalItems) * 20;
    score += completenessBonus;
    
    return Math.max(0, Math.min(100, score));
  };

  const healthScore = getHealthScore();

  return (
    <div className="space-y-6">
      {/* Validation Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl">📋</div>
              <div>
                <p className="text-2xl font-bold">{safeBoms.length}</p>
                <p className="text-sm text-muted-foreground">Total BOMs</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl text-green-600">✅</div>
              <div>
                <p className="text-2xl font-bold">{safeBoms.length + safeBomItems.length - errorCount - warningCount}</p>
                <p className="text-sm text-muted-foreground">Valid</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl text-yellow-600">⚠️</div>
              <div>
                <p className="text-2xl font-bold">{warningCount}</p>
                <p className="text-sm text-muted-foreground">Warnings</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl text-red-600">❌</div>
              <div>
                <p className="text-2xl font-bold">{errorCount}</p>
                <p className="text-sm text-muted-foreground">Errors</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Critical Issues */}
      {validationResults.issues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <span>❌</span>
              <span>Critical Issues ({validationResults.issues.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {validationResults.issues.map((validation, index) => (
                <div key={index} className="p-4 border border-red-200 rounded-lg bg-red-50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <Badge variant="destructive" className="bg-red-100 text-red-800">
                        {getValidationIcon(validation.type)}
                      </Badge>
                      <span className="font-semibold">{validation.title}</span>
                      <Badge variant="outline" className="text-xs">{validation.category}</Badge>
                    </div>
                    <Badge 
                      variant="outline" 
                      className="text-xs"
                      style={{ backgroundColor: getSeverityColor(validation.severity), color: 'white' }}
                    >
                      {validation.severity}
                    </Badge>
                  </div>
                  <p className="text-sm mb-3">{validation.description}</p>
                  {validation.items && validation.items.length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer font-medium text-red-700">Show affected items ({validation.items.length})</summary>
                      <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                        {validation.items.slice(0, 20).map((item, idx) => (
                          <div key={idx} className="text-red-600">• {item}</div>
                        ))}
                        {validation.items.length > 20 && (
                          <div className="text-red-500 italic">... and {validation.items.length - 20} more</div>
                        )}
                      </div>
                    </details>
                  )}
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
            <CardTitle className="flex items-center space-x-2">
              <span>⚠️</span>
              <span>Warnings ({validationResults.warnings.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {validationResults.warnings.map((validation, index) => (
                <div key={index} className="p-4 border border-yellow-200 rounded-lg bg-yellow-50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <Badge variant="outline" className="bg-yellow-100 text-yellow-800">
                        {getValidationIcon(validation.type)}
                      </Badge>
                      <span className="font-semibold">{validation.title}</span>
                      <Badge variant="outline" className="text-xs">{validation.category}</Badge>
                    </div>
                    <Badge 
                      variant="outline" 
                      className="text-xs"
                      style={{ backgroundColor: getSeverityColor(validation.severity), color: 'white' }}
                    >
                      {validation.severity}
                    </Badge>
                  </div>
                  <p className="text-sm mb-3">{validation.description}</p>
                  {validation.items && validation.items.length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer font-medium text-yellow-700">Show affected items ({validation.items.length})</summary>
                      <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                        {validation.items.slice(0, 20).map((item, idx) => (
                          <div key={idx} className="text-yellow-600">• {item}</div>
                        ))}
                        {validation.items.length > 20 && (
                          <div className="text-yellow-500 italic">... and {validation.items.length - 20} more</div>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Clear Message */}
      {allValidations.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="space-y-4">
              <div className="text-6xl">🎉</div>
              <h3 className="text-2xl font-bold text-green-600">All Clear!</h3>
              <p className="text-muted-foreground">No validation issues found in your BOM data. Everything looks great!</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Quality Score */}
      <Card>
        <CardHeader>
          <CardTitle>Data Quality Score</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-8">
            <div className="flex-shrink-0">
              <div className="w-24 h-24 rounded-full bg-gradient-to-r from-green-400 to-blue-500 flex items-center justify-center">
                <div className="text-center text-white">
                  <div className="text-2xl font-bold">
                    {Math.round(healthScore)}%
                  </div>
                  <div className="text-xs">Health</div>
                </div>
              </div>
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex justify-between">
                <span className="text-sm">Complete Items:</span>
                <span className="font-medium">
                  {safeBomItems.filter(item => 
                    item.material_description && 
                    item.qty > 0 && 
                    item.unit_price > 0
                  ).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Items with Issues:</span>
                <span className="font-medium text-red-600">{errorCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Items with Warnings:</span>
                <span className="font-medium text-yellow-600">{warningCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Unique Materials:</span>
                <span className="font-medium">{new Set(safeBomItems.map(item => item.material_description?.toLowerCase())).size}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle>Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {errorCount > 0 && (
              <div className="flex items-start space-x-3 p-3 bg-red-50 rounded-lg">
                <span className="text-xl">🚨</span>
                <span className="text-sm">
                  <strong>Address Critical Issues:</strong> Fix {errorCount} error{errorCount !== 1 ? 's' : ''} first as they may prevent proper BOM functionality.
                </span>
              </div>
            )}
            
            {warningCount > 5 && (
              <div className="flex items-start space-x-3 p-3 bg-yellow-50 rounded-lg">
                <span className="text-xl">📋</span>
                <span className="text-sm">
                  <strong>Data Quality Review:</strong> Consider reviewing data entry processes to reduce the {warningCount} warnings.
                </span>
              </div>
            )}
            
            {safeBomItems.filter(item => !item.target_cost || item.target_cost <= 0).length > safeBomItems.length * 0.5 && (
              <div className="flex items-start space-x-3 p-3 bg-blue-50 rounded-lg">
                <span className="text-xl">🎯</span>
                <span className="text-sm">
                  <strong>Add Target Costs:</strong> Setting target costs helps track cost performance and identify savings opportunities.
                </span>
              </div>
            )}
            
            {healthScore < 70 && (
              <div className="flex items-start space-x-3 p-3 bg-orange-50 rounded-lg">
                <span className="text-xl">💡</span>
                <span className="text-sm">
                  <strong>Improve Data Quality:</strong> Focus on completing missing information and resolving inconsistencies to improve the health score.
                </span>
              </div>
            )}
            
            {allValidations.length === 0 && (
              <div className="flex items-start space-x-3 p-3 bg-green-50 rounded-lg">
                <span className="text-xl">🌟</span>
                <span className="text-sm">
                  <strong>Excellent Data Quality!</strong> Consider setting up automated validation checks to maintain this high standard as your BOM data grows.
                </span>
              </div>
            )}
            
            {safeBoms.length === 0 && (
              <div className="flex items-start space-x-3 p-3 bg-purple-50 rounded-lg">
                <span className="text-xl">📋</span>
                <span className="text-sm">
                  <strong>No BOMs Found:</strong> Start by creating your first Bill of Materials to begin cost tracking and material planning.
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BOMValidation;