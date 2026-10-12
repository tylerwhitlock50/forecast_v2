"""Importing this package registers every tool on the shared server."""
from mcp_server.tools import admin, costing, expenses, loans, master_data, payroll, reporting, sales, scenarios  # noqa: F401
from mcp_server.tools import forecasts, imports, pricing  # noqa: F401  (build workflow: imports, prices, deductions, COGS / labor, export)
