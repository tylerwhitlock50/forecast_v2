"""
Improved OpenAI Agents Service - Enhanced multi-agent system with better context retention
and more helpful, exploratory behavior for financial forecasting system
"""

import os
import json
from datetime import datetime
from typing import Dict, List, Any, Optional, TypedDict
from pydantic import BaseModel, Field
import asyncio
from dotenv import load_dotenv
os.environ["OPENAI_AGENTS_DISABLE_TRACING"] = "1"
load_dotenv()
import logging

# OpenAI Agents SDK imports
try:
    from agents import Agent, Runner, function_tool, FunctionTool, SQLiteSession
    from agents.memory import Session
    AGENTS_AVAILABLE = True
    print("✓ OpenAI Agents SDK imported successfully")
except ImportError as e:
    print(f"✗ Failed to import OpenAI Agents SDK: {e}")
    AGENTS_AVAILABLE = False
    # Create dummy classes for fallback
    class Agent:
        def __init__(self, *args, **kwargs):
            pass
    class Runner:
        def __init__(self):
            pass
        async def run(self, *args, **kwargs):
            return type('obj', (object,), {
                'final_output': 'OpenAI Agents SDK not available. Please install the required dependencies.',
                'agent_run_infos': []
            })()
    class Session:
        def __init__(self, session_id):
            self.session_id = session_id
        async def get_items(self):
            return []
        async def clear_session(self):
            pass
    def function_tool(func):
        return func
    class FunctionTool:
        pass

# Database imports
try:
    from db.database import execute_sql
    print("✓ Database functions imported successfully")
except ImportError as e:
    print(f"✗ Failed to import database functions: {e}")
    execute_sql = None

# Project context - comprehensive understanding of the financial forecasting system
PROJECT_CONTEXT = """
FINANCIAL FORECASTING SYSTEM OVERVIEW:
This is an AI-powered financial modeling and cash flow forecasting system with comprehensive capabilities.

CORE BUSINESS PURPOSE:
- Revenue forecasting and scenario planning
- Cost management and analysis
- Manufacturing resource planning
- Customer and product lifecycle management

KEY DATABASE TABLES AND RELATIONSHIPS:
1. SALES/REVENUE DATA:
   - sales: Main revenue forecast data (sale_id, customer_id, unit_id, period [FORMAT: YYYY-MM-DD], quantity, unit_price, total_revenue)
   - forecast: Forecast scenario definitions and metadata

2. MASTER DATA:
   - customers: Customer master (customer_id, customer_name, customer_type, region)
   - units: Product/service definitions (unit_id, unit_name, unit_description, base_price, unit_type, bom_id, router_id)

3. MANUFACTURING & COSTS:
   - bom: Bill of materials with versioning (bom_id, version, bom_line, material_description, qty, unit, unit_price, material_cost)
   - router_definitions: Manufacturing routers (router_id, router_name, router_description)
   - router_operations: Router operation steps (operation_id, router_id, sequence, machine_id, machine_minutes, labor_minutes, labor_type_id, operation_description)
   - machines: Manufacturing equipment (machine_id, machine_name, machine_rate, available_minutes_per_month)

4. LABOR & PAYROLL:
   - payroll: Employee data and costs
   - labor_rates: Labor rate definitions (rate_name, rate_amount, labor_type_id)

COMMON BUSINESS OPERATIONS:
- Creating customers (use format: CUST-XXX)
- Adding products/units (use format: UNIT-XXX or PROD-XXX)
- Recording sales forecasts by period (use YYYY-MM-DD format, e.g., 2024-03-01, 2024-06-01)
- Managing BOMs and manufacturing costs
- Analyzing profitability and capacity

SYSTEM BEHAVIOR EXPECTATIONS:
- Be exploratory and helpful - if a table might exist, try querying it
- Generate appropriate IDs when creating records
- Always provide clear, actionable responses
- Use business context to understand user intent
"""

# Enhanced Pydantic models
class Customer(BaseModel):
    customer_id: str = Field(..., description="Customer ID (e.g., CUST-001)")
    customer_name: str = Field(..., description="Customer name")
    customer_type: str = Field(..., description="Customer type (e.g., 'Direct to Consumer', 'B2B')")
    region: str = Field(..., description="Customer region (e.g., 'US', 'Europe', 'Asia')")

class Product(BaseModel):
    unit_id: str = Field(..., description="Product ID (e.g., UNIT-001 or PROD-001)")
    unit_name: str = Field(..., description="Product name")
    unit_description: str = Field(..., description="Product description")
    base_price: float = Field(..., description="Base price")
    unit_type: str = Field(..., description="Product type")
    bom_id: Optional[str] = Field(None, description="BOM ID")
    router_id: Optional[str] = Field(None, description="Router ID")

class SQLQueryResult(BaseModel):
    query: str = Field(..., description="SQL query executed")
    rows_affected: int = Field(..., description="Number of rows affected or returned")
    data: Optional[List[Dict[str, Any]]] = Field(None, description="Query result data")
    error: Optional[str] = Field(None, description="Error message if any")
    success: bool = Field(True, description="Whether query was successful")

# Enhanced tool functions with better error handling and exploration
@function_tool
async def execute_sql_query_enhanced(query: str, description: str = "SQL Query", explore_mode: bool = False) -> SQLQueryResult:
    """
    Execute a SQL query with enhanced error handling and exploration capabilities.
    
    Args:
        query: The SQL query to execute
        description: Description of the query purpose
        explore_mode: If True, will attempt to explore table structure on errors
    
    Returns:
        SQLQueryResult with query results, error details, and suggestions
    """
    if not execute_sql:
        return SQLQueryResult(
            query=query,
            rows_affected=0,
            error="Database functions not available",
            success=False
        )
    
    try:
        result = execute_sql(query, description=description)
        
        if result["status"] == "success":
            data = result.get("data", [])
            return SQLQueryResult(
                query=query,
                rows_affected=len(data),
                data=data,
                success=True
            )
        else:
            error_msg = result.get("error", "Unknown error")
            
            # If in explore mode and table doesn't exist, try to find similar tables
            if explore_mode and "no such table" in error_msg.lower():
                # Try to get list of available tables
                try:
                    tables_result = execute_sql("SELECT name FROM sqlite_master WHERE type='table'", "Get table list")
                    if tables_result["status"] == "success":
                        tables = [row["name"] for row in tables_result["data"]]
                        error_msg += f"\n\nAvailable tables: {', '.join(tables)}"
                        
                        # Try to suggest similar table names
                        query_lower = query.lower()
                        for table in tables:
                            if table.lower() in query_lower or any(word in table.lower() for word in query_lower.split()):
                                error_msg += f"\n\nDid you mean table '{table}'?"
                except:
                    pass
            
            return SQLQueryResult(
                query=query,
                rows_affected=0,
                error=error_msg,
                success=False
            )
    except Exception as e:
        return SQLQueryResult(
            query=query,
            rows_affected=0,
            error=f"Exception: {str(e)}",
            success=False
        )

@function_tool
async def explore_table_structure(table_name: str) -> Dict[str, Any]:
    """
    Explore the structure of a table including columns, sample data, and relationships.
    
    Args:
        table_name: Name of the table to explore
    
    Returns:
        Comprehensive table information
    """
    if not execute_sql:
        return {"error": "Database functions not available"}
    
    result = {
        "table_name": table_name,
        "exists": False,
        "columns": [],
        "sample_data": [],
        "row_count": 0
    }
    
    try:
        # Check if table exists and get schema
        schema_query = f"PRAGMA table_info({table_name})"
        schema_result = execute_sql(schema_query, f"Get schema for {table_name}")
        
        if schema_result["status"] == "success" and schema_result["data"]:
            result["exists"] = True
            result["columns"] = schema_result["data"]
            
            # Get row count
            count_query = f"SELECT COUNT(*) as count FROM {table_name}"
            count_result = execute_sql(count_query, f"Count rows in {table_name}")
            if count_result["status"] == "success":
                result["row_count"] = count_result["data"][0]["count"]
            
            # Get sample data (first 3 rows)
            if result["row_count"] > 0:
                sample_query = f"SELECT * FROM {table_name} LIMIT 3"
                sample_result = execute_sql(sample_query, f"Sample data from {table_name}")
                if sample_result["status"] == "success":
                    result["sample_data"] = sample_result["data"]
        else:
            # Table doesn't exist, try to find similar tables
            tables_query = "SELECT name FROM sqlite_master WHERE type='table'"
            tables_result = execute_sql(tables_query, "Get all tables")
            if tables_result["status"] == "success":
                all_tables = [row["name"] for row in tables_result["data"]]
                result["suggested_tables"] = [t for t in all_tables if table_name.lower() in t.lower() or t.lower() in table_name.lower()]
                result["all_tables"] = all_tables
    
    except Exception as e:
        result["error"] = str(e)
    
    return result

@function_tool
async def create_customer_enhanced(customer_name: str, customer_type: str = "Direct to Consumer", region: str = "US") -> Dict[str, Any]:
    """
    Create a new customer with automatic ID generation and validation.
    
    Args:
        customer_name: Name of the customer
        customer_type: Type of customer (default: "Direct to Consumer")
        region: Customer region (default: "US")
    
    Returns:
        Result of the creation operation with detailed feedback
    """
    try:
        # Generate customer ID
        # First, check existing customer IDs to generate the next one
        existing_query = "SELECT customer_id FROM customers ORDER BY customer_id DESC LIMIT 1"
        existing_result = await execute_sql_query_enhanced(existing_query, "Get last customer ID")
        
        if existing_result.success and existing_result.data:
            last_id = existing_result.data[0]["customer_id"]
            # Extract number and increment
            if "CUST-" in last_id:
                try:
                    num = int(last_id.split("-")[1]) + 1
                    customer_id = f"CUST-{num:03d}"
                except:
                    customer_id = "CUST-001"
            else:
                customer_id = "CUST-001"
        else:
            customer_id = "CUST-001"
        
        # Create the customer
        query = f"""
        INSERT INTO customers (customer_id, customer_name, customer_type, region)
        VALUES ('{customer_id}', '{customer_name.replace("'", "''")}', '{customer_type}', '{region}')
        """
        
        result = await execute_sql_query_enhanced(query, "Create customer")
        
        if result.success:
            return {
                "success": True,
                "customer_id": customer_id,
                "customer_name": customer_name,
                "message": f"Successfully created customer '{customer_name}' with ID {customer_id}",
                "details": {
                    "customer_type": customer_type,
                    "region": region
                }
            }
        else:
            return {
                "success": False,
                "error": result.error,
                "message": f"Failed to create customer '{customer_name}'"
            }
            
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "message": f"Exception while creating customer '{customer_name}'"
        }

@function_tool
async def analyze_business_data(analysis_type: str, entity_id: str = None) -> Dict[str, Any]:
    """
    Perform comprehensive business analysis on various aspects of the data.
    
    Args:
        analysis_type: Type of analysis ('customer_sales', 'product_performance', 'regional_analysis', 'cost_analysis')
        entity_id: Optional specific entity to analyze
    
    Returns:
        Detailed analysis results
    """
    try:
        if analysis_type == "customer_sales":
            if entity_id:
                query = f"""
                SELECT 
                    c.customer_name,
                    c.customer_type,
                    c.region,
                    COUNT(DISTINCT s.unit_id) as products_purchased,
                    SUM(s.quantity) as total_quantity,
                    SUM(s.total_revenue) as total_revenue,
                    AVG(s.unit_price) as avg_price,
                    MIN(s.period) as first_purchase,
                    MAX(s.period) as last_purchase
                FROM sales s
                JOIN customers c ON s.customer_id = c.customer_id
                WHERE s.customer_id = '{entity_id}'
                GROUP BY c.customer_id, c.customer_name, c.customer_type, c.region
                """
            else:
                query = """
                SELECT 
                    c.customer_name,
                    c.customer_type,
                    c.region,
                    COUNT(DISTINCT s.unit_id) as products_purchased,
                    SUM(s.quantity) as total_quantity,
                    SUM(s.total_revenue) as total_revenue,
                    AVG(s.unit_price) as avg_price
                FROM sales s
                JOIN customers c ON s.customer_id = c.customer_id
                GROUP BY c.customer_id, c.customer_name, c.customer_type, c.region
                ORDER BY total_revenue DESC
                """
        
        elif analysis_type == "regional_analysis":
            query = """
            SELECT 
                c.region,
                COUNT(DISTINCT c.customer_id) as customer_count,
                COUNT(DISTINCT s.unit_id) as product_count,
                SUM(s.total_revenue) as total_revenue,
                AVG(s.unit_price) as avg_unit_price,
                SUM(s.quantity) as total_quantity
            FROM customers c
            LEFT JOIN sales s ON c.customer_id = s.customer_id
            GROUP BY c.region
            ORDER BY total_revenue DESC
            """
        
        elif analysis_type == "product_performance":
            query = """
            SELECT 
                u.unit_name,
                u.unit_type,
                u.base_price,
                COUNT(DISTINCT s.customer_id) as customers_buying,
                SUM(s.quantity) as total_sold,
                SUM(s.total_revenue) as total_revenue,
                AVG(s.unit_price) as avg_selling_price,
                (AVG(s.unit_price) - u.base_price) as price_variance
            FROM units u
            LEFT JOIN sales s ON u.unit_id = s.unit_id
            GROUP BY u.unit_id, u.unit_name, u.unit_type, u.base_price
            ORDER BY total_revenue DESC
            """
        
        elif analysis_type == "cost_analysis":
            query = """
            SELECT 
                b.bom_id,
                COUNT(b.bom_line) as component_count,
                SUM(b.material_cost) as total_material_cost,
                AVG(b.unit_price) as avg_component_price,
                MAX(b.unit_price) as most_expensive_component,
                MIN(b.unit_price) as least_expensive_component
            FROM bom b
            GROUP BY b.bom_id
            ORDER BY total_material_cost DESC
            """
        
        else:
            return {
                "success": False,
                "error": f"Unknown analysis type: {analysis_type}",
                "available_types": ["customer_sales", "product_performance", "regional_analysis", "cost_analysis"]
            }
        
        result = await execute_sql_query_enhanced(query, f"Business analysis: {analysis_type}")
        
        if result.success:
            return {
                "success": True,
                "analysis_type": analysis_type,
                "entity_id": entity_id,
                "data": result.data,
                "summary": f"Found {len(result.data)} records for {analysis_type} analysis"
            }
        else:
            return {
                "success": False,
                "error": result.error,
                "analysis_type": analysis_type
            }
            
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "analysis_type": analysis_type
        }

# Enhanced agents with better instructions and project context
def create_enhanced_agents():
    """Create enhanced agent instances with improved instructions and capabilities."""
    if not AGENTS_AVAILABLE:
        return None, None, None, None
    
    # Enhanced SQL Agent - more exploratory and helpful
    sql_agent = Agent(
        name="SQL Agent",
        handoff_description="Expert SQL analyst for the financial forecasting system - handles all data queries, analysis, and exploration",
        instructions=f"""
        {PROJECT_CONTEXT}
        
        You are an expert SQL Agent for this financial forecasting system. Your role is to be HELPFUL and EXPLORATORY.
        
        CORE PRINCIPLES:
        1. ALWAYS TRY FIRST, EXPLAIN LATER - If a user asks about a table or data, attempt the query
        2. BE EXPLORATORY - If a table doesn't exist, explore what tables do exist and suggest alternatives
        3. USE BUSINESS CONTEXT - Understand that this is a financial system with revenue, costs, customers, and products
        4. PROVIDE INSIGHTS - Don't just return data, explain what it means for the business
        
        AVAILABLE TOOLS:
        - execute_sql_query_enhanced: Your primary tool - use explore_mode=True when unsure
        - explore_table_structure: Use this to understand table structure and find related data
        - analyze_business_data: Use for common business analysis patterns
        
        BEHAVIOR GUIDELINES:
        - If a user mentions a table name, try querying it immediately
        - If a query fails, explore what tables exist and suggest alternatives
        - Always provide business context for your results
        - Generate helpful follow-up questions and suggestions
        - Be willing to try different approaches to get the user what they need
        
        COMMON QUERIES TO EXPECT:
        - Customer analysis and sales performance
        - Product profitability and pricing
        - Regional performance comparisons
        - Cost analysis from BOM data
        - Labor rate and machine utilization
        - Revenue forecasting scenarios
        
        Remember: You're here to help users understand their business data. Be proactive, exploratory, and always try to provide actionable insights.
        """,
        tools=[
            execute_sql_query_enhanced,
            explore_table_structure,
            analyze_business_data
        ]
    )

    # Enhanced Creation Agent
    creation_agent = Agent(
        name="Creation Agent",
        handoff_description="Business data creation specialist - creates customers, products, sales records, and other business entities",
        instructions=f"""
        {PROJECT_CONTEXT}
        
        You are a Creation Agent specialized in adding new business entities to the financial forecasting system.
        
        CORE RESPONSIBILITIES:
        - Create new customers with proper business context
        - Add products/units with appropriate pricing and categorization
        - Generate sales records and forecasts
        - Set up BOMs and manufacturing data
        - Handle all data creation with business intelligence
        
        CREATION STANDARDS:
        - Always generate appropriate IDs (CUST-XXX for customers, UNIT-XXX/PROD-XXX for products)
        - Validate data before creation
        - Provide clear success/failure feedback
        - Suggest next steps after creation
        - Use business-appropriate defaults when information is missing
        
        TOOLS AVAILABLE:
        - create_customer_enhanced: Smart customer creation with ID generation
        - execute_sql_query_enhanced: For any other creation needs
        - explore_table_structure: To understand data requirements
        
        BUSINESS CONTEXT:
        - Customer types: Direct to Consumer, B2B, Online, Brick and Mortar, etc.
        - Regions: US, Europe, Asia, etc.
        - Product types: Physical goods, services, etc.
        - Periods: Quarterly format (2024-Q1, 2024-Q2, etc.)
        
        Always be helpful and proactive. If something goes wrong, explain clearly and suggest alternatives.
        """,
        tools=[
            create_customer_enhanced,
            execute_sql_query_enhanced,
            explore_table_structure
        ]
    )

    # Enhanced Update Agent
    update_agent = Agent(
        name="Update Agent",
        handoff_description="Business data modification specialist - updates existing records, adjusts forecasts, and manages data changes",
        instructions=f"""
        {PROJECT_CONTEXT}
        
        You are an Update Agent specialized in modifying existing business data in the financial forecasting system.
        
        CORE RESPONSIBILITIES:
        - Update sales quantities and revenue forecasts
        - Modify product pricing and specifications
        - Adjust customer information and classifications
        - Update manufacturing costs and labor rates
        - Handle bulk updates and data corrections
        
        UPDATE PRINCIPLES:
        - Always verify records exist before updating
        - Provide clear before/after information
        - Handle cascading updates (e.g., price changes affecting revenue)
        - Validate business logic (e.g., positive quantities, reasonable prices)
        - Offer rollback suggestions if needed
        
        TOOLS AVAILABLE:
        - execute_sql_query_enhanced: Primary tool for all updates
        - explore_table_structure: To understand data relationships
        - analyze_business_data: To assess impact of changes
        
        COMMON UPDATE SCENARIOS:
        - Adjusting sales forecasts for new market conditions
        - Updating product prices and recalculating revenue
        - Modifying customer classifications or regions
        - Adjusting labor rates and machine costs
        - Bulk updates for scenario planning
        
        Always be careful with updates and provide clear feedback on what changed.
        """,
        tools=[
            execute_sql_query_enhanced,
            explore_table_structure,
            analyze_business_data
        ]
    )

    # Enhanced main triage agent with better routing
    triage_agent = Agent(
        name="Financial Forecasting Assistant",
        instructions=f"""
        {PROJECT_CONTEXT}
        
        You are the main assistant for a financial forecasting and business intelligence system.
        
        YOUR ROLE:
        - Understand user requests in business context
        - Route to appropriate specialists when needed
        - Handle simple queries directly
        - Maintain conversation context and business intelligence
        
        ROUTING DECISIONS:
        - Creation Agent: When users want to add new customers, products, sales records, or any new business entities
        - SQL Agent: For data queries, analysis, reports, or exploring existing information
        - Update Agent: For modifying existing records, adjusting forecasts, or changing business data
        
        BUSINESS INTELLIGENCE:
        - This system manages revenue forecasting, cost analysis, and business planning
        - Users are typically business analysts, finance teams, or operations managers
        - Common needs: customer analysis, product profitability, regional performance, cost management
        
        CONVERSATION STYLE:
        - Be helpful and business-focused
        - Ask clarifying questions when requests are ambiguous
        - Provide context and suggestions
        - Maintain awareness of previous conversation topics
        - Always try to provide value, even for complex requests
        
        HANDOFF TRIGGERS:
        - "create", "add", "new" → Creation Agent
        - "show", "find", "analyze", "report", "what is" → SQL Agent  
        - "update", "change", "modify", "adjust" → Update Agent
        
        Remember: You're here to help users make better business decisions with their data.
        """,
        handoffs=[creation_agent, sql_agent, update_agent]
    )
    
    return creation_agent, sql_agent, update_agent, triage_agent

# Enhanced service class with better memory management
class EnhancedOpenAIAgentsService:
    def __init__(self):
        self.runner = Runner()
        self.sessions = {}  # Enhanced session tracking
        self.conversation_context = {}  # Track conversation themes and context
        
        # Initialize enhanced agents
        if AGENTS_AVAILABLE:
            self.creation_agent, self.sql_agent, self.update_agent, self.main_agent = create_enhanced_agents()
        else:
            self.main_agent = None
        
    async def process_message(
        self, 
        message: str, 
        session_id: Optional[str] = None,
        user_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Process a user message with enhanced context retention and error handling.
        """
        # Ensure session_id is always set
        session_id = session_id or f"session_{datetime.now().timestamp()}"
        
        try:
            if not AGENTS_AVAILABLE or self.main_agent is None:
                return {
                    "content": "OpenAI Agents SDK is not available. Please install the required dependencies.",
                    "agent": "fallback_agent",
                    "timestamp": datetime.now().isoformat(),
                    "session_id": session_id,
                    "error": False,
                    "metadata": {"agents_available": False}
                }
            
            # Create or retrieve session with persistent storage
            session = SQLiteSession(f"sessions/{session_id}.db")
            
            # Store session and context
            self.sessions[session_id] = session
            
            # Update conversation context
            if session_id not in self.conversation_context:
                self.conversation_context[session_id] = {
                    "themes": [],
                    "last_tables": [],
                    "last_entities": [],
                    "session_started": datetime.now().isoformat()
                }
            
            # Enhanced context-aware message processing
            enhanced_message = self._enhance_message_with_context(message, session_id)
            
            # Run the agent
            result = await self.runner.run(
                self.main_agent,
                enhanced_message,
                session=session
            )
            
            # Update conversation context based on result
            self._update_conversation_context(session_id, message, result)
            
            # Extract agent info and metadata
            agent_name = getattr(result, 'last_agent', {})
            if hasattr(agent_name, 'name'):
                agent_name = agent_name.name
            else:
                agent_name = str(agent_name) if agent_name else "Unknown Agent"
            
            return {
                "agent": agent_name,
                "content": result.final_output,
                "timestamp": datetime.now().isoformat(),
                "session_id": session_id,
                "error": False,
                "metadata": {
                    "total_turns": len(getattr(result, 'new_items', [])),
                    "tools_used": self._extract_tools_used(result),
                    "conversation_context": self.conversation_context.get(session_id, {}),
                    "enhanced_message": enhanced_message != message
                }
            }
            
        except Exception as e:
            logging.error(f"Error in process_message: {str(e)}")
            return {
                "content": f"I encountered an error while processing your request: {str(e)}\n\nLet me try a different approach or please rephrase your request.",
                "agent": "error_handler",
                "timestamp": datetime.now().isoformat(),
                "session_id": session_id,
                "error": True,
                "metadata": {"error_type": type(e).__name__, "error_details": str(e)}
            }
    
    def _enhance_message_with_context(self, message: str, session_id: str) -> str:
        """Enhance the user message with relevant conversation context."""
        context = self.conversation_context.get(session_id, {})
        
        # Add context about recent tables or entities if relevant
        enhanced_parts = [message]
        
        if context.get("last_tables"):
            enhanced_parts.append(f"\n[Context: Recent tables discussed: {', '.join(context['last_tables'][-3:])}]")
        
        if context.get("last_entities"):
            enhanced_parts.append(f"\n[Context: Recent entities: {', '.join(context['last_entities'][-3:])}]")
        
        return "".join(enhanced_parts)
    
    def _update_conversation_context(self, session_id: str, message: str, result) -> None:
        """Update conversation context based on the interaction."""
        context = self.conversation_context[session_id]
        
        # Extract themes from message
        message_lower = message.lower()
        if any(word in message_lower for word in ["customer", "client"]):
            if "customer" not in context["themes"]:
                context["themes"].append("customer")
        
        if any(word in message_lower for word in ["product", "unit", "item"]):
            if "product" not in context["themes"]:
                context["themes"].append("product")
        
        if any(word in message_lower for word in ["sales", "revenue", "forecast"]):
            if "sales" not in context["themes"]:
                context["themes"].append("sales")
        
        # Extract table names from result if available
        result_content = getattr(result, 'final_output', '').lower()
        for table in ["customers", "units", "sales", "bom", "machines", "labor_rates", "router"]:
            if table in result_content:
                if table not in context["last_tables"]:
                    context["last_tables"].append(table)
        
        # Keep only recent items
        context["last_tables"] = context["last_tables"][-5:]
        context["themes"] = context["themes"][-10:]
    
    def _extract_tools_used(self, result) -> List[str]:
        """Extract tools used from the agent result."""
        try:
            tools = []
            items = getattr(result, 'new_items', [])
            for item in items:
                if hasattr(item, 'type') and item.type == "tool_call_item":
                    tool_name = getattr(item, 'name', None)
                    if tool_name and tool_name not in tools:
                        tools.append(tool_name)
            return tools
        except:
            return []

# Initialize the enhanced service
enhanced_openai_agents_service = EnhancedOpenAIAgentsService()

# API models remain the same
class AgentChatRequest(BaseModel):
    current_message: str = Field(..., description="Current user message")
    prior_messages: Optional[List[Dict[str, str]]] = Field(default_factory=list, description="Previous conversation messages")
    session_id: Optional[str] = Field(None, description="Session ID for conversation continuity")
    user_id: Optional[str] = Field(None, description="User ID for tracking")
    agent: Optional[str] = Field(None, description="Specific agent to use")

class AgentResponse(BaseModel):
    content: str = Field(..., description="Agent response")
    agent: str = Field(..., description="Agent that processed the request")
    timestamp: str = Field(..., description="Response timestamp")
    session_id: str = Field(..., description="Session ID")
    error: bool = Field(False, description="Whether an error occurred")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")

# Enhanced endpoint handler
async def process_agent_chat(request: AgentChatRequest) -> AgentResponse:
    # Combine prior messages with current message for context
    full_message = request.current_message
    
    # Add prior messages as context if available
    if request.prior_messages:
        context_messages = []
        for msg in request.prior_messages:
            role = msg.get('role', 'user')
            content = msg.get('content', '')
            context_messages.append(f"{role}: {content}")
        
        if context_messages:
            full_message = f"Previous conversation:\n" + "\n".join(context_messages) + f"\n\nCurrent message: {request.current_message}"
    
    result = await enhanced_openai_agents_service.process_message(
        full_message,
        session_id=request.session_id,
        user_id=request.user_id
    )

    return AgentResponse(
        content=result.get("content", ""),
        agent=result.get("agent", "unknown"),
        timestamp=result.get("timestamp", datetime.now().isoformat()),
        session_id=result.get("session_id", request.session_id or ""),
        error=result.get("error", False),
        metadata=result.get("metadata", {})
    )

# Enhanced utility functions
def get_conversation_history() -> List[Dict[str, Any]]:
    """Get enhanced conversation history with context."""
    history = []
    for session_id, session_data in enhanced_openai_agents_service.sessions.items():
        try:
            # Get session context
            context = enhanced_openai_agents_service.conversation_context.get(session_id, {})
            
            # Add session summary
            history.append({
                "session_id": session_id,
                "type": "session_summary",
                "themes": context.get("themes", []),
                "tables_discussed": context.get("last_tables", []),
                "entities_discussed": context.get("last_entities", []),
                "session_started": context.get("session_started", "")
            })
            
            # Add individual messages if available
            if hasattr(session_data, 'get_items'):
                items = asyncio.run(session_data.get_items())
                history.extend([
                    {
                        "session_id": session_id,
                        "role": item.get("role", "unknown"),
                        "content": item.get("content", ""),
                        "timestamp": item.get("timestamp", datetime.now().isoformat()),
                        "agent_type": item.get("agent_type", "unknown")
                    }
                    for item in items
                ])
        except Exception as e:
            print(f"Error getting history for session {session_id}: {e}")
    
    return history

def clear_conversation():
    """Clear all conversation history and context."""
    # Clear sessions
    for session_id, session in enhanced_openai_agents_service.sessions.items():
        try:
            asyncio.run(session.clear_session())
        except Exception as e:
            print(f"Error clearing session {session_id}: {e}")
    
    # Clear context and sessions
    enhanced_openai_agents_service.sessions.clear()
    enhanced_openai_agents_service.conversation_context.clear()
    print("All conversation history and context cleared")

def get_available_agents() -> List[Dict[str, Any]]:
    """Get enhanced information about available agents."""
    return [
        {
            "name": "Financial Forecasting Assistant",
            "description": "Main intelligent assistant with business context awareness",
            "capabilities": ["request routing", "business intelligence", "context retention"]
        },
        {
            "name": "Creation Agent", 
            "description": "Business entity creation specialist with smart ID generation",
            "capabilities": ["create_customer_enhanced", "smart data creation", "business validation"]
        },
        {
            "name": "SQL Agent",
            "description": "Expert data analyst with exploratory capabilities",
            "capabilities": ["execute_sql_query_enhanced", "explore_table_structure", "analyze_business_data", "business insights"]
        },
        {
            "name": "Update Agent",
            "description": "Data modification specialist with impact analysis",
            "capabilities": ["safe updates", "cascading changes", "business logic validation"]
        }
    ]

# Create sessions directory
import os
os.makedirs("sessions", exist_ok=True)

# Example usage
async def main():
    """Example usage of the enhanced agents service."""
    service = EnhancedOpenAIAgentsService()
    
    # Example conversations that should work better
    examples = [
        "Can you add a new customer called Tyler Whitlock? He's direct to consumer in the US region",
        "Who are my customers in the customer list?",
        "What region is most common for my customers?",
        "What is my highest labor rate from the labor_rates table and which type of labor is it?",
        "Can you check the BOM table structure and show me some sample data?",
        "What's the total revenue by region?"
    ]
    
    session_id = "demo_session"
    
    for example in examples:
        print(f"\nUser: {example}")
        response = await service.process_message(example, session_id=session_id)
        print(f"Agent ({response['agent']}): {response['content']}")
        if response.get('metadata', {}).get('tools_used'):
            print(f"Tools used: {response['metadata']['tools_used']}")
        print("-" * 80)

if __name__ == "__main__":
    # Run example
    asyncio.run(main())