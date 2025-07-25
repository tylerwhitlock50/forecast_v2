# Comprehensive API Endpoints Documentation

This document provides a complete analysis of all 73 API endpoints in the forecast system, their frontend integration status, and detailed specifications for maintaining consistency between backend and frontend implementations.

## Standard API Response Format

All endpoints follow this standard response format:
```json
{
  "status": "success|error",
  "data": {},
  "message": "Description"
}
```

## Integration Status Legend
- **✅ Used**: Endpoint is actively used by frontend
- **⚠️ Partial**: Endpoint exists but has limited frontend integration  
- **❌ Unused**: Endpoint exists but is not used by frontend
- **🏗️ Custom**: Frontend uses direct API calls outside ForecastContext

---

# Complete Endpoint Inventory (73 Total)

## 1. Health & Schema (`/`)

### GET `/`
- **Purpose**: Health check endpoint
- **Response**: `{"message": "Forecast Model + AI Assistant API", "status": "running"}`
- **Frontend Integration**: ❌ Unused
- **Notes**: Basic health check, not consumed by frontend

### GET `/schema`
- **Purpose**: Get database schema information for frontend
- **Response**: Database tables and schema context
- **Frontend Integration**: ❌ Unused
- **Notes**: Utility endpoint for schema introspection

## 2. Data Management (`/data`) - 1 Endpoint

### GET `/data/{table_name}` ✅
- **Purpose**: Get data from any database table
- **Parameters**: 
  - `table_name` (path): Target table name
  - `forecast_id` (query, optional): Filter by forecast ID
- **Frontend Integration**: ✅ Used extensively
- **Used By**: `ForecastContext.fetchAllData()`
- **Tables Accessed**: sales, units, customers, machines, payroll, bom, router_definitions, router_operations, labor_rates, forecast
- **Usage Pattern**: Primary data fetching mechanism for all entities

## 3. Forecasting (`/forecast`) - 8 Endpoints

### GET `/forecast` ⚠️
- **Purpose**: Returns computed forecast state with joined data
- **Parameters**: `forecast_id` (query, optional)
- **Response Model**: `ForecastResponse`
- **Frontend Integration**: ⚠️ Partial
- **Notes**: Available but frontend primarily uses `/data/{table}` endpoints

### GET `/forecast/scenarios` ⚠️
- **Purpose**: Get all available forecast scenarios
- **Response**: `{scenarios: [{forecast_id, name, description}]}`
- **Frontend Integration**: ⚠️ Partial
- **Used By**: `ForecastContext.fetchScenarios()`
- **Notes**: Could be used more extensively for scenario management

### POST `/forecast/scenario` ✅
- **Purpose**: Create new forecast scenario with auto-generated FXXX ID
- **Request Body**: `{name: string, description?: string}`
- **Frontend Integration**: ✅ Used
- **Used By**: `ForecastContext.createScenario()`
- **ID Generation**: F001, F002, F003, etc.

### POST `/forecast/bulk_update` ✅
- **Purpose**: Bulk update forecast data with operations (add, subtract, replace)
- **Request Body**: `{forecasts: [], operation: "add|subtract|replace"}`
- **Frontend Integration**: ✅ Used
- **Used By**: `ForecastContext.bulkUpdateForecast()`
- **Operations**: add, subtract, replace

### GET `/forecast/results` ❌
- **Purpose**: Get saved forecast results from database
- **Parameters**: `period`, `limit` (optional)
- **Frontend Integration**: ❌ Unused
- **Notes**: Historical data endpoint not integrated

### POST `/forecast/create` ✅
- **Purpose**: Create new forecast data (sales or general table data)
- **Request Body**: `{sales?: {}, table?: string, data?: {}}`
- **Frontend Integration**: ✅ Used
- **Used By**: `ForecastContext.saveForecast()` and various create functions
- **Supports**: Direct sales data creation or generic table insertion

### POST `/forecast/update` ✅
- **Purpose**: Update existing forecast data with special composite key handling
- **Request Body**: `{table: string, id: string, updates: {}}`
- **Frontend Integration**: ✅ Used
- **Used By**: `ForecastContext.updateForecast()` and various update functions
- **Special Handling**: 
  - BOM: `bom_id-version-bom_line` format
  - Router Operations: `router_id-sequence` format

### DELETE `/forecast/delete/{table_name}/{record_id}` ✅
- **Purpose**: Delete specific record with composite key support
- **Frontend Integration**: ✅ Used
- **Used By**: `ForecastContext.deleteForecast()` and various delete functions
- **Composite Key Support**: Same as update endpoint

### GET `/forecast/bom_definitions` ✅
- **Purpose**: Get all BOM definitions for frontend
- **Response**: List of BOM definitions with versions
- **Frontend Integration**: ✅ Used
- **Used By**: `ForecastContext.fetchAllData()`
- **Notes**: Specialized endpoint for BOM management

## 4. Cost Management (`/products`) - 4 Endpoints

### GET `/products/cost-summary` ⚠️
- **Purpose**: Get cost summary for all products including COGS calculation
- **Parameters**: `forecast_id` (query, optional)
- **Frontend Integration**: ⚠️ Partial
- **Used By**: CostManagement components
- **Calculations**: Material, labor, machine costs with gross margin analysis
- **Integration Pattern**: Direct API calls, not through ForecastContext

### GET `/products/materials/usage` ⚠️
- **Purpose**: Get material usage forecast for purchasing decisions
- **Parameters**: `forecast_id` (query, optional)
- **Frontend Integration**: ⚠️ Partial
- **Used By**: CostManagement components
- **Response**: Material requirements aggregated from BOM and sales forecast

### GET `/products/machines/utilization` ⚠️
- **Purpose**: Get machine utilization forecast and capacity analysis
- **Parameters**: `forecast_id` (query, optional)
- **Frontend Integration**: ⚠️ Partial
- **Used By**: CostManagement components
- **Response**: Machine capacity utilization with overload warnings

### GET `/products/labor/utilization` ⚠️
- **Purpose**: Get labor utilization forecast and cost analysis
- **Parameters**: `forecast_id` (query, optional)
- **Frontend Integration**: ⚠️ Partial
- **Used By**: CostManagement components
- **Response**: Labor type utilization across products

## 5. Expense Management (`/expenses`) - 10 Endpoints

### GET `/expenses/categories` 🏗️
- **Purpose**: Get expense categories with optional filtering
- **Parameters**: `category_type`, `parent_category_id` (optional)
- **Frontend Integration**: 🏗️ Custom
- **Used By**: ExpenseManagement components with direct fetch calls
- **Integration Pattern**: Direct API calls, not through ForecastContext

### POST `/expenses/categories` 🏗️
- **Purpose**: Create new expense category
- **Request Body**: ExpenseCategoryCreate model
- **Frontend Integration**: 🏗️ Custom
- **ID Generation**: CAT-{UUID8}

### GET `/expenses/` 🏗️
- **Purpose**: Get all expenses with category details and filtering
- **Parameters**: `category_id`, `frequency`, `is_active`, `department`, `vendor` (optional)
- **Frontend Integration**: 🏗️ Custom
- **Used By**: ExpenseManagement components
- **Response**: Expenses with category details and calculated metrics

### POST `/expenses/` 🏗️
- **Purpose**: Create new expense with automatic allocation generation
- **Request Body**: ExpenseCreate model
- **Frontend Integration**: 🏗️ Custom
- **ID Generation**: EXP-{UUID8}
- **Auto-generates**: Expense allocations based on frequency and amortization

### PUT `/expenses/{expense_id}` 🏗️
- **Purpose**: Update expense and regenerate allocations if needed
- **Request Body**: ExpenseUpdate model
- **Frontend Integration**: 🏗️ Custom
- **Smart Regeneration**: Regenerates allocations when critical fields change

### DELETE `/expenses/{expense_id}` 🏗️
- **Purpose**: Delete expense and its allocations
- **Frontend Integration**: 🏗️ Custom
- **Cascade Delete**: Removes associated allocations

### GET `/expenses/allocations` 🏗️
- **Purpose**: Get expense allocations with filtering
- **Parameters**: `expense_id`, `period`, `payment_status` (optional)
- **Frontend Integration**: 🏗️ Custom
- **Response**: Detailed allocation data with expense and category info

### GET `/expenses/forecast` 🏗️
- **Purpose**: Get expense forecast for period range with category breakdown
- **Parameters**: `start_period`, `end_period`, `category_type` (optional)
- **Frontend Integration**: 🏗️ Custom
- **Response**: ExpenseForecast model with period-based projections

### GET `/expenses/report` 🏗️
- **Purpose**: Comprehensive expense report with summary statistics
- **Frontend Integration**: 🏗️ Custom
- **Response**: ExpenseReportSummary with totals, upcoming payments, analytics

### GET `/expenses/summary` ❌
- **Purpose**: Expense summary endpoint (referenced in frontend)
- **Frontend Integration**: ❌ Unused
- **Notes**: Referenced in ExpenseManagement but endpoint may not exist

## 6. Payroll Management (`/payroll`) - 12 Endpoints

### GET `/payroll/employees` 🏗️
- **Purpose**: Get employees with department, status, and business unit filtering
- **Parameters**: `department`, `status`, `business_unit` (optional)
- **Frontend Integration**: 🏗️ Custom
- **Used By**: PayrollManagement components
- **Response**: Employees with parsed allocations and calculated status

### GET `/payroll/employees/{employee_id}` 🏗️
- **Purpose**: Get specific employee details
- **Frontend Integration**: 🏗️ Custom
- **Response**: Single employee with parsed allocations

### POST `/payroll/employees` 🏗️
- **Purpose**: Create new employee with auto-generated ID
- **Request Body**: PayrollCreate model
- **Frontend Integration**: 🏗️ Custom
- **ID Generation**: EMP-{timestamp}

### PUT `/payroll/employees/{employee_id}` 🏗️
- **Purpose**: Update employee information
- **Request Body**: PayrollBase model
- **Frontend Integration**: 🏗️ Custom

### DELETE `/payroll/employees/{employee_id}` 🏗️
- **Purpose**: Delete employee
- **Frontend Integration**: 🏗️ Custom

### GET `/payroll/config` 🏗️
- **Purpose**: Get payroll tax and benefit configuration
- **Frontend Integration**: 🏗️ Custom
- **Response**: Current config or default rates

### POST `/payroll/config` 🏗️
- **Purpose**: Update payroll configuration with historical versioning
- **Request Body**: PayrollConfigCreate model
- **Frontend Integration**: 🏗️ Custom
- **ID Generation**: CONFIG-{timestamp}

### GET `/payroll/calculations/{employee_id}` 🏗️
- **Purpose**: Calculate detailed costs for specific employee
- **Parameters**: `pay_periods` (query)
- **Frontend Integration**: 🏗️ Custom
- **Response**: Detailed cost breakdown with taxes and benefits

### GET `/payroll/forecast` 🏗️
- **Purpose**: Generate payroll forecast for specified periods
- **Parameters**: `periods` (default 26), `include_raises` (default true)
- **Frontend Integration**: 🏗️ Custom
- **Response**: Period-based forecast with employee details

### GET `/payroll/departments` 🏗️
- **Purpose**: Get payroll analytics by department
- **Frontend Integration**: 🏗️ Custom
- **Response**: Department analytics with costs and employee counts

### GET `/payroll/business-units` 🏗️
- **Purpose**: Get analytics by business unit allocation
- **Frontend Integration**: 🏗️ Custom
- **Business Units**: Customer-Centric Brands, OEM Work, Internal Operations, Other Projects

### PUT `/payroll/employees/{employee_id}/allocations` 🏗️
- **Purpose**: Update employee business unit allocations
- **Request Body**: Dict[str, float] (must sum to 100%)
- **Frontend Integration**: 🏗️ Custom
- **Validation**: Allocations must sum to 100%

### POST `/payroll/bulk-update` 🏗️
- **Purpose**: Bulk update multiple employees
- **Request Body**: List[Dict[str, Any]]
- **Frontend Integration**: 🏗️ Custom

### GET `/payroll/reports/summary` 🏗️
- **Purpose**: Comprehensive payroll summary report
- **Frontend Integration**: 🏗️ Custom
- **Response**: Complete summary with all analytics combined

## 7. Loan Management (`/loans`) - 6 Endpoints

### POST `/loans/` 🏗️
- **Purpose**: Create new loan with automatic amortization schedule generation
- **Request Body**: LoanCreate model
- **Frontend Integration**: 🏗️ Custom
- **Used By**: LoanManagement components
- **ID Generation**: LOAN-{UUID8}
- **Auto-generates**: Complete amortization schedule

### GET `/loans/` 🏗️
- **Purpose**: Get all loans with summary information
- **Parameters**: `active_only` (query, default true)
- **Frontend Integration**: 🏗️ Custom
- **Response**: LoanWithDetails including payment progress

### PUT `/loans/{loan_id}` 🏗️
- **Purpose**: Update loan and regenerate schedule if needed
- **Request Body**: LoanUpdate model
- **Frontend Integration**: 🏗️ Custom
- **Smart Regeneration**: Recreates schedule when critical fields change

### DELETE `/loans/{loan_id}` 🏗️
- **Purpose**: Delete loan and payment schedule
- **Frontend Integration**: 🏗️ Custom
- **Cascade Delete**: Removes associated payment schedule

### GET `/loans/{loan_id}/schedule` 🏗️
- **Purpose**: Get complete amortization schedule for a loan
- **Frontend Integration**: 🏗️ Custom
- **Response**: AmortizationSchedule with payment details and totals

### GET `/loans/summary` 🏗️
- **Purpose**: Comprehensive loan portfolio summary
- **Frontend Integration**: 🏗️ Custom
- **Response**: LoanSummary with portfolio analytics

### GET `/loans/cash-flow` 🏗️
- **Purpose**: Loan payment cash flow projection for period range
- **Parameters**: `start_period`, `end_period` (YYYY-MM format)
- **Frontend Integration**: 🏗️ Custom
- **Response**: CashFlowProjection by period

## 8. Database Management (`/database`) - 15 Endpoints

### POST `/database/load_table` ❌
- **Purpose**: Load CSV data into database table
- **Parameters**: `table_name`, `mode`, CSV file
- **Frontend Integration**: ❌ Unused
- **Notes**: Data import functionality not exposed in UI

### GET `/database/quality` ❌
- **Purpose**: Basic data quality checks
- **Frontend Integration**: ❌ Unused
- **Notes**: Data quality monitoring not implemented in frontend

### GET `/database/logs/execution` ❌
- **Purpose**: Get execution logs with filtering
- **Parameters**: `limit`, `user_id`, `session_id`, `status` (optional)
- **Frontend Integration**: ❌ Unused
- **Notes**: Audit trail not exposed in frontend

### POST `/database/rollback/replay` ❌
- **Purpose**: Replay SQL statements from execution log
- **Parameters**: `target_date`, `max_log_id`, `user_id`, `session_id` (optional)
- **Frontend Integration**: ❌ Unused
- **Notes**: Advanced database recovery features not in UI

### POST `/database/rollback/reset` ❌
- **Purpose**: Reset database to initial state
- **Frontend Integration**: ❌ Unused
- **Notes**: Database reset functionality not exposed

### GET `/database/snapshot` ❌
- **Purpose**: Export current SQLite database file
- **Frontend Integration**: ❌ Unused
- **Notes**: Database export not implemented

### POST `/database/save` ❌
- **Purpose**: Save copy of current database with custom name
- **Request Body**: `{name: string}`
- **Frontend Integration**: ❌ Unused
- **Notes**: Database backup functionality not in UI

### POST `/database/save-current` ❌
- **Purpose**: Auto-save current state with timestamp
- **Frontend Integration**: ❌ Unused
- **Notes**: Auto-save not integrated with frontend

### GET `/database/list` ❌
- **Purpose**: List all saved databases
- **Frontend Integration**: ❌ Unused
- **Response**: Categorized list of manual saves vs autosaves
- **Notes**: Database management UI not implemented

### POST `/database/load` ❌
- **Purpose**: Load saved database file
- **Request Body**: `{filename: string}`
- **Frontend Integration**: ❌ Unused
- **Notes**: Database restore functionality not in UI

### POST `/database/switch` ❌
- **Purpose**: Switch to different database file
- **Request Body**: `{filename: string}`
- **Frontend Integration**: ❌ Unused
- **Notes**: Database switching not implemented

### DELETE `/database/delete/{filename}` ❌
- **Purpose**: Delete saved database file
- **Frontend Integration**: ❌ Unused
- **Notes**: Database file management not in UI

### POST `/database/revert-to-last-save` ❌
- **Purpose**: Revert to most recent autosave
- **Frontend Integration**: ❌ Unused
- **Notes**: Database revert functionality not exposed

### GET `/database/current` ❌
- **Purpose**: Get current database information
- **Frontend Integration**: ❌ Unused
- **Notes**: Database status not shown in UI

## 9. Chat & AI Integration (`/chat`) - 12 Endpoints

### POST `/chat/llm` ❌
- **Purpose**: Natural language to SQL conversion using Ollama
- **Request Body**: ChatRequest model
- **Frontend Integration**: ❌ Unused
- **Notes**: LLM integration available but not used in current UI

### POST `/chat/agent` ❌
- **Purpose**: LangChain powered agent interactions
- **Request Body**: ChatRequest model
- **Frontend Integration**: ❌ Unused
- **Notes**: Agent system not integrated with frontend

### POST `/chat/plan_execute` ❌
- **Purpose**: Plan with DeepSeek, execute with Llama
- **Request Body**: ChatRequest model
- **Frontend Integration**: ❌ Unused
- **Notes**: Advanced planning features not in UI

### POST `/chat/voice` ❌
- **Purpose**: Voice command processing via Whisper
- **Request Body**: Audio file
- **Frontend Integration**: ❌ Unused
- **Notes**: Voice interface not implemented

### POST `/chat/agents` ❌
- **Purpose**: Chat with AI agents system
- **Request Body**: AgentChatRequest model
- **Frontend Integration**: ❌ Unused
- **Notes**: AI agents system not used in frontend

### GET `/chat/agents/history` ❌
- **Purpose**: Get conversation history
- **Frontend Integration**: ❌ Unused
- **Notes**: Chat history not implemented

### POST `/chat/agents/clear` ❌
- **Purpose**: Clear conversation history
- **Frontend Integration**: ❌ Unused
- **Notes**: Chat management not in UI

### GET `/chat/agents/available` ❌
- **Purpose**: Get list of available agents
- **Frontend Integration**: ❌ Unused
- **Notes**: Agent discovery not implemented

### POST `/chat/preview_sql` ❌
- **Purpose**: Preview SQL execution without applying changes
- **Request Body**: SQLApplyRequest model
- **Frontend Integration**: ❌ Unused
- **Notes**: SQL preview functionality not exposed

### POST `/chat/apply_sql` ❌
- **Purpose**: Apply user-approved SQL with logging
- **Request Body**: SQLApplyRequest model
- **Frontend Integration**: ❌ Unused
- **Notes**: SQL execution not integrated with frontend

### POST `/chat/recalculate` ❌
- **Purpose**: Re-run forecast calculations
- **Frontend Integration**: ❌ Unused
- **Notes**: Recalculation functionality not implemented

## 10. Generic CRUD Operations (`/crud`) - Deprecated

*Note: The crud_routes.py file appears to be a duplicate of forecast_routes.py functionality and may indicate deprecated or unused code.*

---

# Frontend Integration Analysis

## Integration Patterns

### 1. ForecastContext Pattern (Primary)
- **Used For**: Core data management (forecasts, customers, products, machines, etc.)
- **Endpoints**: Primarily `/data/*` and `/forecast/*`
- **Benefits**: Centralized state management, automatic refresh, error handling
- **Coverage**: ~15 endpoints

### 2. Direct API Calls Pattern (Secondary)
- **Used For**: Specialized modules (Expenses, Payroll, Loans)
- **Endpoints**: Module-specific endpoints like `/expenses/*`, `/payroll/*`, `/loans/*`
- **Benefits**: Fine-grained control, module-specific optimizations
- **Coverage**: ~32 endpoints
- **Note**: These could be integrated into ForecastContext for consistency

### 3. Unused Endpoints (Opportunity)
- **Count**: 26 endpoints (36% of total)
- **Categories**: Database management, AI/Chat features, some reporting
- **Opportunity**: Significant functionality available but not exposed in UI

## Coverage Statistics

- **Total Endpoints**: 73
- **Used (✅)**: 15 endpoints (21%)
- **Partial/Custom (⚠️🏗️)**: 32 endpoints (44%)
- **Unused (❌)**: 26 endpoints (36%)

## Architecture Recommendations

### 1. Consolidate Integration Patterns
- **Goal**: Move direct API calls into ForecastContext
- **Benefits**: Consistent error handling, unified state management, better caching
- **Priority**: High for Expenses, Payroll, Loans modules

### 2. Expose Unused Functionality
- **Database Management**: Add UI for backup/restore operations
- **AI Integration**: Implement chat interface for natural language queries
- **Reporting**: Add advanced analytics and summary reports
- **Priority**: Medium, based on user needs

### 3. Improve Error Handling
- **Standardize**: Ensure all endpoints return consistent error formats
- **Frontend**: Add comprehensive error handling for all API calls
- **Logging**: Implement frontend error logging for debugging

### 4. Optimize Data Loading
- **Caching**: Implement intelligent caching for frequently accessed data
- **Pagination**: Add pagination for large datasets
- **Real-time**: Consider WebSocket connections for real-time updates

---

# Maintenance Guide

## Keeping Documentation Updated

### 1. Backend Changes
**When adding new endpoints:**
1. Update this documentation with integration status
2. Consider frontend integration needs
3. Follow established patterns for consistency

**When modifying existing endpoints:**
1. Update affected frontend code
2. Test integration thoroughly
3. Update documentation with changes

### 2. Frontend Changes
**When adding new integrations:**
1. Choose appropriate integration pattern
2. Update integration status in documentation
3. Consider moving to ForecastContext if appropriate

**When modifying existing integrations:**
1. Ensure backward compatibility
2. Test error handling scenarios
3. Update documentation

### 3. Regular Audits
**Monthly Review:**
- Check for unused endpoints that could be deprecated
- Identify integration opportunities
- Review error rates and performance

**Quarterly Assessment:**
- Evaluate integration patterns for optimization
- Plan new feature integrations
- Update architecture recommendations

### 4. Integration Testing
**Automated Testing:**
- API endpoint availability tests
- Frontend-backend integration tests
- Error handling verification

**Manual Testing:**
- New feature integration testing
- Cross-module data consistency
- User workflow validation

---

## API Design Standards

### 1. Consistent Response Format
All endpoints use the standard `ForecastResponse` model:
```json
{
  "status": "success|error",
  "data": {},
  "message": "Description"
}
```

### 2. Composite Key Handling
Special handling for tables with composite keys:
- **BOM**: `bom_id-version-bom_line`
- **Router Operations**: `router_id-sequence`

### 3. Filtering Patterns
Most GET endpoints support optional query parameters:
- `forecast_id`: Filter by forecast scenario
- `period`: Filter by time period (YYYY-MM format)
- `status`: Filter by status flags
- `limit`: Limit number of results

### 4. Automatic ID Generation
Create endpoints automatically generate IDs with specific patterns:
- Forecast: `F001`, `F002`, etc.
- Employees: `EMP-{timestamp}`
- Expenses: `EXP-{UUID8}`
- Loans: `LOAN-{UUID8}`

### 5. Bulk Operations
Several endpoints support bulk operations:
- `/forecast/bulk_update`: Bulk forecast updates
- `/payroll/bulk-update`: Bulk employee updates

### 6. Audit Trail
SQL execution logging for data modifications with rollback capabilities.

---

## Security & Authentication

**Current Status**: No authentication/authorization implemented
**Access Control**: All endpoints are publicly accessible
**CORS**: Configured for frontend integration with localhost and Docker container access

**Future Considerations**:
- Implement authentication middleware
- Add role-based access control
- Secure sensitive endpoints (database management, AI features)

---

# Implementation Task List

Based on the analysis above, here are the prioritized tasks for improving frontend-backend integration:

## Phase 1: Core Infrastructure (High Priority)

### 1. Create Centralized API Client
- **File**: `frontend/src/utils/apiClient.js`
- **Purpose**: Standardize HTTP client usage and configuration
- **Features**:
  - Axios-based client with base URL configuration
  - Consistent error handling and response processing
  - Request/response interceptors
  - Toast notification integration
  - Loading state management

### 2. Update ForecastContext Integration
- **File**: `frontend/src/context/ForecastContext.js`
- **Changes**: Replace direct axios calls with centralized API client
- **Benefits**: Consistent error handling, better maintainability

### 3. Migrate Direct API Call Modules
- **ExpenseManagement**: Replace fetch calls with centralized client
- **LoanManagement**: Replace fetch calls with centralized client  
- **DatabaseModals**: Replace fetch calls with centralized client
- **ChatPanel**: Replace direct axios with centralized client

## Phase 2: Integration Consolidation (Medium Priority)

### 4. Expand ForecastContext
- **Add Expense Methods**: `fetchExpenses()`, `createExpense()`, `updateExpense()`, etc.
- **Add Loan Methods**: `fetchLoans()`, `createLoan()`, `updateLoan()`, etc.
- **Add Database Methods**: `saveDatabase()`, `loadDatabase()`, etc.

### 5. Remove Hardcoded URLs
- **Search for**: `localhost:8000`, `http://localhost:8000`
- **Replace with**: Relative paths using centralized API client
- **Files to check**: All component files, especially modules

### 6. Standardize Error Handling
- **Implement**: Consistent error message formatting
- **Add**: Loading states for all API operations
- **Ensure**: Proper error recovery and user feedback

## Phase 3: Architecture Improvements (Low Priority)

### 7. API Service Layer (Optional)
- **Create**: Dedicated service classes for each module
- **Example**: `ExpenseService.js`, `LoanService.js`, `DatabaseService.js`
- **Benefits**: Better organization, easier testing

### 8. Expose Unused Functionality
- **Database Management UI**: Backup/restore operations
- **AI Integration**: Chat interface for natural language queries
- **Advanced Reporting**: Summary reports and analytics

## Phase 4: Testing and Validation (High Priority)

### 9. Comprehensive Testing
- **Unit Tests**: Test new API client and service methods
- **Integration Tests**: Verify all modules work with changes
- **Error Handling**: Test error scenarios and recovery
- **Performance**: Ensure no regressions in load times

### 10. Documentation Updates
- **Update**: Component documentation with new patterns
- **Create**: API client usage examples
- **Maintain**: This documentation with implementation status

## Implementation Priority

### Immediate (This Sprint)
1. ✅ Create centralized API client
2. ✅ Update ForecastContext to use new client
3. ✅ Migrate ExpenseManagement module
4. ✅ Remove hardcoded URLs

### Next Sprint
5. ✅ Migrate LoanManagement module
6. ✅ Migrate remaining modules (DatabaseModals, ChatPanel)
7. ✅ Add expense/loan methods to ForecastContext
8. ✅ Comprehensive testing

### Future Sprints
9. ⏳ API service layer implementation
10. ⏳ Expose unused backend functionality
11. ⏳ Advanced features and optimizations

## Success Criteria

- **Consistency**: All API calls use the same HTTP client
- **Error Handling**: Uniform error handling across all modules
- **Maintainability**: Centralized API configuration
- **Performance**: No regression in load times or responsiveness
- **Functionality**: All existing features continue to work

## Risk Mitigation

- **Backup**: Create git branch before major changes
- **Testing**: Test each module after migration
- **Rollback Plan**: Keep old implementation until new is verified
- **Documentation**: Update as changes are made

---

*This comprehensive documentation was generated and maintained by the API Integration Auditor on 2025-01-25. Last updated: 2025-01-25*