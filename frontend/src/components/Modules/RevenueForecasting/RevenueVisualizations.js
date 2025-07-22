import React, { useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';

const RevenueVisualizations = ({ data, timePeriods }) => {
  const { activeScenario } = useForecast();
  
  // Generate chart data
  const chartData = useMemo(() => {
    const products = Array.isArray(data.products) ? data.products : [];
    const customers = Array.isArray(data.customers) ? data.customers : [];
    const sales = Array.isArray(data.sales_forecast) ? data.sales_forecast : [];
    
    // Filter sales by active scenario
    const activeSales = sales.filter(sale => sale.forecast_id === (activeScenario || 'F001'));
    
    // Revenue by Product
    const productRevenue = products.map(product => {
      const productSales = activeSales.filter(sale => 
        sale.unit_id === (product.unit_id || product.id) || 
        sale.unit_id === (product.unit_name || product.name)
      );
      const totalRevenue = productSales.reduce((sum, sale) => sum + (sale.total_revenue || 0), 0);
      return {
        name: product.unit_name || product.name,
        revenue: totalRevenue
      };
    }).filter(item => item.revenue > 0);
    
    // Revenue by Customer
    const customerRevenue = customers.map(customer => {
      const customerSales = activeSales.filter(sale => sale.customer_id === customer.customer_id);
      const totalRevenue = customerSales.reduce((sum, sale) => sum + (sale.total_revenue || 0), 0);
      return {
        name: customer.customer_name,
        revenue: totalRevenue
      };
    }).filter(item => item.revenue > 0);
    
    // Revenue by Time Period
    const timePeriodRevenue = timePeriods.map(period => {
      const periodSales = activeSales.filter(sale => sale.period === period.key);
      const totalRevenue = periodSales.reduce((sum, sale) => sum + (sale.total_revenue || 0), 0);
      return {
        name: period.label,
        revenue: totalRevenue
      };
    });
    
    // Revenue by Segment
    const segmentRevenue = customers.reduce((acc, customer) => {
      const segment = customer.customer_type || customer.region || 'General';
      const customerSales = activeSales.filter(sale => sale.customer_id === customer.customer_id);
      const totalRevenue = customerSales.reduce((sum, sale) => sum + (sale.total_revenue || 0), 0);
      
      if (acc[segment]) {
        acc[segment] += totalRevenue;
      } else {
        acc[segment] = totalRevenue;
      }
      return acc;
    }, {});
    
    const segmentData = Object.entries(segmentRevenue).map(([segment, revenue]) => ({
      name: segment,
      revenue: revenue
    })).filter(item => item.revenue > 0);
    
    return {
      productRevenue,
      customerRevenue,
      timePeriodRevenue,
      segmentData
    };
  }, [data.products, data.customers, data.sales_forecast, timePeriods, activeScenario]);

  // Chart colors
  const colors = ['#c2410c', '#ea580c', '#fb923c', '#fdba74', '#fed7aa', '#ffedd5'];

  const formatCurrency = (value) => `$${value.toLocaleString()}`;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by Product */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              📊 Revenue by Product
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.productRevenue.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData.productRevenue}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="name" 
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    fontSize={12}
                  />
                  <YAxis 
                    tickFormatter={formatCurrency}
                    fontSize={12}
                  />
                  <Tooltip 
                    formatter={(value) => [formatCurrency(value), 'Revenue']}
                    labelStyle={{ color: '#374151' }}
                  />
                  <Bar dataKey="revenue" fill="#c2410c" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <div className="text-4xl mb-2">📊</div>
                <p>No product revenue data available</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Revenue by Customer */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              👥 Revenue by Customer
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.customerRevenue.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData.customerRevenue}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="name" 
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    fontSize={12}
                  />
                  <YAxis 
                    tickFormatter={formatCurrency}
                    fontSize={12}
                  />
                  <Tooltip 
                    formatter={(value) => [formatCurrency(value), 'Revenue']}
                    labelStyle={{ color: '#374151' }}
                  />
                  <Bar dataKey="revenue" fill="#ea580c" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <div className="text-4xl mb-2">👥</div>
                <p>No customer revenue data available</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Revenue by Time Period */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            📈 Revenue by Time Period
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.timePeriodRevenue.some(item => item.revenue > 0) ? (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={chartData.timePeriodRevenue}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="name" 
                  fontSize={12}
                />
                <YAxis 
                  tickFormatter={formatCurrency}
                  fontSize={12}
                />
                <Tooltip 
                  formatter={(value) => [formatCurrency(value), 'Revenue']}
                  labelStyle={{ color: '#374151' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="revenue" 
                  stroke="#c2410c" 
                  strokeWidth={3}
                  dot={{ fill: '#c2410c', strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6, stroke: '#c2410c', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <div className="text-4xl mb-2">📈</div>
              <p>No time period revenue data available</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revenue by Segment */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            🎯 Revenue by Segment
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.segmentData.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={chartData.segmentData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="revenue"
                  >
                    {chartData.segmentData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value) => [formatCurrency(value), 'Revenue']}
                    labelStyle={{ color: '#374151' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              
              <div className="space-y-3">
                <h4 className="font-semibold text-gray-900">Segment Breakdown</h4>
                {chartData.segmentData.map((segment, index) => (
                  <div key={segment.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div 
                        className="w-4 h-4 rounded-full" 
                        style={{ backgroundColor: colors[index % colors.length] }}
                      ></div>
                      <span className="font-medium text-gray-700">{segment.name}</span>
                    </div>
                    <span className="font-semibold text-gray-900">
                      {formatCurrency(segment.revenue)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <div className="text-4xl mb-2">🎯</div>
              <p>No segment revenue data available</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default RevenueVisualizations; 