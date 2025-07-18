"""
OpenAI Agents Service - Multi-agent system using official OpenAI Agents SDK
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



# Pydantic models for structured outputs
class Customer(BaseModel):
    customer_id: str = Field(..., description="Customer ID (e.g., CUST-001)")
    customer_name: str = Field(..., description="Customer name")
    customer_type: str = Field(..., description="Customer type")
    region: str = Field(..., description="Customer region")

class Product(BaseModel):
    unit_id: str = Field(..., description="Product ID (e.g., PROD-001)")
    unit_name: str = Field(..., description="Product name")
    unit_description: str = Field(..., description="Product description")
    base_price: float = Field(..., description="Base price")
    unit_type: str = Field(..., description="Product type")
    bom_id: Optional[str] = Field(None, description="BOM ID")
    router_id: Optional[str] = Field(None, description="Router ID")

class Sales(BaseModel):
    sale_id: str = Field(..., description="Sale ID")
    customer_id: str = Field(..., description="Customer ID")
    unit_id: str = Field(..., description="Product ID")
    period: str = Field(..., description="Period (e.g., 2024-Q1)")
    quantity: int = Field(..., description="Quantity sold")
    unit_price: float = Field(..., description="Unit price")
    total_revenue: float = Field(..., description="Total revenue")

class Machine(BaseModel):
    machine_id: str = Field(..., description="Machine ID (e.g., MACH-001)")
    machine_name: str = Field(..., description="Machine name")
    machine_description: str = Field(..., description="Machine description")
    machine_rate: float = Field(..., description="Machine rate per hour")
    available_minutes_per_month: int = Field(..., description="Available minutes per month")

class BOM(BaseModel):
    bom_id: str = Field(..., description="BOM ID")
    version: str = Field(..., description="BOM version")
    bom_line: int = Field(..., description="BOM line number")
    material_description: str = Field(..., description="Material description")
    qty: float = Field(..., description="Quantity")
    unit: str = Field(..., description="Unit of measure")
    unit_price: float = Field(..., description="Unit price")
    material_cost: float = Field(..., description="Material cost")

class SQLQueryResult(BaseModel):
    query: str = Field(..., description="SQL query executed")
    rows_affected: int = Field(..., description="Number of rows affected or returned")
    data: Optional[List[Dict[str, Any]]] = Field(None, description="Query result data")
    error: Optional[str] = Field(None, description="Error message if any")

class UpdateResult(BaseModel):
    table: str = Field(..., description="Table updated")
    operation: str = Field(..., description="Update operation performed")
    rows_affected: int = Field(..., description="Number of rows affected")
    error: Optional[str] = Field(None, description="Error message if any")

# Tool functions for database operations
@function_tool
async def execute_sql_query(query: str, description: str = "SQL Query") -> SQLQueryResult:
    """
    Execute a SQL query safely against the database.
    
    Args:
        query: The SQL query to execute
        description: Description of the query purpose
    
    Returns:
        SQLQueryResult with query results or error
    """
    if not execute_sql:
        return SQLQueryResult(
            query=query,
            rows_affected=0,
            error="Database functions not available"
        )
    
    try:
        result = execute_sql(query, description=description)
        
        if result["status"] == "success":
            data = result.get("data", [])
            return SQLQueryResult(
                query=query,
                rows_affected=len(data),
                data=data
            )
        else:
            return SQLQueryResult(
                query=query,
                rows_affected=0,
                error=result.get("error", "Unknown error")
            )
    except Exception as e:
        return SQLQueryResult(
            query=query,
            rows_affected=0,
            error=str(e)
        )

@function_tool
async def create_customer(customer: Customer) -> Dict[str, Any]:
    """
    Create a new customer in the database.
    
    Args:
        customer: Customer object with all required fields
    
    Returns:
        Result of the creation operation
    """
    query = f"""
    INSERT INTO customers (customer_id, customer_name, customer_type, region)
    VALUES ('{customer.customer_id}', '{customer.customer_name}', 
            '{customer.customer_type}', '{customer.region}')
    """
    
    result = await execute_sql_query(query, "Create customer")
    return {
        "success": result.error is None,
        "customer_id": customer.customer_id,
        "error": result.error
    }

@function_tool
async def create_product(product: Product) -> Dict[str, Any]:
    """
    Create a new product in the database.
    
    Args:
        product: Product object with all required fields
    
    Returns:
        Result of the creation operation
    """
    query = f"""
    INSERT INTO units (unit_id, unit_name, unit_description, base_price, 
                      unit_type, bom_id, router_id)
    VALUES ('{product.unit_id}', '{product.unit_name}', '{product.unit_description}',
            {product.base_price}, '{product.unit_type}', 
            {'NULL' if not product.bom_id else f"'{product.bom_id}'"}, 
            {'NULL' if not product.router_id else f"'{product.router_id}'"})
    """
    
    result = await execute_sql_query(query, "Create product")
    return {
        "success": result.error is None,
        "unit_id": product.unit_id,
        "error": result.error
    }

@function_tool
async def create_sales_record(sales: Sales) -> Dict[str, Any]:
    """
    Create a new sales record in the database.
    
    Args:
        sales: Sales object with all required fields
    
    Returns:
        Result of the creation operation
    """
    query = f"""
    INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, 
                      unit_price, total_revenue)
    VALUES ('{sales.sale_id}', '{sales.customer_id}', '{sales.unit_id}',
            '{sales.period}', {sales.quantity}, {sales.unit_price}, 
            {sales.total_revenue})
    """
    
    result = await execute_sql_query(query, "Create sales record")
    return {
        "success": result.error is None,
        "sale_id": sales.sale_id,
        "error": result.error
    }

@function_tool
async def update_sales_quantities(
    unit_id: str, 
    period: str, 
    quantity_change: int
) -> UpdateResult:
    """
    Update sales quantities for a specific product and period.
    
    Args:
        unit_id: Product ID to update
        period: Period to update (e.g., 2024-Q1)
        quantity_change: Amount to change quantity by (positive or negative)
    
    Returns:
        UpdateResult with operation details
    """
    query = f"""
    UPDATE sales 
    SET quantity = quantity + {quantity_change},
        total_revenue = (quantity + {quantity_change}) * unit_price
    WHERE unit_id = '{unit_id}' AND period = '{period}'
    """
    
    result = await execute_sql_query(query, "Update sales quantities")
    return UpdateResult(
        table="sales",
        operation=f"Update quantity by {quantity_change}",
        rows_affected=result.rows_affected,
        error=result.error
    )

@function_tool
async def update_product_pricing(
    unit_id: str, 
    new_price: float
) -> UpdateResult:
    """
    Update the base price for a product.
    
    Args:
        unit_id: Product ID to update
        new_price: New base price
    
    Returns:
        UpdateResult with operation details
    """
    query = f"""
    UPDATE units 
    SET base_price = {new_price}
    WHERE unit_id = '{unit_id}'
    """
    
    result = await execute_sql_query(query, "Update product pricing")
    return UpdateResult(
        table="units",
        operation=f"Update price to {new_price}",
        rows_affected=result.rows_affected,
        error=result.error
    )

@function_tool
async def analyze_sales_by_customer(customer_id: str) -> Dict[str, Any]:
    """
    Analyze sales data for a specific customer.
    
    Args:
        customer_id: Customer ID to analyze
    
    Returns:
        Analysis results including total revenue, products purchased, etc.
    """
    query = f"""
    SELECT 
        c.customer_name,
        COUNT(DISTINCT s.unit_id) as product_count,
        SUM(s.quantity) as total_quantity,
        SUM(s.total_revenue) as total_revenue,
        AVG(s.unit_price) as avg_price
    FROM sales s
    JOIN customers c ON s.customer_id = c.customer_id
    WHERE s.customer_id = '{customer_id}'
    GROUP BY c.customer_name
    """
    
    result = await execute_sql_query(query, "Analyze customer sales")
    
    if result.data and len(result.data) > 0:
        return {
            "customer_id": customer_id,
            "analysis": result.data[0],
            "error": None
        }
    else:
        return {
            "customer_id": customer_id,
            "analysis": None,
            "error": "No data found for customer"
        }

# Create specialized agents (only if agents are available)
def create_agents():
    """Create agent instances if the SDK is available."""
    if not AGENTS_AVAILABLE:
        return None, None, None, None
    
    creation_agent = Agent(
        name="Creation Agent",
        handoff_description="Specialist for creating new database records (customers, products, sales, machines, BOM)",
        instructions="""
        You are a Creation Agent responsible for creating new database records.
        
        Your capabilities:
        - Create new customers with proper ID format (CUST-XXX)
        - Create new products with proper ID format (PROD-XXX)
        - Create sales records linking customers and products
        - Create machines and BOM entries
        
        Always validate data before creation and generate appropriate IDs.
        Confirm successful creation with the user.
        """,
        tools=[
            create_customer,
            create_product,
            create_sales_record
        ]
    )

    sql_agent = Agent(
        name="SQL Agent",
        handoff_description="Specialist for executing SQL queries and data analysis",
        instructions="""
        You are a SQL Agent responsible for querying and analyzing database data.
        
        Available tables:
        - customers: customer_id, customer_name, customer_type, region
        - units: unit_id, unit_name, unit_description, base_price, unit_type, bom_id, router_id
        - sales: sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue
        - machines: machine_id, machine_name, machine_description, machine_rate, available_minutes_per_month
        - bom: bom_id, version, bom_line, material_description, qty, unit, unit_price, material_cost
        
        Write clear, efficient SQL queries and explain the results to the user.
        Use JOINs appropriately and always validate queries before execution.
        """,
        tools=[
            execute_sql_query,
            analyze_sales_by_customer
        ]
    )

    update_agent = Agent(
        name="Update Agent",
        handoff_description="Specialist for updating existing database records",
        instructions="""
        You are an Update Agent responsible for modifying existing database records.
        
        Your capabilities:
        - Update sales quantities and recalculate revenue
        - Update product pricing
        - Modify customer information
        - Adjust machine capacities
        
        Always validate that records exist before updating.
        Provide clear confirmation of what was updated.
        """,
        tools=[
            update_sales_quantities,
            update_product_pricing
        ]
    )

    # Create the main triage agent with handoffs
    triage_agent = Agent(
        name="Triage Agent",
        instructions="""
        You are a helpful assistant for a financial forecasting system.
        
        Your role is to:
        1. Understand user requests and clarify if needed
        2. Determine which specialist agent can best help
        3. Hand off to the appropriate specialist
        
        Available specialists:
        - Creation Agent: For creating new customers, products, sales, machines, or BOM entries
        - SQL Agent: For querying data, running reports, or analyzing information
        - Update Agent: For modifying existing records, updating quantities or prices
        
        Be friendly and helpful. If you're not sure which agent to use, ask for clarification.
        """,
        handoffs=[creation_agent, sql_agent, update_agent]
    )
    
    return creation_agent, sql_agent, update_agent, triage_agent

# Initialize agents
creation_agent, sql_agent, update_agent, triage_agent = create_agents()

# Service class for managing agent interactions
class OpenAIAgentsService:
    def __init__(self):
        self.runner = Runner()
        self.sessions = {}  # Track sessions for this service instance
        
        # Initialize agents only if available
        if AGENTS_AVAILABLE and triage_agent is not None:
            self.main_agent = triage_agent
        else:
            self.main_agent = None
        
    async def process_message(
        self, 
        message: str, 
        session_id: Optional[str] = None,
        user_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Process a user message through the agent system.
        
        Args:
            message: User message to process
            session_id: Optional session ID for conversation continuity
            user_id: Optional user ID for tracking
            
        Returns:
            Dictionary with response content and metadata
        """
        # Ensure session_id is always set
        session_id = session_id or f"session_{datetime.now().timestamp()}"
        
        try:
            if not AGENTS_AVAILABLE or self.main_agent is None:
                return {
                    "content": "OpenAI Agents SDK is not available. Please install the required dependencies to use the AI agents system.",
                    "agent": "fallback_agent",
                    "timestamp": datetime.now().isoformat(),
                    "session_id": session_id,
                    "error": False,
                    "metadata": {"agents_available": False}
                }
            
            # Create or retrieve session
            session = SQLiteSession(f"{session_id}.db")
            
            # Store session for history tracking
            self.sessions[session_id] = session
            
            # Run the agent
            result = await self.runner.run(
                self.main_agent,
                message,
                session=session
            )
            logging.info(f"Agent result: {result}")
            
            return {
                "agent": result.last_agent.name,  # who ran last
                "content": result.final_output,
                "timestamp": datetime.now().isoformat(),
                "session_id": session_id,
                "error": False,
                "metadata": {
                    "total_turns": len(result.new_items),  # or however you define “turns”
                    "tools_used": [
                    item.raw_item.name
                    for item in result.new_items
                    if getattr(item, "type", "") == "tool_call_item"
                ]
                        }
                             }
            
        except Exception as e:
            return {
                "content": f"I encountered an error: {str(e)}",
                "agent": "error_handler",
                "timestamp": datetime.now().isoformat(),
                "session_id": session_id,
                "error": True,
                "metadata": {"error_type": type(e).__name__}
            }
    
    async def process_message_sync(self, message: str, **kwargs) -> Dict[str, Any]:
        """Synchronous wrapper for process_message."""
        return await self.process_message(message, **kwargs)

# Global service instance
openai_agents_service = OpenAIAgentsService()

# API models for FastAPI/Flask integration
class AgentChatRequest(BaseModel):
    message: str = Field(..., description="User message")
    session_id: Optional[str] = Field(None, description="Session ID for conversation continuity")
    user_id: Optional[str] = Field(None, description="User ID for tracking")

class AgentResponse(BaseModel):
    content: str = Field(..., description="Agent response")
    agent: str = Field(..., description="Agent that processed the request")
    timestamp: str = Field(..., description="Response timestamp")
    session_id: str = Field(..., description="Session ID")
    error: bool = Field(False, description="Whether an error occurred")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")

# FastAPI/Flask endpoint handlers
async def process_agent_chat(request: AgentChatRequest) -> AgentResponse:
    result = await openai_agents_service.process_message(
        request.message,
        session_id=request.session_id,
        user_id=request.user_id
    )

    # ensure the two required fields are present
    content   = result.get("content", "")
    timestamp = result.get("timestamp", datetime.now().isoformat())
    agent     = result.get("agent", "unknown")
    session   = result.get("session_id", request.session_id or "")
    error     = result.get("error", False)
    metadata  = result.get("metadata", {})

    return AgentResponse(
        content=content,
        agent=agent,
        timestamp=timestamp,
        session_id=session,
        error=error,
        metadata=metadata
    )

# Functions expected by main.py
def get_conversation_history() -> List[Dict[str, Any]]:
    """Get conversation history for all sessions."""
    history = []
    for session_id, session_data in openai_agents_service.sessions.items():
        if hasattr(session_data, 'get_items'):
            try:
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
    """Clear all conversation history."""
    # Clear each session's history
    for session_id, session in openai_agents_service.sessions.items():
        try:
            asyncio.run(session.clear_session())
        except Exception as e:
            print(f"Error clearing session {session_id}: {e}")
    
    # Clear the sessions dictionary
    openai_agents_service.sessions.clear()
    print("All conversation history cleared")

def get_available_agents() -> List[Dict[str, Any]]:
    """Get information about available agents."""
    return [
        {
            "name": "Triage Agent",
            "description": "Main agent that routes requests to specialists",
            "capabilities": ["request routing", "handoff management"]
        },
        {
            "name": "Creation Agent", 
            "description": "Creates new database records (customers, products, sales, machines, BOM)",
            "capabilities": ["create_customer", "create_product", "create_sales_record"]
        },
        {
            "name": "SQL Agent",
            "description": "Executes SQL queries and data analysis",
            "capabilities": ["execute_sql_query", "analyze_sales_by_customer"]
        },
        {
            "name": "Update Agent",
            "description": "Updates existing database records",
            "capabilities": ["update_sales_quantities", "update_product_pricing"]
        }
    ]

# Example usage
async def main():
    """Example usage of the agents service."""
    service = OpenAIAgentsService()
    
    # Example conversations
    examples = [
        "I need to create a new customer called Acme Corp in the North region",
        "Show me total sales for customer CUST-001",
        "Increase the quantity for product PROD-001 in Q1 2024 by 50 units",
        "What's the average price across all products?",
        "Create a new product called 'Widget Pro' with base price $99.99"
    ]
    
    for example in examples:
        print(f"\nUser: {example}")
        response = await service.process_message(example)
        print(f"Agent ({response['agent']}): {response['content']}")
        if response.get('metadata', {}).get('tools_used'):
            print(f"Tools used: {response['metadata']['tools_used']}")

if __name__ == "__main__":
    # Set up OpenAI API key
    os.environ["OPENAI_API_KEY"] = OPENAI_API_KEY
    
    # Run example
    asyncio.run(main())