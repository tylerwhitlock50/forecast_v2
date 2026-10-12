import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';

const money = (value) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number(value) || 0);

const ProductSummary = ({ products }) => {
  const summaryData = useMemo(() => {
    const totalProducts = products.length;
    
    // Product types breakdown
    const typeBreakdown = products.reduce((acc, product) => {
      const type = product.unit_type || 'General';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    
    // Price range analysis
    const prices = products.map(p => parseFloat(p.base_price) || 0).filter(p => p > 0);
    const avgPrice = prices.length > 0 ? prices.reduce((sum, price) => sum + price, 0) / prices.length : 0;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
    
    // BOM usage
    const bomUsage = products.reduce((acc, product) => {
      const bom = product.bom || 'None';
      acc[bom] = (acc[bom] || 0) + 1;
      return acc;
    }, {});
    
    // Router usage
    const routerUsage = products.reduce((acc, product) => {
      const router = product.router || 'None';
      acc[router] = (acc[router] || 0) + 1;
      return acc;
    }, {});
    
    // Data completeness
    const withDescription = products.filter(p => p.unit_description).length;
    const withPrice = products.filter(p => p.base_price && parseFloat(p.base_price) > 0).length;
    const withBOM = products.filter(p => p.bom).length;
    const withRouter = products.filter(p => p.router).length;
    
    // Data quality metrics
    const completeProfiles = products.filter(p => 
      p.unit_name && p.base_price && p.bom && p.router
    ).length;
    
    return {
      totalProducts,
      typeBreakdown,
      priceMetrics: {
        average: avgPrice,
        maximum: maxPrice,
        minimum: minPrice,
        withPrice
      },
      bomUsage,
      routerUsage,
      dataQuality: {
        completeProfiles,
        incompleteProfiles: totalProducts - completeProfiles
      },
      completeness: {
        withDescription,
        withPrice,
        withBOM,
        withRouter
      }
    };
  }, [products]);

  const topProductTypes = Object.entries(summaryData.typeBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topBOMs = Object.entries(summaryData.bomUsage)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topRouters = Object.entries(summaryData.routerUsage)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const summaryCards = [
    {
      title: "Total Products",
      value: summaryData.totalProducts,
      icon: "📦",
      color: "text-blue-600"
    },
    {
      title: "Complete Profiles",
      value: summaryData.dataQuality.completeProfiles,
      icon: "✅",
      color: "text-green-600"
    },
    {
      title: "Avg List Price",
      value: money(summaryData.priceMetrics.average),
      icon: "💰",
      color: "text-purple-600"
    },
    {
      title: "With BOM",
      value: summaryData.completeness.withBOM,
      icon: "🏭",
      color: "text-orange-600"
    }
  ];

  const { totalProducts, completeness, dataQuality } = summaryData;
  const recommendations = [];
  if (dataQuality.incompleteProfiles > 0) {
    recommendations.push({
      key: 'incomplete', icon: '⚠️', tone: 'bg-yellow-50 border-yellow-200 text-yellow-800',
      text: `${dataQuality.incompleteProfiles} ${dataQuality.incompleteProfiles === 1 ? 'product is' : 'products are'} missing a list price, BOM or routing, so ${dataQuality.incompleteProfiles === 1 ? 'its' : 'their'} pricing or unit cost is incomplete.`,
    });
  }
  if (totalProducts > 0 && completeness.withPrice < totalProducts) {
    const missing = totalProducts - completeness.withPrice;
    recommendations.push({
      key: 'price', icon: '💰', tone: 'bg-blue-50 border-blue-200 text-blue-800',
      text: `${missing} ${missing === 1 ? 'product has' : 'products have'} no list price. The list price is the fallback when no price-list rule applies.`,
    });
  }
  if (totalProducts > 0 && completeness.withBOM < totalProducts) {
    const missing = totalProducts - completeness.withBOM;
    recommendations.push({
      key: 'bom', icon: '🏭', tone: 'bg-green-50 border-green-200 text-green-800',
      text: `${missing} ${missing === 1 ? 'product has' : 'products have'} no BOM, so material cost is $0.`,
    });
  }

  return (
    <div className="space-y-6">
      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((card, index) => (
          <Card key={index} className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <span>{card.icon}</span>
                {card.title}
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Product Types */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Product Types</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topProductTypes.map(([type, count]) => (
                <div key={type} className="space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-medium">{type}</span>
                    <span className="text-muted-foreground">{count}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="h-2 rounded-full transition-all duration-300"
                      style={{ 
                        width: `${(count / summaryData.totalProducts) * 100}%`,
                        backgroundColor: getTypeColor(type)
                      }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* BOM Usage */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">BOM Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topBOMs.map(([bom, count]) => (
                <div key={bom} className="space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-medium">{bom}</span>
                    <span className="text-muted-foreground">{count}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="h-2 rounded-full transition-all duration-300"
                      style={{ 
                        width: `${(count / summaryData.totalProducts) * 100}%`,
                        backgroundColor: getBOMColor(bom)
                      }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Router Usage */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Router Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {topRouters.map(([router, count]) => (
              <div key={router} className="space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-medium">{router}</span>
                  <span className="text-muted-foreground">{count}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="h-2 rounded-full transition-all duration-300"
                    style={{ 
                      width: `${(count / summaryData.totalProducts) * 100}%`,
                      backgroundColor: getRouterColor(router)
                    }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Data Quality */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Data Quality</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium">Complete Profiles</span>
                <span className="text-muted-foreground">{summaryData.dataQuality.completeProfiles}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="h-2 rounded-full bg-green-500 transition-all duration-300"
                  style={{ 
                    width: `${(summaryData.dataQuality.completeProfiles / summaryData.totalProducts) * 100}%`
                  }}
                ></div>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium">With Description</span>
                <span className="text-muted-foreground">{summaryData.completeness.withDescription}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="h-2 rounded-full bg-blue-500 transition-all duration-300"
                  style={{ 
                    width: `${(summaryData.completeness.withDescription / summaryData.totalProducts) * 100}%`
                  }}
                ></div>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium">With Price</span>
                <span className="text-muted-foreground">{summaryData.completeness.withPrice}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="h-2 rounded-full bg-yellow-500 transition-all duration-300"
                  style={{ 
                    width: `${(summaryData.completeness.withPrice / summaryData.totalProducts) * 100}%`
                  }}
                ></div>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium">With Router</span>
                <span className="text-muted-foreground">{summaryData.completeness.withRouter}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="h-2 rounded-full bg-purple-500 transition-all duration-300"
                  style={{ 
                    width: `${(summaryData.completeness.withRouter / summaryData.totalProducts) * 100}%`
                  }}
                ></div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Price Analysis */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <span>💰</span>
              Average Price
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">
              {money(summaryData.priceMetrics.average)}
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <span>📈</span>
              Highest Price
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">
              {money(summaryData.priceMetrics.maximum)}
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <span>📉</span>
              Lowest Price
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-600">
              {money(summaryData.priceMetrics.minimum)}
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <span>📊</span>
              Priced Products
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-indigo-600">
              {summaryData.priceMetrics.withPrice}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recommendations (only when there is something to do) */}
      {recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Recommendations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recommendations.map((r) => (
                <div key={r.key} className={`flex items-start gap-3 p-3 border rounded-lg ${r.tone}`}>
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

// Helper functions for colors
const getTypeColor = (type) => {
  const colors = {
    'each': '#007bff',
    'unit': '#28a745',
    'piece': '#ffc107',
    'set': '#6f42c1',
    'kit': '#17a2b8',
    'box': '#e83e8c',
    'case': '#fd7e14',
    'pallet': '#6c757d',
    'General': '#6c757d'
  };
  return colors[type] || '#6c757d';
};

const getBOMColor = (bom) => {
  const colors = {
    'BOM-001': '#007bff',
    'BOM-002': '#28a745',
    'BOM-003': '#ffc107',
    'None': '#6c757d'
  };
  return colors[bom] || '#6c757d';
};

const getRouterColor = (router) => {
  const colors = {
    'R0001': '#007bff',
    'R0002': '#28a745',
    'R0003': '#ffc107',
    'None': '#6c757d'
  };
  return colors[router] || '#6c757d';
};

export default ProductSummary; 