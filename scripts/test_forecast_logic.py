#!/usr/bin/env python3
"""
Test script to verify the forecast logic works with current data structure
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'app'))

from db.database import DatabaseManager

def test_forecast_logic():
    """Test the forecast logic with current data"""
    print("Testing forecast logic...")
    
    # Initialize database
    db_manager = DatabaseManager()
    db_manager.initialize()
    
    # Test the forecast data generation
    result = db_manager.get_forecast_data()
    
    if result["status"] == "success":
        print("✅ Forecast logic test PASSED")
        print(f"Generated {len(result['data']['forecast_results'])} forecast records")
        print(f"Average labor rate used: ${result['data']['avg_labor_rate']:.2f}")
        
        # Show some sample results
        if result['data']['forecast_results']:
            sample = result['data']['forecast_results'][0]
            print(f"\nSample forecast result:")
            print(f"  Period: {sample['period']}")
            print(f"  Customer: {sample['customer_name']}")
            print(f"  Unit: {sample['unit_name']}")
            print(f"  Quantity: {sample['quantity']}")
            print(f"  Revenue: ${sample['total_revenue']:.2f}")
            print(f"  Material Cost: ${sample['material_cost']:.2f}")
            print(f"  Labor Cost: ${sample['labor_cost']:.2f}")
            print(f"  Machine Cost: ${sample['machine_cost']:.2f}")
            print(f"  Total Cost: ${sample['total_cost']:.2f}")
            print(f"  Gross Margin: ${sample['gross_margin']:.2f}")
            print(f"  Margin %: {sample['margin_percentage']:.1f}%")
        
        # Show BOM costs
        print(f"\nBOM Costs:")
        for bom_id, cost in result['data']['bom_costs'].items():
            print(f"  {bom_id}: ${cost:.2f}")
        
        # Show labor rates
        print(f"\nLabor Rates:")
        for rate_type, rate in result['data']['labor_rates'].items():
            print(f"  {rate_type}: ${rate:.2f}")
            
    else:
        print("❌ Forecast logic test FAILED")
        print(f"Error: {result['error']}")
        return False
    
    return True

if __name__ == "__main__":
    test_forecast_logic() 