import React, { useState, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import { PageHeader } from '../../ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { StatsCard } from '../../ui/stats-card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Select, SelectOption } from '../../ui/select';
import {
  calculateProductCostSummary,
  calculateMaterialsUsage,
  calculateMachineUtilization,
  calculateLaborUtilization,
  getBOMDetails,
  getRoutingDetails
} from './CostCalculations';

const CostManagement = () => {
  const { data, loading, activeScenario } = useForecast();
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState('all');
  const [recalculateTrigger, setRecalculateTrigger] = useState(0);

  // Get unique periods from forecast data
  const availablePeriods = useMemo(() => {
    const periods = [...new Set((data.sales_forecast || []).map(f => f.period))].sort();
    return periods;
  }, [data.sales_forecast]);

  // Calculate cost summary
  const costSummary = useMemo(() => {
    if (!data || !data.products || !data.sales_forecast) return [];
    
    try {
      const summary = calculateProductCostSummary(data);
      return summary.filter(product => product.forecast_quantity > 0); // Only show products with forecasts
    } catch (error) {
      console.error('Error calculating cost summary:', error);
      toast.error('Error calculating cost summary');
      return [];
    }
  }, [data]);

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
      return {};
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Product Overview</TabsTrigger>
          <TabsTrigger value="materials">Materials Dashboard</TabsTrigger>
          <TabsTrigger value="machines">Machine Utilization</TabsTrigger>
          <TabsTrigger value="labor">Labor & FTE</TabsTrigger>
        </TabsList>

        {/* Period selector for non-overview tabs */}
        {activeTab !== 'overview' && (
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">View Period:</label>
            <Select value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value)}>
              <SelectOption value="all">All Periods Combined</SelectOption>
              {availablePeriods.map(period => (
                <SelectOption key={period} value={period}>{period}</SelectOption>
              ))}
            </Select>
          </div>
        )}

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {costSummary.map((product) => (
              <Card 
                key={product.product_id}
                className={`cursor-pointer transition-all hover:shadow-md ${selectedProduct?.product_id === product.product_id ? 'ring-2 ring-primary' : ''}`}
                onClick={() => handleProductClick(product)}
              >
                <CardHeader>
                  <CardTitle className="text-lg">{product.product_name}</CardTitle>
                  <Badge variant="outline">{product.product_id}</Badge>
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
                <Tabs defaultValue="bom" className="space-y-4">
                  <TabsList>
                    <TabsTrigger value="bom">Bill of Materials</TabsTrigger>
                    <TabsTrigger value="routing">Routing Operations</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="bom">
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
                  </TabsContent>
                  
                  <TabsContent value="routing">
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
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="materials" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Materials Usage Forecast - {selectedPeriod === 'all' ? 'All Periods' : selectedPeriod}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {getDataForPeriod(materialsUsage, selectedPeriod).map((material, index) => (
                  <Card key={index}>
                    <CardHeader>
                      <CardTitle className="text-lg">{material.material_description}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-2">
                          <div className="flex justify-between text-sm">
                            <span>Quantity Needed:</span>
                            <span className="font-semibold">{formatNumber(material.total_quantity_needed, 2)} {material.unit}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span>Unit Price:</span>
                            <span className="font-semibold">{formatCurrency(material.unit_price)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span>Total Cost:</span>
                            <span className="font-semibold">{formatCurrency(material.total_cost)}</span>
                          </div>
                        </div>
                        
                        <div>
                          <div className="text-sm font-medium mb-2">Used by:</div>
                          <div className="flex flex-wrap gap-1">
                            {material.products_using.map((product, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">{product}</Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="machines" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Machine Utilization - {selectedPeriod === 'all' ? 'All Periods' : selectedPeriod}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {getDataForPeriod(machineUtilization, selectedPeriod).map((machine, index) => (
                  <Card key={index} className={machine.capacity_exceeded ? 'border-red-500 bg-red-50' : ''}>
                    <CardHeader>
                      <div className="flex justify-between items-center">
                        <CardTitle className="text-lg">{machine.machine_name}</CardTitle>
                        {machine.capacity_exceeded && (
                          <Badge variant="destructive">Over Capacity</Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-2 text-sm">
                          <div className="flex justify-between">
                            <span>Required Minutes:</span>
                            <span className="font-semibold">{formatNumber(machine.total_minutes_required)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Available Minutes:</span>
                            <span className="font-semibold">{formatNumber(machine.available_minutes_per_month)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Utilization:</span>
                            <span className={`font-semibold ${machine.utilization_percent > 100 ? 'text-red-600' : 'text-green-600'}`}>
                              {formatPercent(machine.utilization_percent)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Total Cost:</span>
                            <span className="font-semibold">{formatCurrency(machine.total_cost)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Machine Rate:</span>
                            <span className="font-semibold">{formatCurrency(machine.machine_rate)}/hr</span>
                          </div>
                        </div>
                        
                        {machine.capacity_exceeded && (
                          <div className="p-3 bg-red-100 border border-red-200 rounded text-sm text-red-800">
                            ⚠️ Capacity Exceeded by {formatPercent(machine.utilization_percent - 100)}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="labor" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Labor Utilization & FTE - {selectedPeriod === 'all' ? 'All Periods' : selectedPeriod}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {getDataForPeriod(laborUtilization, selectedPeriod).map((labor, index) => (
                  <Card key={index}>
                    <CardHeader>
                      <div className="flex justify-between items-center">
                        <CardTitle className="text-lg">{labor.labor_type_name}</CardTitle>
                        <Badge variant="outline">{labor.labor_type}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-2 text-sm">
                          <div className="flex justify-between">
                            <span>Required Minutes:</span>
                            <span className="font-semibold">{formatNumber(labor.total_minutes_required)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Required Hours:</span>
                            <span className="font-semibold">{formatNumber(labor.total_hours_required)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>FTE Required:</span>
                            <span className="font-semibold">{formatNumber(labor.fte_required, 2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Hourly Rate:</span>
                            <span className="font-semibold">{formatCurrency(labor.hourly_rate)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Total Cost:</span>
                            <span className="font-semibold">{formatCurrency(labor.total_cost)}</span>
                          </div>
                        </div>
                        
                        <div>
                          <div className="text-sm font-medium mb-2">Products:</div>
                          <div className="flex flex-wrap gap-1">
                            {labor.products_involved.map((product, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">{product}</Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default CostManagement;