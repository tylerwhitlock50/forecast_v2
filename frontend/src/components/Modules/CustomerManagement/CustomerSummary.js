import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';

const CustomerSummary = ({ customers }) => {
  const summaryData = useMemo(() => {
    const totalCustomers = customers.length;
    
    // Customer types breakdown
    const typeBreakdown = customers.reduce((acc, customer) => {
      const type = customer.customer_type || 'Unspecified';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    
    // Region breakdown
    const regionBreakdown = customers.reduce((acc, customer) => {
      const region = customer.region || 'Unknown';
      acc[region] = (acc[region] || 0) + 1;
      return acc;
    }, {});
    
    // Data completeness metrics
    const withCustomerId = customers.filter(c => c.customer_id).length;
    const withCustomerName = customers.filter(c => c.customer_name).length;
    const withCustomerType = customers.filter(c => c.customer_type).length;
    const withRegion = customers.filter(c => c.region).length;
    
    // Data quality metrics
    const completeProfiles = customers.filter(c => 
      c.customer_id && c.customer_name && c.customer_type && c.region
    ).length;
    
    // Customer ID format compliance
    const validIdFormat = customers.filter(c => 
      c.customer_id && c.customer_id.match(/^CUST-\d{3}$/)
    ).length;
    
    return {
      totalCustomers,
      typeBreakdown,
      regionBreakdown,
      dataMetrics: {
        withCustomerId,
        withCustomerName,
        withCustomerType,
        withRegion
      },
      dataQuality: {
        completeProfiles,
        incompleteProfiles: totalCustomers - completeProfiles,
        validIdFormat,
        invalidIdFormat: totalCustomers - validIdFormat
      }
    };
  }, [customers]);

  const topCustomerTypes = Object.entries(summaryData.typeBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topRegions = Object.entries(summaryData.regionBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const summaryCards = [
    {
      title: "Total Customers",
      value: summaryData.totalCustomers,
      icon: "👥",
      color: "text-blue-600"
    },
    {
      title: "Complete Profiles",
      value: summaryData.dataQuality.completeProfiles,
      icon: "✅",
      color: "text-green-600"
    },
    {
      title: "Valid ID Format",
      value: summaryData.dataQuality.validIdFormat,
      icon: "🆔",
      color: "text-purple-600"
    },
    {
      title: "With Region",
      value: summaryData.dataMetrics.withRegion,
      icon: "🌍",
      color: "text-orange-600"
    }
  ];

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

        {/* Customer Types */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Customer Types</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topCustomerTypes.map(([type, count]) => (
                <div key={type} className="space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-medium">{type}</span>
                    <span className="text-muted-foreground">{count}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="h-2 rounded-full transition-all duration-300"
                      style={{ 
                        width: `${(count / summaryData.totalCustomers) * 100}%`,
                        backgroundColor: getTypeColor(type)
                      }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Regional Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Regional Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topRegions.map(([region, count]) => (
                <div key={region} className="space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-medium">{region}</span>
                    <span className="text-muted-foreground">{count}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="h-2 rounded-full transition-all duration-300"
                      style={{ 
                        width: `${(count / summaryData.totalCustomers) * 100}%`,
                        backgroundColor: getRegionColor(region)
                      }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

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
                    width: `${(summaryData.dataQuality.completeProfiles / summaryData.totalCustomers) * 100}%`
                  }}
                ></div>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium">With Customer ID</span>
                <span className="text-muted-foreground">{summaryData.dataMetrics.withCustomerId}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="h-2 rounded-full bg-blue-500 transition-all duration-300"
                  style={{ 
                    width: `${(summaryData.dataMetrics.withCustomerId / summaryData.totalCustomers) * 100}%`
                  }}
                ></div>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium">With Customer Name</span>
                <span className="text-muted-foreground">{summaryData.dataMetrics.withCustomerName}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="h-2 rounded-full bg-purple-500 transition-all duration-300"
                  style={{ 
                    width: `${(summaryData.dataMetrics.withCustomerName / summaryData.totalCustomers) * 100}%`
                  }}
                ></div>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium">With Customer Type</span>
                <span className="text-muted-foreground">{summaryData.dataMetrics.withCustomerType}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="h-2 rounded-full bg-yellow-500 transition-all duration-300"
                  style={{ 
                    width: `${(summaryData.dataMetrics.withCustomerType / summaryData.totalCustomers) * 100}%`
                  }}
                ></div>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium">With Region</span>
                <span className="text-muted-foreground">{summaryData.dataMetrics.withRegion}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="h-2 rounded-full bg-orange-500 transition-all duration-300"
                  style={{ 
                    width: `${(summaryData.dataMetrics.withRegion / summaryData.totalCustomers) * 100}%`
                  }}
                ></div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium">Valid ID Format</span>
                <span className="text-muted-foreground">{summaryData.dataQuality.validIdFormat}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="h-2 rounded-full bg-teal-500 transition-all duration-300"
                  style={{ 
                    width: `${(summaryData.dataQuality.validIdFormat / summaryData.totalCustomers) * 100}%`
                  }}
                ></div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium">Invalid ID Format</span>
                <span className="text-muted-foreground">{summaryData.dataQuality.invalidIdFormat}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="h-2 rounded-full bg-red-500 transition-all duration-300"
                  style={{ 
                    width: `${(summaryData.dataQuality.invalidIdFormat / summaryData.totalCustomers) * 100}%`
                  }}
                ></div>
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
            {summaryData.dataQuality.incompleteProfiles > 0 && (
              <div className="flex items-start gap-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <span className="text-xl">⚠️</span>
                <span className="text-sm text-yellow-800">
                  {summaryData.dataQuality.incompleteProfiles} customers have incomplete profiles. 
                  Consider reaching out to gather missing information.
                </span>
              </div>
            )}
            
            {summaryData.dataQuality.invalidIdFormat > 0 && (
              <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <span className="text-xl">⚠️</span>
                <span className="text-sm text-red-800">
                  {summaryData.dataQuality.invalidIdFormat} customers have invalid ID format. 
                  Please ensure all customer IDs follow the CUST-XXX format.
                </span>
              </div>
            )}
            
            {Object.keys(summaryData.typeBreakdown).length < 3 && (
              <div className="flex items-start gap-3 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                <span className="text-xl">🏷️</span>
                <span className="text-sm text-purple-800">
                  Customer types are not well diversified. Consider adding more customer type categories.
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// Helper functions for colors
const getTypeColor = (type) => {
  const colors = {
    'Enterprise': '#007bff',
    'SMB': '#28a745',
    'Startup': '#ffc107',
    'Government': '#6f42c1',
    'Education': '#17a2b8',
    'Healthcare': '#e83e8c',
    'Retail': '#fd7e14',
    'Manufacturing': '#6c757d',
    'Other': '#6c757d',
    'Unspecified': '#6c757d'
  };
  return colors[type] || '#6c757d';
};

const getRegionColor = (region) => {
  const colors = {
    'North America': '#007bff',
    'Europe': '#28a745',
    'Asia Pacific': '#ffc107',
    'Latin America': '#e83e8c',
    'Middle East': '#fd7e14',
    'Africa': '#6f42c1',
    'Unknown': '#6c757d'
  };
  return colors[region] || '#6c757d';
};

export default CustomerSummary; 