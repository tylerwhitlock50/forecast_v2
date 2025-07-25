#!/usr/bin/env python3
"""
Script to update the machines table schema to include available_minutes_per_month column
"""

import sqlite3
import os

def update_machine_schema():
    """Update the machines table to include available_minutes_per_month column"""
    
    # Database path
    db_path = os.path.join('data', 'forecast.db')
    
    if not os.path.exists(db_path):
        print(f"Database not found at {db_path}")
        return
    
    try:
        # Connect to database
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Check if the column already exists
        cursor.execute("PRAGMA table_info(machines)")
        columns = [col[1] for col in cursor.fetchall()]
        
        if 'available_minutes_per_month' not in columns:
            print("Adding available_minutes_per_month column to machines table...")
            
            # Add the new column
            cursor.execute("""
                ALTER TABLE machines 
                ADD COLUMN available_minutes_per_month REAL
            """)
            
            # Update existing records with default values from CSV
            cursor.execute("SELECT machine_id FROM machines")
            machine_ids = [row[0] for row in cursor.fetchall()]
            
            # Default values based on the CSV data
            default_capacity = {
                'WC0001': 12000,  # Press Area
                'WC0002': 15000,  # Assembly Area
                'WC0003': 8000,   # Shipping Area
                'WC0004': 10000   # Trim/Clean
            }
            
            for machine_id in machine_ids:
                capacity = default_capacity.get(machine_id, 12000)  # Default to 12000 if not found
                cursor.execute("""
                    UPDATE machines 
                    SET available_minutes_per_month = ? 
                    WHERE machine_id = ?
                """, (capacity, machine_id))
            
            conn.commit()
            print("Successfully added available_minutes_per_month column and updated existing records")
        else:
            print("Column available_minutes_per_month already exists")
        
        # Verify the update
        cursor.execute("PRAGMA table_info(machines)")
        columns = cursor.fetchall()
        print("\nCurrent machines table schema:")
        for col in columns:
            print(f"  {col[1]} ({col[2]})")
        
        # Show sample data
        cursor.execute("SELECT machine_id, machine_name, available_minutes_per_month FROM machines LIMIT 5")
        rows = cursor.fetchall()
        print("\nSample machine data:")
        for row in rows:
            print(f"  {row[0]}: {row[1]} - {row[2]} min/month")
        
        conn.close()
        
    except Exception as e:
        print(f"Error updating database: {e}")
        if conn:
            conn.rollback()
            conn.close()

if __name__ == "__main__":
    update_machine_schema() 