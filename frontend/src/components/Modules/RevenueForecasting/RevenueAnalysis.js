import React, { useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';

const RevenueAnalysis = ({ data, timePeriods }) => {
  const { activeScenario } = useForecast();
  // Get unique segments
  const segments = useMemo(() => {
    const customers = Array.isArray(data.customers) ? data.customers : [];
    return [...new Set(customers.map(c => c.customer_type || c.region || 'General'))];
  }, [data.customers]);

  // Generate matrix data for analysis
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
          baseRow[`price_${period.key}`] = existingSale?.unit_price || 0; // Only use actual sale price, not base price
          baseRow[`revenue_${period.key}`] = (existingSale?.quantity || 0) * (existingSale?.unit_price || 0);
          
          baseRow.total_quantity += existingSale?.quantity || 0;
          baseRow.total_revenue += (existingSale?.quantity || 0) * (existingSale?.unit_price || 0);
        });

        matrix.push(baseRow);
      });
    });

    return matrix;
  }, [data.products, data.customers, data.sales_forecast, timePeriods, activeScenario]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          📈 Segment Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {segments.map(segment => {
            const segmentData = matrixData.filter(row => row.segment === segment);
            const segmentRevenue = segmentData.reduce((sum, row) => sum + row.total_revenue, 0);
            const segmentQuantity = segmentData.reduce((sum, row) => sum + row.total_quantity, 0);
            const uniqueProducts = new Set(segmentData.map(row => row.product_id)).size;
            const uniqueCustomers = new Set(segmentData.map(row => row.customer_id)).size;
            
            return (
              <Card key={segment} className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <span className="text-orange-600">📊</span>
                    {segment}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Revenue:</span>
                    <span className="font-semibold text-green-600">
                      ${segmentRevenue.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Quantity:</span>
                    <span className="font-semibold text-blue-600">
                      {segmentQuantity.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Products:</span>
                    <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                      {uniqueProducts}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Customers:</span>
                    <Badge variant="secondary" className="bg-purple-100 text-purple-800">
                      {uniqueCustomers}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        
        {segments.length === 0 && (
          <div className="text-center py-8">
            <div className="text-4xl mb-4">📊</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No segments found</h3>
            <p className="text-gray-600">
              No customer segments are available for analysis.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default RevenueAnalysis; 