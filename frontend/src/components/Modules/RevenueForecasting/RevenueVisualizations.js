import React, { useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line
} from 'recharts';

const RevenueVisualizations = ({ data, timePeriods }) => {
  const { activeScenario } = useForecast();
  
  // Generate matrix data for visualizations
  const matrixData = useMemo(() => {
    const matrix = [];
    
    const products = Array.isArray(data.products) ? data.products : [];
    const customers = Array.isArray(data.customers) ? data.customers : [];
    const sales = Array.isArray(data.sales_forecast) ? data.sales_forecast : [];
    
    products.forEach(product => {
      customers.forEach(customer => {
        const productId = product.unit_id || product.id;
        const baseRow = {
          id: `${productId}-${customer.customer_id}`,
          product_id: productId,
          product_name: product.unit_name || product.name,
          customer_id: customer.customer_id,
          customer_name: customer.customer_name,
          segment: customer.customer_type || customer.region || 'General',
          total_quantity: 0,
          total_revenue: 0
        };

        // Add time period columns
        timePeriods.forEach(period => {
          // Find existing sale with flexible matching (by ID or name)
          const existingSale = sales.find(s => 
            (s.unit_id === productId || s.unit_id === product.unit_name) && 
            s.customer_id === customer.customer_id && 
            s.period === period.key &&
            s.forecast_id === (activeScenario || 'F001')
          );
          
          baseRow[`quantity_${period.key}`] = existingSale?.quantity || 0;
          baseRow[`price_${period.key}`] = existingSale?.unit_price || 0;
          baseRow[`revenue_${period.key}`] = (existingSale?.quantity || 0) * (existingSale?.unit_price || 0);
          
          baseRow.total_quantity += existingSale?.quantity || 0;
          baseRow.total_revenue += (existingSale?.quantity || 0) * (existingSale?.unit_price || 0);
        });

        matrix.push(baseRow);
      });
    });

    return matrix;
  }, [data.products, data.customers, data.sales_forecast, timePeriods, activeScenario]);

  // Prepare chart data
  const chartData = useMemo(() => {
    // Revenue by Product
    const productRevenue = Array.from(new Set(matrixData.map(row => row.product_name)))
      .map(product => {
        const revenue = matrixData
          .filter(row => row.product_name === product)
          .reduce((sum, row) => sum + row.total_revenue, 0);
        return { name: product, revenue };
      })
      .filter(item => item.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);

    // Revenue by Customer
    const customerRevenue = Array.from(new Set(matrixData.map(row => row.customer_name)))
      .map(customer => {
        const revenue = matrixData
          .filter(row => row.customer_name === customer)
          .reduce((sum, row) => sum + row.total_revenue, 0);
        return { name: customer, revenue };
      })
      .filter(item => item.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);

    // Revenue by Time Period
    const timeRevenue = timePeriods.map(period => {
      const revenue = matrixData.reduce((sum, row) => sum + (row[`revenue_${period.key}`] || 0), 0);
      return { name: period.label, revenue };
    });

    // Revenue by Segment
    const segmentRevenue = Array.from(new Set(matrixData.map(row => row.segment)))
      .map(segment => {
        const revenue = matrixData
          .filter(row => row.segment === segment)
          .reduce((sum, row) => sum + row.total_revenue, 0);
        return { name: segment, revenue };
      })
      .filter(item => item.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);

    return {
      productRevenue,
      customerRevenue,
      timeRevenue,
      segmentRevenue
    };
  }, [matrixData, timePeriods]);

  // Colors for charts
  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316'];

  const formatCurrency = (value) => `$${value.toLocaleString()}`;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by Product */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Product</CardTitle>
          </CardHeader>
          <CardContent>
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
                <Bar dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Revenue by Customer */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Customer</CardTitle>
          </CardHeader>
          <CardContent>
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
                <Bar dataKey="revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Revenue by Time Period */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Time Period</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData.timeRevenue}>
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
                  stroke="#f59e0b" 
                  strokeWidth={3}
                  dot={{ fill: '#f59e0b', strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6, stroke: '#f59e0b', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Revenue by Segment */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Segment</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={chartData.segmentRevenue}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="revenue"
                >
                  {chartData.segmentRevenue.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value) => [formatCurrency(value), 'Revenue']}
                  labelStyle={{ color: '#374151' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Summary Statistics */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {formatCurrency(chartData.productRevenue.reduce((sum, item) => sum + item.revenue, 0))}
              </div>
              <div className="text-sm text-gray-600">Total Revenue</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {chartData.productRevenue.length}
              </div>
              <div className="text-sm text-gray-600">Active Products</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {chartData.customerRevenue.length}
              </div>
              <div className="text-sm text-gray-600">Active Customers</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {chartData.segmentRevenue.length}
              </div>
              <div className="text-sm text-gray-600">Segments</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RevenueVisualizations; 