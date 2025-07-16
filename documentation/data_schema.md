# 📊 Data Schema Documentation

## Overview
This document describes the normalized database schema for the Forecast Model + AI Assistant system. The data structure follows relational database principles to ensure data consistency and eliminate redundancy.

## 🗂️ Database Tables

### 1. Customers (`customers`)
Stores customer information for sales tracking.

| Column | Type | Description |
|--------|------|-------------|
| `customer_id` | TEXT (PK) | Unique customer identifier |
| `customer_name` | TEXT | Customer company name |
| `customer_type` | TEXT | Type of customer (D2C-WEB, ONLINE-DEALER, DEALER, D2C-AMAZON) |
| `region` | TEXT | Geographic region |

### 2. Units (`units`)
Stores product/unit information for manufacturing.

| Column | Type | Description |
|--------|------|-------------|
| `unit_id` | TEXT (PK) | Unique unit identifier |
| `unit_name` | TEXT | Product name |
| `unit_description` | TEXT | Detailed product description |
| `base_price` | REAL | Standard unit price |
| `unit_type` | TEXT | Product category (each, assembly, etc.) |
| `bom` | TEXT | BOM identifier for this unit |
| `router` | TEXT | Router identifier for this unit |

### 3. Sales (`sales`)
Tracks sales transactions with customer and unit relationships.

| Column | Type | Description |
|--------|------|-------------|
| `sale_id` | TEXT (PK) | Unique sale identifier |
| `customer_id` | TEXT (FK) | Reference to customers table |
| `unit_id` | TEXT (FK) | Reference to units table |
| `period` | TEXT | Sales period (YYYY-MM-DD) |
| `quantity` | INTEGER | Number of units sold |
| `unit_price` | REAL | Actual sale price per unit |
| `total_revenue` | REAL | Total revenue for this sale |
| `forecast_id_scenario` | TEXT | Forecast scenario identifier |
| `forecast_source` | TEXT | Source of the forecast data |

### 4. BOM (`bom`)
Bill of Materials - detailed material components.

| Column | Type | Description |
|--------|------|-------------|
| `bom_id` | TEXT | BOM identifier |
| `bom_line` | INTEGER | Line number in BOM |
| `material_description` | TEXT | Description of material |
| `qty` | REAL | Quantity required |
| `unit` | TEXT | Unit of measure |
| `unit_price` | REAL | Price per unit |
| `material_cost` | REAL | Total cost for this line |
| `target_cost` | REAL | Target cost for this material |

### 5. Routers (`routers`)
Manufacturing routing information - defines the production steps.

| Column | Type | Description |
|--------|------|-------------|
| `router_id` | TEXT | Router identifier |
| `unit_id` | TEXT (FK) | Reference to units table |
| `machine_id` | TEXT (FK) | Reference to machines table |
| `machine_minutes` | REAL | Machine time required in minutes |
| `labor_minutes` | REAL | Labor time required in minutes |
| `sequence` | INTEGER | Production step sequence |

### 6. Machines (`machines`)
Manufacturing equipment and their rates (renamed from work_centers).

| Column | Type | Description |
|--------|------|-------------|
| `machine_id` | TEXT (PK) | Unique machine identifier |
| `machine_name` | TEXT | Machine name |
| `machine_description` | TEXT | Detailed machine description |
| `machine_rate` | REAL | Hourly machine rate |
| `labor_type` | TEXT | Type of labor required |

### 7. Labor Rates (`labor_rates`)
Standard labor rates by type.

| Column | Type | Description |
|--------|------|-------------|
| `rate_id` | TEXT (PK) | Unique rate identifier |
| `rate_name` | TEXT | Rate name |
| `rate_description` | TEXT | Detailed rate description |
| `rate_amount` | REAL | Hourly rate amount |
| `rate_type` | TEXT | Rate type (Hourly, etc.) |

### 8. Payroll (`payroll`)
Employee information and costs.

| Column | Type | Description |
|--------|------|-------------|
| `employee_id` | TEXT (PK) | Unique employee identifier |
| `employee_name` | TEXT | Employee name |
| `weekly_hours` | INTEGER | Standard weekly hours |
| `hourly_rate` | REAL | Employee hourly rate |
| `labor_type` | TEXT | Type of labor performed |
| `start_date` | TEXT | Employment start date |
| `end_date` | TEXT | Employment end date |

## 🔗 Relationships

### Primary Relationships
1. **Sales → Customers**: Many sales can belong to one customer
2. **Sales → Units**: Many sales can be for one unit
3. **Units → BOM**: Units reference BOM by bom_id
4. **Units → Routers**: Units reference routers by router_id
5. **Routers → Units**: Many router steps per unit
6. **Routers → Machines**: Many router steps can use one machine
7. **Payroll → Labor Rates**: Employees are linked to labor types

### Data Flow
```
Customers → Sales ← Units → BOM (by bom_id)
                    ↓
                  Routers → Machines
                    ↓
              Labor Rates ← Payroll
```

## 📈 Forecasting Calculations

### Cost Calculation Flow
1. **Material Cost**: Sum of all BOM line costs for the unit's BOM
2. **Machine Cost**: Router minutes × Machine rate
3. **Labor Cost**: Router minutes × Labor rate
4. **Total Unit Cost**: Material + Machine + Labor
5. **Gross Margin**: Sale price - Total unit cost

### Example Calculation
For unit PROD-001:
- Material cost: Sum of all BOM lines for BOM-001
- Machine cost: (30 min × $150/hr) / 60 = $75.00
- Labor cost: (15 min × $35/hr) / 60 = $8.75
- Total cost: Material + $75.00 + $8.75
- Sale price: $185.00
- **Gross margin: $185.00 - Total cost**

## 🔧 Data Consistency Rules

1. **Foreign Keys**: All relationships are enforced through foreign keys
2. **ID Format**: Consistent ID formats (CUST-001, PROD-001, etc.)
3. **Rate Types**: Labor types must match between machines and payroll
4. **Sequence Numbers**: Router sequences must be sequential per unit
5. **Date Formats**: All dates in YYYY-MM-DD format
6. **BOM Structure**: BOM lines are identified by (bom_id, bom_line) composite key

## 📊 Sample Queries

### Get Sales with Customer and Unit Info
```sql
SELECT s.*, c.customer_name, u.unit_name, u.base_price
FROM sales s
LEFT JOIN customers c ON s.customer_id = c.customer_id
LEFT JOIN units u ON s.unit_id = u.unit_id
ORDER BY s.period, s.customer_id;
```

### Get Complete Manufacturing Cost
```sql
SELECT 
    u.unit_id,
    u.unit_name,
    u.bom,
    u.router,
    (SELECT SUM(material_cost) FROM bom WHERE bom_id = u.bom) as material_cost,
    SUM(r.machine_minutes * m.machine_rate / 60) as machine_cost,
    SUM(r.labor_minutes * lr.rate_amount / 60) as labor_cost
FROM units u
LEFT JOIN routers r ON u.unit_id = r.unit_id
LEFT JOIN machines m ON r.machine_id = m.machine_id
LEFT JOIN labor_rates lr ON m.labor_type = lr.rate_name
GROUP BY u.unit_id, u.unit_name, u.bom, u.router;
```

### Get BOM Details for a Unit
```sql
SELECT b.*
FROM bom b
JOIN units u ON b.bom_id = u.bom
WHERE u.unit_id = 'PROD-001'
ORDER BY b.bom_line;
``` 