import React, { useState, useMemo, useEffect } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import api from '../../../lib/apiClient';
import { PageHeader } from '../../ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { StatsCard } from '../../ui/stats-card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Select, SelectOption } from '../../ui/select';
import {
  calculateMaterialsUsage,
  calculateMachineUtilization,
  calculateLaborUtilization,
  getBOMDetails,
  getRoutingDetails
} from './CostCalculations';
import CostWarningsBanner from '../../Common/CostWarningsBanner';
import MaterialsUsageTab from './MaterialsUsageTab';
import MachineUtilizationTab from './MachineUtilizationTab';
import LaborUtilizationTab from './LaborUtilizationTab';

const CostManagement = () => {
  const { data, loading, activeScenario } = useForecast();
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState('all');
  const [recalculateTrigger, setRecalculateTrigger] = useState(0);

  // Get unique periods from forecast data
  const availablePeriods = useMemo(() => {
    const periods = [...new Set((data.sales_forecast || []).map(f => f.period))].sort();
    console.log('Available periods from sales forecast:', periods);
    return periods;
  }, [data.sales_forecast]);

  // Cost summary comes from the backend (/products/cost-summary) so it
  // stays in lockstep with the Reporting Dashboard and avoids the
  // duplicate-math drift we used to have.
  const [costSummary, setCostSummary] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const fetchCostSummary = async () => {
      try {
        const params = activeScenario ? { forecast_id: activeScenario } : {};
        const res = await api.get('/products/cost-summary', {
          params,
          suppressErrorToast: true,
        });
        if (cancelled) return;
        const products = (res?.data?.products || []).filter(
          (p) => (p.forecast_quantity || 0) > 0
        );
        setCostSummary(products);
      } catch (error) {
        console.error('Error fetching cost summary:', error);
        toast.error('Error fetching cost summary');
        if (!cancelled) setCostSummary([]);
      }
    };
    fetchCostSummary();
    return () => { cancelled = true; };
  }, [activeScenario, recalculateTrigger, data?.sales_forecast, data?.bom, data?.router_operations]);

  // Calculate materials usage
  const materialsUsage = useMemo(() => {
    if (!data || !data.sales_forecast) return {};
    
    try {
      return calculateMaterialsUsage(data);
    } catch (error) {
      console.error('Error calculating materials usage:', error);
      toast.error('Error calculating materials usage');
      return {};
    }
  }, [data]);

  // Calculate machine utilization
  const machineUtilization = useMemo(() => {
    if (!data || !data.sales_forecast) return {};
    
    try {
      return calculateMachineUtilization(data);
    } catch (error) {
      console.error('Error calculating machine utilization:', error);
      toast.error('Error calculating machine utilization');
      return [];
    }
  }, [data]);

  // Calculate labor utilization
  const laborUtilization = useMemo(() => {
    if (!data || !data.sales_forecast) return {};
    
    try {
      return calculateLaborUtilization(data);
    } catch (error) {
      console.error('Error calculating labor utilization:', error);
      toast.error('Error calculating labor utilization');
      return {};
    }
  }, [data]);

  // Get BOM details for selected product
  const bomDetails = useMemo(() => {
    if (!selectedProduct || !selectedProduct.bom_id || !data) return [];
    return getBOMDetails(data, selectedProduct.bom_id);
  }, [selectedProduct, data]);

  // Get routing details for selected product
  const routingDetails = useMemo(() => {
    if (!selectedProduct || !selectedProduct.router_id || !data) return [];
    return getRoutingDetails(data, selectedProduct.router_id);
  }, [selectedProduct, data]);

  // Calculate monthly trends for individual items
  const getMonthlyTrends = (itemKey, periodData) => {
    if (!periodData || Object.keys(periodData).length === 0) {
      console.log('No period data available for trends');
      return [];
    }
    
    console.log('Getting monthly trends for:', itemKey, 'Period data keys:', Object.keys(periodData));
    
    const trends = [];
    availablePeriods.forEach(period => {
      const periodItems = periodData[period] || [];
      console.log(`Period ${period} has ${periodItems.length} items`);
      
      // Find the item by matching the key with the appropriate field
      const item = periodItems.find(i => {
        // For materials, match by material_description
        if (i.material_description && i.material_description === itemKey) {
          return true;
        }
        // For machines, match by machine_id
        if (i.machine_id && i.machine_id === itemKey) {
          return true;
        }
        // For labor, match by labor_type_id
        if (i.labor_type_id && i.labor_type_id === itemKey) {
          return true;
        }
        return false;
      });
      
      if (item) {
        let value = 0;
        if (item.total_quantity_needed !== undefined) {
          value = item.total_quantity_needed;
        } else if (item.utilization_percent !== undefined) {
          value = item.utilization_percent;
        } else if (item.fte_required !== undefined) {
          value = item.fte_required;
        }
        
        console.log(`Found item for ${itemKey} in ${period}:`, { value, item });
        
        trends.push({ 
          label: period, 
          value: value 
        });
      } else {
        console.log(`No item found for ${itemKey} in ${period}`);
        trends.push({ label: period, value: 0 });
      }
    });
    
    console.log('Generated trends for', itemKey, ':', trends);
    
    // If no trends were generated, try to create a simple trend from the current data
    if (trends.length === 0 && Object.keys(periodData).length > 0) {
      console.log('No trends generated, creating fallback trend');
      const firstPeriod = Object.keys(periodData)[0];
      const firstPeriodItems = periodData[firstPeriod] || [];
      const firstItem = firstPeriodItems.find(i => 
        i.material_description === itemKey || 
        i.machine_id === itemKey || 
        i.labor_type_id === itemKey
      );
      
      if (firstItem) {
        let value = 0;
        if (firstItem.total_quantity_needed !== undefined) {
          value = firstItem.total_quantity_needed;
        } else if (firstItem.utilization_percent !== undefined) {
          value = firstItem.utilization_percent;
        } else if (firstItem.fte_required !== undefined) {
          value = firstItem.fte_required;
        }
        
        trends.push({ 
          label: firstPeriod, 
          value: value 
        });
      }
    }
    
    return trends;
  };

  // Handle product tile click
  const handleProductClick = (product) => {
    setSelectedProduct(product);
  };

  // Handle recalculate costs
  const handleRecalculateCosts = () => {
    setRecalculateTrigger(prev => prev + 1);
    toast.success('Costs recalculated');
  };

  // Get data for selected period
  const getDataForPeriod = (periodData, period) => {
    if (period === 'all') {
      // Combine all periods
      const combined = {};
      Object.keys(periodData).forEach(p => {
        periodData[p].forEach(item => {
          const key = item.material_description || item.machine_id || item.labor_type_id;
          if (!combined[key]) {
            combined[key] = { ...item };
          } else {
            // Combine quantities and costs
            combined[key].total_quantity_needed = (combined[key].total_quantity_needed || 0) + (item.total_quantity_needed || 0);
            combined[key].total_cost = (combined[key].total_cost || 0) + (item.total_cost || 0);
            combined[key].total_minutes_required = (combined[key].total_minutes_required || 0) + (item.total_minutes_required || 0);
            combined[key].total_hours_required = (combined[key].total_hours_required || 0) + (item.total_hours_required || 0);
            
            // For products_using or products_involved, combine arrays
            if (item.products_using) {
              combined[key].products_using = [...new Set([...(combined[key].products_using || []), ...item.products_using])];
            }
            if (item.products_involved) {
              combined[key].products_involved = [...new Set([...(combined[key].products_involved || []), ...item.products_involved])];
            }
          }
        });
      });
      
      // Recalculate utilization for machines
      Object.keys(combined).forEach(key => {
        const item = combined[key];
        if (item.available_minutes_per_month) {
          item.utilization_percent = (item.total_minutes_required / item.available_minutes_per_month) * 100;
          item.capacity_exceeded = item.utilization_percent > 100;
        }
        if (item.total_hours_required) {
          item.fte_required = item.total_hours_required / 173.33; // Monthly working hours
        }
      });
      
      return Object.values(combined);
    }
    
    return periodData[period] || [];
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(value || 0);
  };

  const formatPercent = (value) => {
    return `${(value || 0).toFixed(1)}%`;
  };

  const formatNumber = (value, decimals = 0) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(value || 0);
  };

  if (loading) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="ml-4 text-muted-foreground">Loading cost data...</p>
        </div>
      </div>
    );
  }

  // Calculate summary statistics
  const totalRevenue = costSummary.reduce((sum, p) => sum + p.forecasted_revenue, 0);
  const totalCOGS = costSummary.reduce((sum, p) => sum + p.total_cogs, 0);
  const totalMaterialCost = costSummary.reduce((sum, p) => sum + p.material_cost, 0);
  const totalLaborCost = costSummary.reduce((sum, p) => sum + p.labor_cost, 0);
  const totalMachineCost = costSummary.reduce((sum, p) => sum + p.machine_cost, 0);
  const overallMargin = totalRevenue > 0 ? ((totalRevenue - totalCOGS) / totalRevenue) * 100 : 0;

  const headerActions = [
    {
      label: 'Recalculate',
      onClick: handleRecalculateCosts,
      variant: 'outline'
    }
  ];

  return (
    <div className="container mx-auto px-6 py-8">
      <PageHeader
        title="Cost Management"
        description={`Manage your business costs and resource utilization. ${activeScenario ? `Active scenario: ${activeScenario}` : ''}`}
        actions={headerActions}
      />

      <CostWarningsBanner />

      {/* Summary Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatsCard
          title="Total Revenue"
          value={formatCurrency(totalRevenue)}
          variant="primary"
        />
        <StatsCard
          title="Total COGS"
          value={formatCurrency(totalCOGS)}
          variant="danger"
        />
        <StatsCard
          title="Materials"
          value={formatCurrency(totalMaterialCost)}
          subtitle={totalCOGS > 0 ? `${formatPercent((totalMaterialCost / totalCOGS) * 100)}` : '0%'}
          variant="info"
        />
        <StatsCard
          title="Labor"
          value={formatCurrency(totalLaborCost)}
          subtitle={totalCOGS > 0 ? `${formatPercent((totalLaborCost / totalCOGS) * 100)}` : '0%'}
          variant="warning"
        />
        <StatsCard
          title="Machines"
          value={formatCurrency(totalMachineCost)}
          subtitle={totalCOGS > 0 ? `${formatPercent((totalMachineCost / totalCOGS) * 100)}` : '0%'}
          variant="secondary"
        />
        <StatsCard
          title="Overall Margin"
          value={formatPercent(overallMargin)}
          variant="success"
        />
      </div>

      {/* Period selector for non-overview tabs */}
      {activeTab !== 'overview' && (
        <div className="flex items-center gap-2 mb-6">
          <label className="text-sm font-medium">View Period:</label>
          <Select value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value)}>
            <SelectOption value="all">All Periods Combined</SelectOption>
            {availablePeriods.map(period => (
              <SelectOption key={period} value={period}>{period}</SelectOption>
            ))}
          </Select>
        </div>
      )}

      {/* Custom Tab Navigation */}
      <div className="space-y-6">
        {/* Tab Buttons */}
        <div className="grid w-full grid-cols-4 bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === 'overview'
                ? 'bg-white text-blue-700 shadow-sm border border-blue-200'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Product Overview
          </button>
          <button
            onClick={() => setActiveTab('materials')}
            className={`px-3 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === 'materials'
                ? 'bg-white text-blue-700 shadow-sm border border-blue-200'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Materials Dashboard
          </button>
          <button
            onClick={() => setActiveTab('machines')}
            className={`px-3 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === 'machines'
                ? 'bg-white text-blue-700 shadow-sm border border-blue-200'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Machine Utilization
          </button>
          <button
            onClick={() => setActiveTab('labor')}
            className={`px-3 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === 'labor'
                ? 'bg-white text-blue-700 shadow-sm border border-blue-200'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Labor & FTE
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {costSummary.map((product) => (
                <Card 
                  key={product.product_id}
                  className={`cursor-pointer transition-all hover:shadow-md ${selectedProduct?.product_id === product.product_id ? 'ring-2 ring-primary' : ''}`}
                  onClick={() => handleProductClick(product)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-lg">{product.product_name}</CardTitle>
                        <Badge variant="outline">{product.product_id}</Badge>
                      </div>
                      {product.warnings && product.warnings.length > 0 && (
                        <Badge
                          variant="outline"
                          className="border-amber-400 bg-amber-50 text-amber-900"
                          title={`Incomplete cost data: ${product.warnings.join(', ')}`}
                        >
                          ⚠️ {product.warnings.length}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <div className="text-sm text-muted-foreground">Revenue</div>
                        <div className="font-semibold">{formatCurrency(product.forecasted_revenue)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">COGS</div>
                        <div className="font-semibold text-red-600">{formatCurrency(product.total_cogs)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Margin</div>
                        <div className="font-semibold text-green-600">{formatPercent(product.gross_margin_percent)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Quantity</div>
                        <div className="font-semibold">{formatNumber(product.forecast_quantity)}</div>
                      </div>
                    </div>
                    
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Materials:</span>
                        <span>{formatCurrency(product.material_cost)} ({product.total_cogs > 0 ? formatPercent((product.material_cost / product.total_cogs) * 100) : '0%'})</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Labor:</span>
                        <span>{formatCurrency(product.labor_cost)} ({product.total_cogs > 0 ? formatPercent((product.labor_cost / product.total_cogs) * 100) : '0%'})</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Machines:</span>
                        <span>{formatCurrency(product.machine_cost)} ({product.total_cogs > 0 ? formatPercent((product.machine_cost / product.total_cogs) * 100) : '0%'})</span>
                      </div>
                    </div>

                    <div className="mt-4 text-xs text-muted-foreground">
                      Unit costs: Mat: {formatCurrency(product.unit_material_cost)}, Lab: {formatCurrency(product.unit_labor_cost)}, Mach: {formatCurrency(product.unit_machine_cost)}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {selectedProduct && (
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle>Details for {selectedProduct.product_name}</CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedProduct(null)}>×</Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div>
                      <h3 className="text-lg font-semibold mb-4">Bill of Materials</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left p-2">Line</th>
                              <th className="text-left p-2">Material</th>
                              <th className="text-left p-2">Qty</th>
                              <th className="text-left p-2">Unit</th>
                              <th className="text-left p-2">Unit Price</th>
                              <th className="text-left p-2">Total Cost</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bomDetails.map((item, index) => (
                              <tr key={index} className="border-b">
                                <td className="p-2">{item.bom_line}</td>
                                <td className="p-2">{item.material_description}</td>
                                <td className="p-2">{formatNumber(item.qty, 2)}</td>
                                <td className="p-2">{item.unit}</td>
                                <td className="p-2">{formatCurrency(item.unit_price)}</td>
                                <td className="p-2">{formatCurrency(item.material_cost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    
                    <div>
                      <h3 className="text-lg font-semibold mb-4">Routing Operations</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left p-2">Seq</th>
                              <th className="text-left p-2">Machine</th>
                              <th className="text-left p-2">Machine Min</th>
                              <th className="text-left p-2">Labor Min</th>
                              <th className="text-left p-2">Labor Type</th>
                              <th className="text-left p-2">Labor Rate</th>
                            </tr>
                          </thead>
                          <tbody>
                            {routingDetails.map((item, index) => (
                              <tr key={index} className="border-b">
                                <td className="p-2">{item.sequence}</td>
                                <td className="p-2">{item.machine_name}</td>
                                <td className="p-2">{formatNumber(item.machine_minutes)}</td>
                                <td className="p-2">{formatNumber(item.labor_minutes)}</td>
                                <td className="p-2">{item.rate_name}</td>
                                <td className="p-2">{formatCurrency(item.rate_amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {activeTab === 'materials' && (
          <MaterialsUsageTab
            materialsUsage={materialsUsage}
            selectedPeriod={selectedPeriod}
            getDataForPeriod={getDataForPeriod}
            getMonthlyTrends={getMonthlyTrends}
            formatCurrency={formatCurrency}
            formatNumber={formatNumber}
          />
        )}

        {activeTab === 'machines' && (
          <MachineUtilizationTab
            machineUtilization={machineUtilization}
            selectedPeriod={selectedPeriod}
            getDataForPeriod={getDataForPeriod}
            getMonthlyTrends={getMonthlyTrends}
            formatCurrency={formatCurrency}
            formatNumber={formatNumber}
            formatPercent={formatPercent}
          />
        )}

        {activeTab === 'labor' && (
          <LaborUtilizationTab
            laborUtilization={laborUtilization}
            selectedPeriod={selectedPeriod}
            getDataForPeriod={getDataForPeriod}
            getMonthlyTrends={getMonthlyTrends}
            formatCurrency={formatCurrency}
            formatNumber={formatNumber}
          />
        )}
      </div>
    </div>
  );
};

export default CostManagement;