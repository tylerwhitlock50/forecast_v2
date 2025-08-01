// Cost calculation utilities for frontend cost management

// Calculate product cost summary
export const calculateProductCostSummary = (data) => {
  const { sales_forecast = [], products = [], bom = [], router_operations = [], machines = [], labor_rates = [] } = data;
  
  console.log('Cost calculation data:', {
    sales_forecast_count: sales_forecast.length,
    products_count: products.length,
    bom_count: bom.length,
    router_operations_count: router_operations.length,
    machines_count: machines.length,
    labor_rates_count: labor_rates.length
  });
  
  const productCostSummary = products.map(product => {
    // Get all forecast entries for this product
    const productForecasts = sales_forecast.filter(forecast => forecast.unit_id === product.unit_id);
    
    console.log(`Product ${product.unit_id} (${product.unit_name}):`, {
      forecasts: productForecasts.length,
      bom_id: product.bom,
      router_id: product.router
    });
    
    // Calculate total forecasted revenue
    const forecastedRevenue = productForecasts.reduce((sum, forecast) => sum + (forecast.total_revenue || 0), 0);
    
    // Calculate material costs from BOM
    const productBOM = bom.filter(bomItem => bomItem.bom_id === product.bom);
    const materialCost = productBOM.reduce((sum, bomItem) => sum + (bomItem.material_cost || 0), 0);
    
    console.log(`BOM for ${product.unit_id}:`, {
      bom_items: productBOM.length,
      material_cost: materialCost
    });
    
    // Calculate labor and machine costs from routing
    const productRouting = router_operations.filter(operation => operation.router_id === product.router);
    
    let laborCost = 0;
    let machineCost = 0;
    
    productRouting.forEach(operation => {
      // Get labor rate for this operation
      const laborRate = labor_rates.find(rate => rate.rate_id === operation.labor_type_id);
      if (laborRate) {
        laborCost += (operation.labor_minutes / 60) * laborRate.rate_amount;
      }
      
      // Get machine rate for this operation
      const machine = machines.find(m => m.machine_id === operation.machine_id);
      if (machine) {
        machineCost += (operation.machine_minutes / 60) * machine.machine_rate;
      }
    });
    
    console.log(`Routing for ${product.unit_id}:`, {
      routing_operations: productRouting.length,
      labor_cost: laborCost,
      machine_cost: machineCost
    });
    
    // Calculate totals per unit produced
    const totalForecastQuantity = productForecasts.reduce((sum, forecast) => sum + (forecast.quantity || 0), 0);
    
    // Scale costs by total forecast quantity
    const totalMaterialCost = materialCost * totalForecastQuantity;
    const totalLaborCost = laborCost * totalForecastQuantity;
    const totalMachineCost = machineCost * totalForecastQuantity;
    const totalCogs = totalMaterialCost + totalLaborCost + totalMachineCost;
    
    // Calculate margins
    const grossMargin = forecastedRevenue - totalCogs;
    const grossMarginPercent = forecastedRevenue > 0 ? (grossMargin / forecastedRevenue) * 100 : 0;
    
    return {
      product_id: product.unit_id,
      product_name: product.unit_name,
      forecasted_revenue: forecastedRevenue,
      material_cost: totalMaterialCost,
      labor_cost: totalLaborCost,
      machine_cost: totalMachineCost,
      total_cogs: totalCogs,
      gross_margin: grossMargin,
      gross_margin_percent: grossMarginPercent,
      forecast_quantity: totalForecastQuantity,
      unit_material_cost: materialCost,
      unit_labor_cost: laborCost,
      unit_machine_cost: machineCost,
      bom_id: product.bom,
      router_id: product.router
    };
  });
  
  console.log('Product cost summary:', productCostSummary);
  return productCostSummary;
};

// Calculate materials usage by period
export const calculateMaterialsUsage = (data) => {
  const { sales_forecast = [], products = [], bom = [] } = data;
  
  console.log('Materials calculation data:', {
    sales_forecast_count: sales_forecast.length,
    products_count: products.length,
    bom_count: bom.length
  });
  
  // Group forecasts by period
  const forecastsByPeriod = sales_forecast.reduce((acc, forecast) => {
    const period = forecast.period;
    if (!acc[period]) acc[period] = [];
    acc[period].push(forecast);
    return acc;
  }, {});
  
  console.log('Forecasts by period:', Object.keys(forecastsByPeriod));
  
  // Calculate material usage for each period
  const materialUsageByPeriod = {};
  
  Object.keys(forecastsByPeriod).forEach(period => {
    const periodForecasts = forecastsByPeriod[period];
    const materialUsage = {};
    
    periodForecasts.forEach(forecast => {
      const product = products.find(p => p.unit_id === forecast.unit_id);
      if (product && product.bom) {
        const productBOM = bom.filter(bomItem => bomItem.bom_id === product.bom);
        
        productBOM.forEach(bomItem => {
          const key = `${bomItem.material_description}_${bomItem.unit}`;
          if (!materialUsage[key]) {
            materialUsage[key] = {
              material_description: bomItem.material_description,
              unit: bomItem.unit,
              unit_price: bomItem.unit_price,
              total_quantity_needed: 0,
              total_cost: 0,
              products_using: new Set()
            };
          }
          
          const quantityNeeded = bomItem.qty * forecast.quantity;
          materialUsage[key].total_quantity_needed += quantityNeeded;
          materialUsage[key].total_cost += quantityNeeded * bomItem.unit_price;
          materialUsage[key].products_using.add(product.unit_name);
        });
      }
    });
    
    // Convert Sets to arrays
    Object.keys(materialUsage).forEach(key => {
      materialUsage[key].products_using = Array.from(materialUsage[key].products_using);
    });
    
    materialUsageByPeriod[period] = Object.values(materialUsage);
  });
  
  console.log('Material usage by period:', materialUsageByPeriod);
  return materialUsageByPeriod;
};

// Calculate machine utilization by period
export const calculateMachineUtilization = (data) => {
  const { sales_forecast = [], products = [], router_operations = [], machines = [] } = data;
  
  console.log('Machine calculation data:', {
    sales_forecast_count: sales_forecast.length,
    products_count: products.length,
    router_operations_count: router_operations.length,
    machines_count: machines.length
  });
  
  // Group forecasts by period
  const forecastsByPeriod = sales_forecast.reduce((acc, forecast) => {
    const period = forecast.period;
    if (!acc[period]) acc[period] = [];
    acc[period].push(forecast);
    return acc;
  }, {});
  
  // Calculate machine utilization for each period
  const machineUtilizationByPeriod = {};
  
  Object.keys(forecastsByPeriod).forEach(period => {
    const periodForecasts = forecastsByPeriod[period];
    const machineUsage = {};
    
    periodForecasts.forEach(forecast => {
      const product = products.find(p => p.unit_id === forecast.unit_id);
      if (product && product.router) {
        const productRouting = router_operations.filter(operation => operation.router_id === product.router);
        
        productRouting.forEach(operation => {
          const machine = machines.find(m => m.machine_id === operation.machine_id);
          if (machine) {
            if (!machineUsage[machine.machine_id]) {
              machineUsage[machine.machine_id] = {
                machine_id: machine.machine_id,
                machine_name: machine.machine_name,
                machine_rate: machine.machine_rate,
                available_minutes_per_month: machine.available_minutes_per_month || 0,
                total_minutes_required: 0,
                total_cost: 0,
                utilization_percent: 0,
                capacity_exceeded: false,
                products_involved: new Set()
              };
            }
            
            const minutesNeeded = operation.machine_minutes * forecast.quantity;
            machineUsage[machine.machine_id].total_minutes_required += minutesNeeded;
            machineUsage[machine.machine_id].total_cost += (minutesNeeded / 60) * machine.machine_rate;
            machineUsage[machine.machine_id].products_involved.add(product.unit_name);
          }
        });
      }
    });
    
    // Calculate utilization percentages for this period
    Object.keys(machineUsage).forEach(machineId => {
      const machine = machineUsage[machineId];
      if (machine.available_minutes_per_month > 0) {
        machine.utilization_percent = (machine.total_minutes_required / machine.available_minutes_per_month) * 100;
        machine.capacity_exceeded = machine.utilization_percent > 100;
      }
      machine.products_involved = Array.from(machine.products_involved);
    });
    
    machineUtilizationByPeriod[period] = Object.values(machineUsage);
  });
  
  console.log('Machine utilization by period:', machineUtilizationByPeriod);
  return machineUtilizationByPeriod;
};

// Calculate labor utilization and FTE by period
export const calculateLaborUtilization = (data) => {
  const { sales_forecast = [], products = [], router_operations = [], labor_rates = [] } = data;
  
  console.log('Labor calculation data:', {
    sales_forecast_count: sales_forecast.length,
    products_count: products.length,
    router_operations_count: router_operations.length,
    labor_rates_count: labor_rates.length
  });
  
  // Group forecasts by period
  const forecastsByPeriod = sales_forecast.reduce((acc, forecast) => {
    const period = forecast.period;
    if (!acc[period]) acc[period] = [];
    acc[period].push(forecast);
    return acc;
  }, {});
  
  // Calculate labor utilization for each period
  const laborUtilizationByPeriod = {};
  
  Object.keys(forecastsByPeriod).forEach(period => {
    const periodForecasts = forecastsByPeriod[period];
    const laborUsage = {};
    
    periodForecasts.forEach(forecast => {
      const product = products.find(p => p.unit_id === forecast.unit_id);
      if (product && product.router) {
        const productRouting = router_operations.filter(operation => operation.router_id === product.router);
        
        productRouting.forEach(operation => {
          const laborRate = labor_rates.find(rate => rate.rate_id === operation.labor_type_id);
          if (laborRate) {
            if (!laborUsage[laborRate.rate_id]) {
              laborUsage[laborRate.rate_id] = {
                labor_type_id: laborRate.rate_id,
                labor_type_name: laborRate.rate_name,
                labor_type: laborRate.rate_type,
                hourly_rate: laborRate.rate_amount,
                total_minutes_required: 0,
                total_hours_required: 0,
                total_cost: 0,
                fte_required: 0,
                products_involved: new Set()
              };
            }
            
            const minutesNeeded = operation.labor_minutes * forecast.quantity;
            laborUsage[laborRate.rate_id].total_minutes_required += minutesNeeded;
            laborUsage[laborRate.rate_id].total_hours_required += minutesNeeded / 60;
            laborUsage[laborRate.rate_id].total_cost += (minutesNeeded / 60) * laborRate.rate_amount;
            laborUsage[laborRate.rate_id].products_involved.add(product.unit_name);
          }
        });
      }
    });
    
    // Calculate FTE for this period (assuming 173.33 hours per month)
    const monthlyWorkingHours = 173.33;
    Object.keys(laborUsage).forEach(laborId => {
      const labor = laborUsage[laborId];
      labor.fte_required = labor.total_hours_required / monthlyWorkingHours;
      labor.products_involved = Array.from(labor.products_involved);
    });
    
    laborUtilizationByPeriod[period] = Object.values(laborUsage);
  });
  
  console.log('Labor utilization by period:', laborUtilizationByPeriod);
  return laborUtilizationByPeriod;
};

// Get BOM details for a product
export const getBOMDetails = (data, bomId) => {
  const { bom = [] } = data;
  return bom.filter(bomItem => bomItem.bom_id === bomId);
};

// Get routing details for a product
export const getRoutingDetails = (data, routerId) => {
  const { router_operations = [], machines = [], labor_rates = [] } = data;
  
  const routingOperations = router_operations.filter(operation => operation.router_id === routerId);
  
  return routingOperations.map(operation => {
    const machine = machines.find(m => m.machine_id === operation.machine_id);
    const laborRate = labor_rates.find(rate => rate.rate_id === operation.labor_type_id);
    
    return {
      ...operation,
      machine_name: machine ? machine.machine_name : 'Unknown Machine',
      machine_rate: machine ? machine.machine_rate : 0,
      rate_name: laborRate ? laborRate.rate_name : 'Unknown Labor Type',
      rate_amount: laborRate ? laborRate.rate_amount : 0
    };
  });
};