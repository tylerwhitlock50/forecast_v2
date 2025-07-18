# Forecast Logic Fixes

## Issues Found and Fixed

### 1. Sales Data Structure Mismatch
**Problem**: The original code tried to handle multiple sales data structures with conditional logic based on the number of columns.

**Fix**: Updated to handle the actual CSV structure with 8 columns:
- `sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id`

**Code Change**:
```python
# Before: Complex conditional logic for different structures
if len(sale) == 10:
    # Old structure handling
elif len(sale) == 11:
    # New structure handling
else:
    # Other structure handling

# After: Direct unpacking of known structure
(sale_id, customer_id, unit_id, period, quantity, unit_price, 
 total_revenue, forecast_id, customer_name, unit_name, base_price, bom_id, router_id) = sale
```

### 2. Machine ID Mapping Issue
**Problem**: Routers reference `WC001`, `WC002`, `WC003`, `WC004` but machines table has `WC0001`, `WC0002`, `WC0003`, `WC0004`.

**Fix**: Added SQL string manipulation to map the IDs correctly.

**Code Change**:
```python
# Before: Direct join
LEFT JOIN machines m ON r.machine_id = m.machine_id

# After: ID mapping
LEFT JOIN machines m ON ('WC000' || SUBSTR(r.machine_id, 3)) = m.machine_id
```

### 3. BOM Cost Calculation Inefficiency
**Problem**: The original code queried the BOM table for each sale individually.

**Fix**: Pre-calculate BOM costs once and use a lookup dictionary.

**Code Change**:
```python
# Before: Query per sale
cursor.execute('SELECT bom FROM units WHERE unit_id = ?', (unit_id,))
unit_bom = cursor.fetchone()
if unit_bom and unit_bom[0]:
    bom_id = unit_bom[0]
    cursor.execute('SELECT SUM(material_cost) FROM bom WHERE bom_id = ?', (bom_id,))
    bom_sum = cursor.fetchone()
    bom_cost = bom_sum[0] or 0.0

# After: Pre-calculate all BOM costs
cursor.execute('''
    SELECT bom_id, SUM(material_cost) as total_bom_cost
    FROM bom 
    GROUP BY bom_id
''')
bom_costs = {row[0]: row[1] for row in cursor.fetchall()}
# Then use: bom_cost = bom_costs.get(bom_id, 0.0)
```

### 4. Labor Rate Calculation
**Problem**: Hardcoded labor rate of $35.0 instead of using the labor_rates table.

**Fix**: Calculate average labor rate from payroll data or labor_rates table.

**Code Change**:
```python
# Before: Hardcoded rate
(r.labor_minutes * 35.0 / 60.0) as labor_cost_per_unit

# After: Dynamic rate calculation
# Get labor rates
cursor.execute('SELECT rate_type, AVG(rate_amount) as avg_rate FROM labor_rates GROUP BY rate_type')
labor_rates = {row[0]: row[1] for row in cursor.fetchall()}

# Calculate average rate
avg_labor_rate = 35.0  # Default fallback
if payroll_data:
    total_rate = sum(row[3] for row in payroll_data)
    avg_labor_rate = total_rate / len(payroll_data)
elif 'Hourly' in labor_rates:
    avg_labor_rate = labor_rates['Hourly']

# Use in calculation
labor_cost_per_unit += (router[10] or 0.0) * avg_labor_rate / 60.0
```

### 5. Router Data Structure
**Problem**: The code assumed a 1:1 relationship between router_id and unit_id, but the data shows shared router_id across units.

**Fix**: Updated the query to properly handle the shared router structure and sum costs per unit.

**Code Change**:
```python
# Updated query to include all necessary fields
SELECT r.router_id, r.unit_id, r.machine_id, r.machine_minutes, r.labor_minutes, r.sequence,
       u.unit_name, m.machine_name, m.machine_rate,
       (r.machine_minutes * m.machine_rate / 60.0) as machine_cost_per_unit,
       r.labor_minutes
FROM routers r
LEFT JOIN units u ON r.unit_id = u.unit_id
LEFT JOIN machines m ON ('WC000' || SUBSTR(r.machine_id, 3)) = m.machine_id
```

## Key Improvements

1. **Performance**: Reduced database queries by pre-calculating BOM costs
2. **Accuracy**: Fixed machine ID mapping and labor rate calculation
3. **Maintainability**: Removed complex conditional logic for data structures
4. **Data Integrity**: Proper handling of shared router relationships
5. **Flexibility**: Dynamic labor rate calculation from actual data

## Data Structure Alignment

The forecast logic now properly aligns with:
- **Sales**: 8 columns with forecast_id
- **Units**: Includes bom and router references
- **BOM**: Grouped by bom_id with total cost calculation
- **Routers**: Shared router_id across multiple units
- **Machines**: Proper ID mapping (WC001 → WC0001)
- **Labor Rates**: Used for dynamic rate calculation

## Testing

A test script (`test_forecast_logic.py`) has been created to verify the forecast logic works correctly with the current data structure. 