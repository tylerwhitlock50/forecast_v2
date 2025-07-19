# Expense Management - Accounting Structure Documentation

## Overview

This document outlines the accounting structure and chart of accounts for the expense management module. The system is designed to support manufacturing operations with proper categorization of factory overhead, administrative expenses, and cost of goods sold (COGS) components.

## Chart of Accounts Structure

### Account Number Ranges

| Account Range | Category Type | Description |
|---------------|---------------|-------------|
| 5000-5999 | Cost of Goods Sold (COGS) | Direct costs of manufacturing |
| 6000-6999 | Factory Overhead | Indirect manufacturing costs |
| 7000-7999 | Administrative Expenses | General business operating expenses |
| 8000-8999 | Administrative Overhead | Office and administrative facility costs |

## Detailed Account Categories

### Cost of Goods Sold (COGS) - 5000-5999

These are direct costs that can be directly attributed to the production of goods.

| Account Code | Category Name | Description | Examples |
|--------------|---------------|-------------|----------|
| 5100 | Raw Materials | Direct materials used in production | Steel, aluminum, fasteners, components |
| 5200 | Subcontractor Services | Outsourced manufacturing services | Heat treating, plating, machining services |
| 5300 | Direct Labor | Labor directly involved in production | Machine operators, welders, assemblers |
| 5400 | Freight In | Incoming freight and shipping costs | Delivery charges for raw materials |

### Factory Overhead - 6000-6999

These are indirect manufacturing costs that support production but cannot be directly attributed to specific products.

| Account Code | Category Name | Description | Examples |
|--------------|---------------|-------------|----------|
| 6100 | Floor Supplies | General manufacturing consumables | Shop rags, cleaning supplies, general tools |
| 6110 | Welding Supplies | Welding consumables and supplies | Welding rods, electrodes, gas, wire |
| 6120 | Cutting Tools | Cutting and machining tools | Drill bits, end mills, saw blades, inserts |
| 6130 | Lubricants & Oils | Machine lubricants and fluids | Hydraulic oil, cutting fluid, grease |
| 6140 | Safety Equipment | Personal protective equipment | Hard hats, safety glasses, gloves, ear protection |
| 6200 | Equipment Maintenance | Machine repair and maintenance | Repair parts, maintenance contracts, service calls |
| 6300 | Utilities | Manufacturing facility utilities | Electricity, gas, water for production areas |
| 6400 | Facility Rent | Manufacturing facility rent/lease | Rent for production space, warehouse |
| 6500 | Insurance | Manufacturing facility insurance | Property, equipment, liability insurance |
| 6600 | Depreciation | Equipment and facility depreciation | Machine depreciation, building depreciation |
| 6700 | Quality Testing | Quality assurance expenses | Testing services, inspection equipment |
| 6800 | Shipping Supplies | Outbound packaging and shipping | Boxes, packing materials, labels |

### Administrative Expenses - 7000-7999

These are general business operating expenses not directly related to manufacturing.

| Account Code | Category Name | Description | Examples |
|--------------|---------------|-------------|----------|
| 7100 | Office Supplies | General office materials | Paper, pens, printer supplies, stationery |
| 7200 | Software Licenses | Business software subscriptions | CAD software, accounting software, ERP systems |
| 7300 | Communications | Phone and internet services | Phone bills, internet, mobile devices |
| 7400 | Travel & Entertainment | Business travel expenses | Travel, meals, lodging, client entertainment |
| 7500 | Legal & Professional | Professional services | Legal fees, accounting, consulting |
| 7600 | Marketing & Advertising | Sales and marketing expenses | Trade shows, advertising, promotional materials |
| 7700 | Training & Development | Employee development | Training courses, certifications, seminars |
| 7800 | Banking & Finance | Financial services | Bank fees, credit card fees, loan fees |
| 7900 | Taxes & Licenses | Business taxes and permits | Business licenses, permits, franchise taxes |

### Administrative Overhead - 8000-8999

These are administrative facility and overhead costs.

| Account Code | Category Name | Description | Examples |
|--------------|---------------|-------------|----------|
| 8100 | Office Rent | Administrative office rent | Office space rental, administrative facilities |
| 8200 | Office Insurance | Office-related insurance | General liability, office property insurance |

## Expense Classification Types

### Factory Overhead
- **Purpose**: Costs that support manufacturing operations but cannot be directly traced to specific products
- **Allocation**: Typically allocated to products using predetermined overhead rates
- **Examples**: Utilities for manufacturing, indirect labor, factory supplies
- **Impact**: Increases product costs and affects gross margin calculations

### Administrative Expenses
- **Purpose**: General business operating expenses not related to production
- **Allocation**: Period expenses, not allocated to products
- **Examples**: Office rent, administrative salaries, marketing
- **Impact**: Affects net income but not gross margin

### Cost of Goods Sold (COGS)
- **Purpose**: Direct costs attributable to production
- **Allocation**: Directly traced to specific products or jobs
- **Examples**: Raw materials, direct labor, subcontracting
- **Impact**: Directly affects gross margin and product profitability

## Expense Frequency Types

### Recurring Expenses

| Frequency | Description | Allocation Method | Example |
|-----------|-------------|-------------------|---------|
| Weekly | Every 7 days | Immediate or amortized | Temporary labor |
| Monthly | Every month | Immediate or amortized | Rent, utilities |
| Quarterly | Every 3 months | Immediate or amortized over 3 months | Insurance premiums |
| Biannually | Every 6 months | Immediate or amortized over 6 months | Equipment maintenance |
| Annually | Once per year | Immediate or amortized over 12 months | Software licenses |

### One-Time Expenses

| Type | Description | Allocation Method | Example |
|------|-------------|-------------------|---------|
| Capital Purchase | Equipment or asset purchase | Amortized over useful life | New machine purchase |
| Project Expense | One-time project costs | Immediate or amortized over project duration | Trade show booth |
| Emergency Repair | Unplanned maintenance | Immediate | Emergency equipment repair |

## Allocation Methods

### Immediate Allocation
- **When to Use**: When the expense benefit is consumed in the current period
- **Examples**: Monthly rent, utilities, supplies
- **Accounting Impact**: Full expense recognized in the payment period

### Amortized Allocation
- **When to Use**: When the expense provides benefits over multiple periods
- **Examples**: Annual insurance, software licenses, equipment purchases
- **Accounting Impact**: Expense spread evenly over the amortization period
- **Calculation**: Total Amount ÷ Amortization Months = Monthly Expense

## Cost Center Structure

### Manufacturing Cost Centers
- **MFGCOST**: General manufacturing costs
- **WELDCOST**: Welding department costs
- **MACHCOST**: Machining department costs
- **ASSMCOST**: Assembly department costs

### Administrative Cost Centers
- **ADMCOST**: General administrative costs
- **ENGCOST**: Engineering department costs
- **SLSCOST**: Sales and marketing costs
- **QACOST**: Quality assurance costs
- **SHPCOST**: Shipping and logistics costs

## Approval Workflow

### Approval Requirements

| Amount Range | Approval Required | Approver Level |
|--------------|-------------------|----------------|
| < $500 | No | Automatic |
| $500 - $2,000 | Yes | Department Manager |
| $2,000 - $10,000 | Yes | Operations Manager |
| > $10,000 | Yes | General Manager/Owner |

### Approval Process
1. **Expense Creation**: User creates expense with all required details
2. **Approval Routing**: System routes to appropriate approver based on amount
3. **Approval Decision**: Approver reviews and approves/rejects
4. **Allocation Generation**: Upon approval, system generates payment allocations
5. **Payment Processing**: Allocations become available for payment processing

## Payment Status Tracking

### Status Types
- **Pending**: Allocation created but payment not scheduled
- **Scheduled**: Payment scheduled for future date
- **Paid**: Payment completed and recorded
- **Overdue**: Payment past due date

### Payment Methods
- **ACH**: Electronic bank transfer
- **Check**: Paper check payment
- **Credit Card**: Credit card payment
- **Net30**: Payment terms with 30-day credit period

## Reporting and Analytics

### Key Reports
1. **Expense Summary by Category**: Total expenses by factory overhead, admin, and COGS
2. **Monthly Cash Flow Forecast**: Upcoming payments by month
3. **Department Cost Analysis**: Expenses by cost center
4. **Vendor Analysis**: Expenses by vendor
5. **Approval Status Report**: Pending and overdue approvals

### Key Metrics
- **Total Annual Factory Overhead**: Sum of all factory overhead expenses
- **Administrative Expense Ratio**: Admin expenses as % of revenue
- **Cash Flow Timing**: Monthly payment schedules and amounts
- **Category Distribution**: Percentage breakdown by expense category

## Integration with Financial Systems

### General Ledger Integration
- Expense allocations can be exported for general ledger entry
- Account codes align with standard chart of accounts
- Monthly summaries available for financial reporting

### Cost Accounting Integration
- Factory overhead costs feed into standard costing calculations
- Cost center allocation supports departmental budgeting
- Product costing includes allocated overhead expenses

### Cash Flow Management
- Payment schedules support cash flow forecasting
- Vendor payment timing aids in working capital management
- Seasonal expense patterns help with budget planning

## Future Enhancements

### Planned Features
1. **Budget vs. Actual Reporting**: Compare expenses to budgeted amounts
2. **Purchase Order Integration**: Link expenses to purchase orders
3. **Vendor Management**: Enhanced vendor tracking and performance metrics
4. **Automated Approvals**: Workflow automation for routine expenses
5. **Mobile Expense Entry**: Mobile app for field expense entry
6. **Integration APIs**: Connect with QuickBooks, NetSuite, and other ERP systems

### Advanced Analytics
1. **Expense Trending**: Historical analysis and forecasting
2. **Cost Optimization**: Identify cost reduction opportunities
3. **Vendor Performance**: Analyze vendor costs and reliability
4. **Department Benchmarking**: Compare costs across departments
5. **Seasonal Analysis**: Identify seasonal expense patterns

## Implementation Guidelines

### Data Migration
1. Export existing expense data from current system
2. Map to new category structure
3. Validate account codes and cost centers
4. Import historical data for trending analysis

### User Training
1. Category classification guidelines
2. Approval workflow procedures
3. Expense entry best practices
4. Reporting and analytics usage

### System Configuration
1. Set up approval limits and workflows
2. Configure cost centers and departments
3. Establish vendor master data
4. Define payment terms and methods

This documentation serves as the foundation for implementing a comprehensive expense management system that supports manufacturing operations while providing detailed financial tracking and reporting capabilities.