#!/usr/bin/env python3
"""
Convert Excel data to new CSV format and update database structure
"""

import pandas as pd
import os
from pathlib import Path

def convert_excel_to_csv():
    """Convert Excel data to new CSV format"""
    
    # Read the Excel file
    excel_file = 'data/updated_table.xlsx'
    data_dir = Path('data')
    
    # Read all sheets
    excel_data = pd.read_excel(excel_file, sheet_name=None)
    
    # Convert each sheet to CSV
    for sheet_name, df in excel_data.items():
        if sheet_name == 'work_centers':
            csv_filename = 'machines.csv'
            df_mapped = df.rename(columns={
                'work_center_id': 'machine_id',
                'machine_name': 'machine_name',
                'machine_description': 'machine_description',
                'machine_rate_per_hour': 'machine_rate',
                'note': 'labor_type'
            })
            df_mapped = df_mapped[['machine_id', 'machine_name', 'machine_description', 'machine_rate', 'labor_type']]
        elif sheet_name == 'router':
            csv_filename = 'routers.csv'
            df_mapped = df.rename(columns={
                'router_id': 'router_id',
                'operation_description': 'operation_description',
                'work_center_id': 'machine_id',
                'work_center_minutes': 'machine_minutes',
                'labor_touch_minutes': 'labor_minutes',
                'sequence': 'sequence',
                'labor_type': 'labor_type'
            })
            df_mapped['unit_id'] = 'PROD-001'
            df_mapped = df_mapped[['router_id', 'unit_id', 'machine_id', 'machine_minutes', 'labor_minutes', 'sequence']]
        elif sheet_name == 'labor_rates':
            csv_filename = 'labor_rates.csv'
            df_mapped = df.rename(columns={
                'rate_id': 'rate_id',
                'rate_name': 'rate_name',
                'rate_description': 'rate_description',
                'rate_amount_hourly': 'rate_amount'
            })
            df_mapped['rate_type'] = 'Hourly'
            df_mapped = df_mapped[['rate_id', 'rate_name', 'rate_description', 'rate_amount', 'rate_type']]
        elif sheet_name == 'sales':
            csv_filename = 'sales.csv'
            # Map to new structure with forecast_id
            df_mapped = df[['sale_id', 'customer_id', 'unit_id', 'period', 'quantity', 'unit_price', 'total_revenue', 'forecast_id']]
        elif sheet_name == 'forecast':
            csv_filename = 'forecast.csv'
            df_mapped = df[['forecast_id', 'name', 'description']]
        else:
            csv_filename = f'{sheet_name}.csv'
            df_mapped = df
        
        csv_path = data_dir / csv_filename
        df_mapped.to_csv(csv_path, index=False)
        print(f"Converted {sheet_name} to {csv_filename}")
        print(f"  Shape: {df_mapped.shape}")
        print(f"  Columns: {list(df_mapped.columns)}")
        print()

def update_database_structure():
    """Update database structure to match new CSV format"""
    
    from app.db.database import DatabaseManager
    db_manager = DatabaseManager()
    conn = db_manager.get_connection()
    cursor = conn.cursor()
    
    tables_to_drop = ['customers', 'units', 'sales', 'bom', 'routers', 'machines', 'labor_rates', 'payroll', 'forecast']
    for table in tables_to_drop:
        cursor.execute(f"DROP TABLE IF EXISTS {table}")
    
    # Customers
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS customers (
            customer_id TEXT PRIMARY KEY,
            customer_name TEXT NOT NULL,
            customer_type TEXT,
            region TEXT
        )
    ''')
    # Units
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS units (
            unit_id TEXT PRIMARY KEY,
            unit_name TEXT NOT NULL,
            unit_description TEXT,
            base_price REAL,
            unit_type TEXT,
            bom TEXT,
            router TEXT
        )
    ''')
    # Forecast table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS forecast (
            forecast_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT
        )
    ''')
    # Sales (with forecast_id FK)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sales (
            sale_id TEXT PRIMARY KEY,
            customer_id TEXT,
            unit_id TEXT,
            period TEXT,
            quantity INTEGER,
            unit_price REAL,
            total_revenue REAL,
            forecast_id TEXT,
            FOREIGN KEY (customer_id) REFERENCES customers (customer_id),
            FOREIGN KEY (unit_id) REFERENCES units (unit_id),
            FOREIGN KEY (forecast_id) REFERENCES forecast (forecast_id)
        )
    ''')
    # BOM
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS bom (
            bom_id TEXT,
            bom_line INTEGER,
            material_description TEXT,
            qty REAL,
            unit TEXT,
            unit_price REAL,
            material_cost REAL,
            target_cost REAL,
            PRIMARY KEY (bom_id, bom_line)
        )
    ''')
    # Routers
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS routers (
            router_id TEXT,
            unit_id TEXT,
            machine_id TEXT,
            machine_minutes REAL,
            labor_minutes REAL,
            sequence INTEGER,
            PRIMARY KEY (router_id, sequence),
            FOREIGN KEY (unit_id) REFERENCES units (unit_id),
            FOREIGN KEY (machine_id) REFERENCES machines (machine_id)
        )
    ''')
    # Machines
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS machines (
            machine_id TEXT PRIMARY KEY,
            machine_name TEXT NOT NULL,
            machine_description TEXT,
            machine_rate REAL,
            labor_type TEXT
        )
    ''')
    # Labor rates
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS labor_rates (
            rate_id TEXT PRIMARY KEY,
            rate_name TEXT NOT NULL,
            rate_description TEXT,
            rate_amount REAL,
            rate_type TEXT
        )
    ''')
    # Payroll
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS payroll (
            employee_id TEXT PRIMARY KEY,
            employee_name TEXT NOT NULL,
            weekly_hours INTEGER,
            hourly_rate REAL,
            labor_type TEXT,
            start_date TEXT,
            end_date TEXT
        )
    ''')
    conn.commit()
    conn.close()
    print("Database structure updated successfully")

def load_new_csv_data():
    """Load the new CSV data into the database"""
    from app.db.database import DatabaseManager
    db_manager = DatabaseManager()
    db_manager.load_csv_data()
    print("New CSV data loaded successfully")

if __name__ == "__main__":
    print("Converting Excel data to CSV format...")
    convert_excel_to_csv()
    print("\nUpdating database structure...")
    update_database_structure()
    print("\nLoading new CSV data...")
    load_new_csv_data()
    print("\nConversion complete!") 