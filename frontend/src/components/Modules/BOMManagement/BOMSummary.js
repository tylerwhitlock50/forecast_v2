import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { formatCurrency } from '../ReportingAnalysis/utils/formatters';
import { linesOf, versionOf } from './bomHelpers';


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
    
    // Cost analysis. Target costs are optional: the variance compares only
    // the lines that have one, and is not shown when none do.
    const totalMaterialCost = safeBomItems.reduce((sum, item) => sum + (item.material_cost || 0), 0);
    const targeted = safeBomItems.filter(item => Number(item.target_cost) > 0);
    const totalTargetCost = targeted.reduce((sum, item) => sum + Number(item.target_cost), 0);
    const targetedMaterialCost = targeted.reduce((sum, item) => sum + (item.material_cost || 0), 0);
    const avgMaterialCost = totalBOMs > 0 ? totalMaterialCost / totalBOMs : 0;
    const bomsWithTarget = new Set(targeted.map(item => `${item.bom_id}|${versionOf(item.version)}`)).size;
    const avgTargetCost = bomsWithTarget > 0 ? totalTargetCost / bomsWithTarget : null;
    const costVariance = targeted.length > 0 ? targetedMaterialCost - totalTargetCost : null;
    const variancePct = targeted.length > 0 && totalTargetCost > 0 ? (costVariance / totalTargetCost) * 100 : null;
    
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
    
    // Material cost per unit of each BOM version
    const bomCosts = safeBoms.map(bom => {
      const bomTotal = linesOf(safeBomItems, bom.bom_id, bom.version)
        .reduce((sum, item) => sum + (item.material_cost || 0), 0);
      return { key: `${bom.bom_id}|${versionOf(bom.version)}`, bom_id: bom.bom_id, version: versionOf(bom.version), cost: bomTotal };
    }).sort((a, b) => b.cost - a.cost);
    const multipleVersions = new Set(safeBoms.map(bom => bom.bom_id)).size < safeBoms.length;
    
    // Data completeness
    const withTargetCost = safeBomItems.filter(item => item.target_cost && item.target_cost > 0).length;
    const withUnitPrice = safeBomItems.filter(item => item.unit_price && item.unit_price > 0).length;
    const withQuantity = safeBomItems.filter(item => item.qty && item.qty > 0).length;
    
    // Complete BOMs: every line has a description, a quantity and a cost
    const completeBOMs = safeBoms.filter(bom => {
      const lines = linesOf(safeBomItems, bom.bom_id, bom.version);
      const completeItems = lines.filter(item =>
        item.material_description &&
        item.qty > 0 &&
        item.unit_price > 0
      ).length;
      return lines.length > 0 && completeItems === lines.length;
    }).length;
    
    return {
      totalBOMs,
      versionBreakdown,
      costStats: {
        totalMaterialCost,
        totalTargetCost,
        avgMaterialCost,
        avgTargetCost,
        costVariance,
        variancePct
      },
      multipleVersions,
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


  const topMaterialTypes = Object.entries(summaryData.materialTypes)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topUnits = Object.entries(summaryData.unitBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const money = (value) => formatCurrency(Number(value) || 0);
  const { costStats } = summaryData;
  const hasTarget = costStats.costVariance !== null;

  const recommendations = [];
  if (summaryData.dataQuality.incompleteBOMs > 0) {
    recommendations.push({
      key: 'incomplete', icon: '⚠️', tone: 'bg-yellow-50',
      text: `${summaryData.dataQuality.incompleteBOMs} ${summaryData.dataQuality.incompleteBOMs === 1 ? 'BOM has' : 'BOMs have'} lines without a quantity or unit cost, so material cost is understated. See Data Validation.`,
    });
  }
  if (costStats.variancePct !== null && costStats.variancePct > 10) {
    recommendations.push({
      key: 'target', icon: '💰', tone: 'bg-red-50',
      text: `Material costs are ${costStats.variancePct.toFixed(1)}% over target on the lines that have a target cost. Review high-cost items for potential savings.`,
    });
  }
  if (summaryData.totalBOMs > 0 && summaryData.itemStats.avgItemsPerBOM < 3) {
    recommendations.push({
      key: 'few', icon: '📦', tone: 'bg-purple-50',
      text: `BOMs have relatively few lines (average ${summaryData.itemStats.avgItemsPerBOM.toFixed(1)}). Check that all materials and components are included.`,
    });
  }

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
                <p className="text-2xl font-bold">{money(summaryData.costStats.totalMaterialCost)}</p>
                <p className="text-sm text-muted-foreground" title="One unit of every BOM version added together">Material cost, all BOMs</p>
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
              <p className="text-sm text-muted-foreground">Average material cost per BOM</p>
              <p className="text-lg font-semibold">{money(costStats.avgMaterialCost)}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Average target cost</p>
              {hasTarget
                ? <p className="text-lg font-semibold">{money(costStats.avgTargetCost)}</p>
                : <p className="text-sm text-gray-500" title="Target costs are optional. Set one on a BOM line to compare against it.">No target set</p>}
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Cost vs target</p>
              {hasTarget ? (
                <p className={`text-lg font-semibold ${costStats.costVariance > 0 ? 'text-red-600' : costStats.costVariance < 0 ? 'text-green-600' : 'text-gray-600'}`}>
                  {costStats.costVariance > 0 ? '+' : ''}{money(costStats.costVariance)}
                </p>
              ) : <p className="text-sm text-gray-500">No target set</p>}
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Average lines per BOM</p>
              <p className="text-lg font-semibold">{summaryData.itemStats.avgItemsPerBOM.toFixed(1)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Most Expensive BOMs */}
      <Card>
        <CardHeader>
          <CardTitle>Most Expensive BOMs <span className="text-sm font-normal text-gray-500">(material cost per unit)</span></CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {summaryData.bomCosts.map(({ key, bom_id, version, cost }) => (
              <div key={key} className="flex items-center justify-between">
                <div className="flex w-56 flex-shrink-0 items-center space-x-2">
                  <Badge variant="outline" className="bg-red-100 text-red-800">
                    {bom_id}{summaryData.multipleVersions ? ` v${version}` : ''}
                  </Badge>
                  <span className="text-sm tabular-nums text-muted-foreground">{money(cost)}</span>
                </div>
                <div className="flex-1 mx-4">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-red-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${summaryData.bomCosts[0].cost > 0 ? (cost / summaryData.bomCosts[0].cost) * 100 : 0}%` }}
                    ></div>
                  </div>
                </div>
                <span className="w-14 text-right text-sm font-medium tabular-nums">
                  {summaryData.bomCosts[0].cost > 0 ? ((cost / summaryData.bomCosts[0].cost) * 100).toFixed(1) : 0}%
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
            
            {summaryData.completeness.withTargetCost > 0 && (
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
            )}

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

      {/* Recommendations (only when there is something to do) */}
      {recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recommendations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recommendations.map((r) => (
                <div key={r.key} className={`flex items-start space-x-3 p-3 rounded-lg ${r.tone}`}>
                  <span className="text-xl">{r.icon}</span>
                  <span className="text-sm">{r.text}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
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