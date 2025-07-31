import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';


const BOMSummary = ({ boms, bomItems, units }) => {
  const summaryData = useMemo(() => {
    // Ensure arrays are defined and not null
    const safeBoms = boms || [];
    const safeBomItems = bomItems || [];
    
    const totalBOMs = safeBoms.length;
    
    // Version breakdown
    const versionBreakdown = safeBoms.reduce((acc, bom) => {
      const version = bom.version || '1.0';
      acc[version] = (acc[version] || 0) + 1;
      return acc;
    }, {});
    
    // Cost analysis
    const totalMaterialCost = safeBomItems.reduce((sum, item) => sum + (item.material_cost || 0), 0);
    const totalTargetCost = safeBomItems.reduce((sum, item) => sum + (item.target_cost || 0), 0);
    const avgMaterialCost = totalBOMs > 0 ? totalMaterialCost / totalBOMs : 0;
    const avgTargetCost = totalBOMs > 0 ? totalTargetCost / totalBOMs : 0;
    const costVariance = totalMaterialCost - totalTargetCost;
    
    // Item analysis
    const totalItems = safeBomItems.length;
    const avgItemsPerBOM = totalBOMs > 0 ? totalItems / totalBOMs : 0;
    
    // Material type breakdown
    const materialTypes = safeBomItems.reduce((acc, item) => {
      const description = item.material_description || 'Unknown';
      const type = getItemType(description);
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    
    // Unit breakdown
    const unitBreakdown = safeBomItems.reduce((acc, item) => {
      const unit = item.unit || 'each';
      acc[unit] = (acc[unit] || 0) + 1;
      return acc;
    }, {});
    
    // Cost per BOM breakdown
    const bomCosts = safeBoms.map(bom => {
      const bomTotal = safeBomItems
        .filter(item => item.bom_id === bom.bom_id)
        .reduce((sum, item) => sum + (item.material_cost || 0), 0);
      return { bom_id: bom.bom_id, cost: bomTotal };
    }).sort((a, b) => b.cost - a.cost);
    
    // Data completeness
    const withTargetCost = safeBomItems.filter(item => item.target_cost && item.target_cost > 0).length;
    const withUnitPrice = safeBomItems.filter(item => item.unit_price && item.unit_price > 0).length;
    const withQuantity = safeBomItems.filter(item => item.qty && item.qty > 0).length;
    
    // Complete BOMs
    const completeBOMs = safeBoms.filter(bom => {
      const bomItemCount = safeBomItems.filter(item => item.bom_id === bom.bom_id).length;
      const completeItems = safeBomItems.filter(item => 
        item.bom_id === bom.bom_id && 
        item.material_description && 
        item.qty > 0 && 
        item.unit_price > 0
      ).length;
      return bomItemCount > 0 && completeItems === bomItemCount;
    }).length;
    
    return {
      totalBOMs,
      versionBreakdown,
      costStats: {
        totalMaterialCost,
        totalTargetCost,
        avgMaterialCost,
        avgTargetCost,
        costVariance
      },
      itemStats: {
        totalItems,
        avgItemsPerBOM
      },
      materialTypes,
      unitBreakdown,
      bomCosts: bomCosts.slice(0, 5), // Top 5 most expensive BOMs
      completeness: {
        withTargetCost,
        withUnitPrice,
        withQuantity
      },
      dataQuality: {
        completeBOMs,
        incompleteBOMs: totalBOMs - completeBOMs
      }
    };
  }, [boms, bomItems]);

  const topVersions = Object.entries(summaryData.versionBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topMaterialTypes = Object.entries(summaryData.materialTypes)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topUnits = Object.entries(summaryData.unitBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const formatCurrency = (value) => {
    return `$${Number(value).toFixed(2)}`;
  };

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl">📋</div>
              <div>
                <p className="text-2xl font-bold">{summaryData.totalBOMs}</p>
                <p className="text-sm text-muted-foreground">Total BOMs</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl">✅</div>
              <div>
                <p className="text-2xl font-bold">{summaryData.dataQuality.completeBOMs}</p>
                <p className="text-sm text-muted-foreground">Complete BOMs</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl">💰</div>
              <div>
                <p className="text-2xl font-bold">{formatCurrency(summaryData.costStats.totalMaterialCost)}</p>
                <p className="text-sm text-muted-foreground">Total Material Cost</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl">📦</div>
              <div>
                <p className="text-2xl font-bold">{summaryData.itemStats.totalItems}</p>
                <p className="text-sm text-muted-foreground">Total Items</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cost Analysis */}
      <Card>
        <CardHeader>
          <CardTitle>Cost Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Average Material Cost</p>
              <p className="text-lg font-semibold">{formatCurrency(summaryData.costStats.avgMaterialCost)}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Average Target Cost</p>
              <p className="text-lg font-semibold">{formatCurrency(summaryData.costStats.avgTargetCost)}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Cost Variance</p>
              <p className={`text-lg font-semibold ${summaryData.costStats.costVariance > 0 ? 'text-red-600' : 
                summaryData.costStats.costVariance < 0 ? 'text-green-600' : 'text-gray-600'}`}>
                {summaryData.costStats.costVariance > 0 ? '+' : ''}{formatCurrency(summaryData.costStats.costVariance)}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Average Items per BOM</p>
              <p className="text-lg font-semibold">{summaryData.itemStats.avgItemsPerBOM.toFixed(1)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Most Expensive BOMs */}
      <Card>
        <CardHeader>
          <CardTitle>Most Expensive BOMs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {summaryData.bomCosts.map(({bom_id, cost}) => (
              <div key={bom_id} className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Badge variant="outline" className="bg-red-100 text-red-800">
                    {bom_id}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{formatCurrency(cost)}</span>
                </div>
                <div className="flex-1 mx-4">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-red-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${summaryData.bomCosts.length > 0 ? (cost / summaryData.bomCosts[0].cost) * 100 : 0}%` }}
                    ></div>
                  </div>
                </div>
                <span className="text-sm font-medium">
                  {summaryData.bomCosts.length > 0 ? ((cost / summaryData.bomCosts[0].cost) * 100).toFixed(1) : 0}%
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Material Type Distribution */}
      <Card>
        <CardHeader>
          <CardTitle>Material Type Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {topMaterialTypes.map(([type, count]) => (
              <div key={type} className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Badge 
                    variant="outline" 
                    className="bg-blue-100 text-blue-800"
                    style={{ backgroundColor: `${getMaterialTypeColor(type)}20`, color: getMaterialTypeColor(type) }}
                  >
                    {type}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{count} items</span>
                </div>
                <div className="flex-1 mx-4">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="h-2 rounded-full transition-all duration-300"
                      style={{ 
                        width: `${(count / summaryData.itemStats.totalItems) * 100}%`,
                        backgroundColor: getMaterialTypeColor(type)
                      }}
                    ></div>
                  </div>
                </div>
                <span className="text-sm font-medium">
                  {((count / summaryData.itemStats.totalItems) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Unit Distribution */}
      <Card>
        <CardHeader>
          <CardTitle>Unit Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {topUnits.map(([unit, count]) => (
              <div key={unit} className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Badge variant="outline" className="bg-cyan-100 text-cyan-800">
                    {unit}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{count} items</span>
                </div>
                <div className="flex-1 mx-4">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-cyan-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(count / summaryData.itemStats.totalItems) * 100}%` }}
                    ></div>
                  </div>
                </div>
                <span className="text-sm font-medium">
                  {((count / summaryData.itemStats.totalItems) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Data Completeness */}
      <Card>
        <CardHeader>
          <CardTitle>Data Completeness</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Complete BOMs</span>
                <span className="font-medium">{summaryData.dataQuality.completeBOMs} of {summaryData.totalBOMs}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-green-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(summaryData.dataQuality.completeBOMs / summaryData.totalBOMs) * 100}%` }}
                ></div>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>With Target Cost</span>
                <span className="font-medium">{summaryData.completeness.withTargetCost} of {summaryData.itemStats.totalItems}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(summaryData.completeness.withTargetCost / summaryData.itemStats.totalItems) * 100}%` }}
                ></div>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>With Unit Price</span>
                <span className="font-medium">{summaryData.completeness.withUnitPrice} of {summaryData.itemStats.totalItems}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-yellow-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(summaryData.completeness.withUnitPrice / summaryData.itemStats.totalItems) * 100}%` }}
                ></div>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>With Quantity</span>
                <span className="font-medium">{summaryData.completeness.withQuantity} of {summaryData.itemStats.totalItems}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(summaryData.completeness.withQuantity / summaryData.itemStats.totalItems) * 100}%` }}
                ></div>
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
            {summaryData.dataQuality.incompleteBOMs > 0 && (
              <div className="flex items-start space-x-3 p-3 bg-yellow-50 rounded-lg">
                <span className="text-xl">⚠️</span>
                <span className="text-sm">
                  {summaryData.dataQuality.incompleteBOMs} BOMs have incomplete data. 
                  Consider adding missing quantities, unit prices, or target costs.
                </span>
              </div>
            )}
            
            {summaryData.costStats.costVariance > summaryData.costStats.totalTargetCost * 0.1 && (
              <div className="flex items-start space-x-3 p-3 bg-red-50 rounded-lg">
                <span className="text-xl">💰</span>
                <span className="text-sm">
                  Material costs are {((summaryData.costStats.costVariance / summaryData.costStats.totalTargetCost) * 100).toFixed(1)}% 
                  over target. Review high-cost items for potential savings.
                </span>
              </div>
            )}
            
            {summaryData.completeness.withTargetCost < summaryData.itemStats.totalItems * 0.8 && (
              <div className="flex items-start space-x-3 p-3 bg-blue-50 rounded-lg">
                <span className="text-xl">🎯</span>
                <span className="text-sm">
                  Only {Math.round((summaryData.completeness.withTargetCost / summaryData.itemStats.totalItems) * 100)}% of items have target costs. 
                  Target costs help track cost performance and identify savings opportunities.
                </span>
              </div>
            )}
            
            {summaryData.itemStats.avgItemsPerBOM < 3 && (
              <div className="flex items-start space-x-3 p-3 bg-purple-50 rounded-lg">
                <span className="text-xl">📦</span>
                <span className="text-sm">
                  BOMs have relatively few items (avg: {summaryData.itemStats.avgItemsPerBOM.toFixed(1)}). 
                  Ensure all necessary materials and components are included.
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// Helper functions
const getItemType = (description) => {
  const desc = description.toLowerCase();
  if (desc.includes('packaging') || desc.includes('box') || desc.includes('bag')) return 'Packaging';
  if (desc.includes('material') || desc.includes('raw')) return 'Raw Material';
  if (desc.includes('component') || desc.includes('part')) return 'Component';
  if (desc.includes('hardware') || desc.includes('screw') || desc.includes('bolt')) return 'Hardware';
  if (desc.includes('adhesive') || desc.includes('glue') || desc.includes('tape')) return 'Adhesive';
  if (desc.includes('finish') || desc.includes('paint') || desc.includes('coating')) return 'Finishing';
  return 'Other';
};

const getMaterialTypeColor = (type) => {
  const colors = {
    'Packaging': '#007bff',
    'Raw Material': '#28a745',
    'Component': '#ffc107',
    'Hardware': '#dc3545',
    'Adhesive': '#6f42c1',
    'Finishing': '#fd7e14',
    'Other': '#6c757d'
  };
  return colors[type] || '#6c757d';
};

export default BOMSummary;