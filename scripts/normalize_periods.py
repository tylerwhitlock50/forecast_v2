"""
Script to normalize all periods in the sales table to standard format.
Converts YYYY-MM-DD to YYYY-MM, YYYY-WXX-DD to YYYY-WXX, etc.
"""
import sys
import os

# Add parent directory to path to import app modules
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.db.database import db_manager
from app.utils.period_normalizer import normalize_period


def normalize_all_periods():
    """Normalize all periods in the sales table."""
    conn = db_manager.get_connection()
    cursor = conn.cursor()
    
    try:
        # Get all sales with their periods
        cursor.execute("SELECT sale_id, period FROM sales")
        all_sales = cursor.fetchall()
        
        updated_count = 0
        skipped_count = 0
        error_count = 0
        
        for sale_id, period in all_sales:
            if not period:
                skipped_count += 1
                continue
            
            # Normalize the period
            normalized = normalize_period(str(period))
            
            if normalized and normalized != period:
                # Update the period in the database
                cursor.execute("""
                    UPDATE sales 
                    SET period = ? 
                    WHERE sale_id = ?
                """, (normalized, sale_id))
                updated_count += 1
                print(f"Updated {sale_id}: {period} -> {normalized}")
            elif normalized:
                # Already normalized
                skipped_count += 1
            else:
                # Invalid period format
                error_count += 1
                print(f"ERROR: Invalid period format for {sale_id}: {period}")
        
        conn.commit()
        
        print(f"\nSummary:")
        print(f"  Updated: {updated_count}")
        print(f"  Already normalized: {skipped_count}")
        print(f"  Errors: {error_count}")
        print(f"  Total: {len(all_sales)}")
        
    except Exception as e:
        conn.rollback()
        print(f"Error: {e}")
        raise
    finally:
        db_manager.close_connection(conn)


if __name__ == "__main__":
    print("Normalizing periods in sales table...")
    normalize_all_periods()
    print("Done!")


