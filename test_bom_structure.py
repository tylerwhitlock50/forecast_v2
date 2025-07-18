#!/usr/bin/env python3
"""
Test script to verify the new BOM structure
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'app'))

from db.database import DatabaseManager

def test_bom_structure():
    """Test the new BOM structure"""
    print("Testing new BOM structure...")
    
    # Initialize database
    db_manager = DatabaseManager()
    db_manager.initialize()
    
    # Test getting all data
    all_data = db_manager.get_all_data()
    
    print(f"BOM Definitions: {len(all_data.get('bom_definitions', []))}")
    print(f"BOM Lines: {len(all_data.get('bom_lines', []))}")
    print(f"Combined BOM: {len(all_data.get('bom', []))}")
    
    # Test BOM definition creation
    test_bom_def = {
        'bom_id': 'BOM-TEST-001',
        'bom_name': 'Test BOM',
        'bom_description': 'Test BOM for verification',
        'version': '1.0'
    }
    
    success = db_manager.create_bom_definition(test_bom_def)
    print(f"BOM Definition creation: {'SUCCESS' if success else 'FAILED'}")
    
    # Test BOM line creation
    test_bom_line = {
        'bom_id': 'BOM-TEST-001',
        'version': '1.0',
        'bom_line': 1,
        'material_description': 'Test Material',
        'qty': 1.0,
        'unit': 'each',
        'unit_price': 10.0,
        'material_cost': 10.0,
        'target_cost': 9.0
    }
    
    success = db_manager.create_bom_line(test_bom_line)
    print(f"BOM Line creation: {'SUCCESS' if success else 'FAILED'}")
    
    # Get updated data
    all_data = db_manager.get_all_data()
    print(f"After creation - BOM Definitions: {len(all_data.get('bom_definitions', []))}")
    print(f"After creation - BOM Lines: {len(all_data.get('bom_lines', []))}")
    print(f"After creation - Combined BOM: {len(all_data.get('bom', []))}")
    
    # Test deletion
    success = db_manager.delete_bom_definition('BOM-TEST-001', '1.0')
    print(f"BOM Definition deletion: {'SUCCESS' if success else 'FAILED'}")
    
    # Get final data
    all_data = db_manager.get_all_data()
    print(f"After deletion - BOM Definitions: {len(all_data.get('bom_definitions', []))}")
    print(f"After deletion - BOM Lines: {len(all_data.get('bom_lines', []))}")
    
    print("BOM structure test completed!")

if __name__ == "__main__":
    test_bom_structure() 