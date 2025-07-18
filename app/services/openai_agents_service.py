"""
OpenAI Agents Service - Multi-agent system for forecast data management
"""

import os
import json
import sqlite3
from datetime import datetime
from typing import Dict, List, Any, Optional
from pydantic import BaseModel, Field

# OpenAI SDK imports
try:
    import openai
    from openai import OpenAI
    print("OpenAI SDK imported successfully")
except ImportError as e:
    print(f"Failed to import OpenAI SDK: {e}")
    openai = None
    OpenAI = None

# Database imports - import only what we need
try:
    from db.database import execute_sql
    print("✓ Database functions imported successfully")
except ImportError as e:
    print(f"✗ Failed to import database functions: {e}")
    execute_sql = None

# Set dummy API key - replace with real key
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
# Debug: Print API key status
print(f"OpenAI API Key length: {len(OPENAI_API_KEY) if OPENAI_API_KEY else 0}")
print(f"OpenAI API Key starts with: {OPENAI_API_KEY[:10] if OPENAI_API_KEY else 'None'}...")

class ConversationMessage(BaseModel):
    role: str = Field(..., description="Role of the message sender (user, assistant, system)")
    content: str = Field(..., description="Content of the message")
    timestamp: datetime = Field(default_factory=datetime.now)
    agent_type: Optional[str] = Field(None, description="Type of agent that sent the message")
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)

class AgentHandoff(BaseModel):
    target_agent: str = Field(..., description="Name of the agent to hand off to")
    context: str = Field(..., description="Context to pass to the next agent")
    user_request: str = Field(..., description="Original user request")
    data_gathered: Dict[str, Any] = Field(default_factory=dict)

class OpenAIAgentsService:
    def __init__(self):
        self.client = None
        self.conversation_history: List[ConversationMessage] = []
        self.current_agent = "chat_agent"
        self.session_id = None
        
        # Initialize OpenAI client if available
        print(f"OpenAI available: {OpenAI is not None}")
        print(f"API key is dummy: {OPENAI_API_KEY == 'sk-dummy-key-replace-with-real-key'}")
        print(f"API key is valid format: {OPENAI_API_KEY and OPENAI_API_KEY.startswith('sk-')}")
        
        if OpenAI and OPENAI_API_KEY and OPENAI_API_KEY != "sk-dummy-key-replace-with-real-key":
            try:
                self.client = OpenAI(api_key=OPENAI_API_KEY)
                print("OpenAI client initialized successfully")
            except Exception as e:
                print(f"Failed to initialize OpenAI client: {e}")
                self.client = None
        else:
            print("OpenAI client not initialized - missing requirements")
            self.client = None
        
        # Define agent capabilities
        self.agents = {
            "chat_agent": {
                "name": "Chat Agent",
                "description": "Handles general conversation and clarifies user requests",
                "system_prompt": self._get_chat_agent_prompt(),
                "functions": ["clarify_request", "gather_information", "handoff_to_specialist"]
            },
            "creation_agent": {
                "name": "Creation Agent", 
                "description": "Creates new database records using pydantic models",
                "system_prompt": self._get_creation_agent_prompt(),
                "functions": ["create_customer", "create_product", "create_forecast", "create_machine", "create_bom"]
            },
            "sql_agent": {
                "name": "SQL Agent",
                "description": "Executes SQL queries and data analysis",
                "system_prompt": self._get_sql_agent_prompt(),
                "functions": ["execute_query", "analyze_data", "generate_report"]
            },
            "update_agent": {
                "name": "Update Agent",
                "description": "Updates existing database records",
                "system_prompt": self._get_update_agent_prompt(),
                "functions": ["update_sales", "update_pricing", "update_quantities", "bulk_update"]
            }
        }
    
    def _get_chat_agent_prompt(self) -> str:
        return """
        You are a Chat Agent for a financial forecasting system. Your role is to:
        1. Understand user requests and clarify ambiguous requirements
        2. Gather necessary information from the user
        3. Determine which specialist agent can best handle the request
        4. Hand off to the appropriate specialist with clear context
        
        Available specialist agents:
        - creation_agent: Creates new customers, products, forecasts, machines, BOM items
        - sql_agent: Executes queries, analyzes data, generates reports
        - update_agent: Updates existing records, sales quantities, pricing
        
        When handing off, provide:
        - Clear context about what the user wants
        - Any specific details gathered
        - The exact task for the specialist agent
        
        Database schema includes: customers, products, sales, machines, bom, routers, labor_rates, payroll
        """
    
    def _get_creation_agent_prompt(self) -> str:
        return """
        You are a Creation Agent for a financial forecasting system. Your role is to:
        1. Create new database records using proper pydantic models
        2. Validate data before creation
        3. Generate appropriate IDs and handle relationships
        4. Confirm successful creation with the user
        
        Available pydantic models:
        - Customer: customer_id, customer_name, customer_type, region
        - Product: unit_id, unit_name, unit_description, base_price, unit_type, bom_id, router_id
        - Sales: sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue
        - Machine: machine_id, machine_name, machine_description, machine_rate, available_minutes_per_month
        - BOM: bom_id, version, bom_line, material_description, qty, unit, unit_price, material_cost
        - LaborRate: rate_id, rate_name, rate_description, rate_amount, rate_type
        
        Always validate required fields and generate proper IDs (e.g., CUST-001, PROD-001, etc.)
        """
    
    def _get_sql_agent_prompt(self) -> str:
        return """
        You are a SQL Agent for a financial forecasting system. Your role is to:
        1. Execute SQL queries safely and efficiently
        2. Analyze data and provide insights
        3. Generate reports and summaries
        4. Handle complex joins and aggregations
        
        Available tables:
        - customers: customer_id, customer_name, customer_type, region
        - units: unit_id, unit_name, unit_description, base_price, unit_type, bom_id, router_id
        - sales: sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id
        - machines: machine_id, machine_name, machine_description, machine_rate, available_minutes_per_month
        - bom: bom_id, version, bom_line, material_description, qty, unit, unit_price, material_cost
        - routers: router_id, version, unit_id, machine_id, machine_minutes, labor_minutes, labor_type_id
        - labor_rates: rate_id, rate_name, rate_description, rate_amount, rate_type
        - payroll: employee_id, employee_name, weekly_hours, hourly_rate, labor_type
        
        Always use parameterized queries and validate SQL before execution.
        """
    
    def _get_update_agent_prompt(self) -> str:
        return """
        You are an Update Agent for a financial forecasting system. Your role is to:
        1. Update existing database records safely
        2. Handle bulk updates and data modifications
        3. Validate changes before applying
        4. Provide confirmation of updates
        
        Common update operations:
        - Increase/decrease sales quantities
        - Update pricing across products
        - Modify customer information
        - Adjust machine capacities
        - Update BOM costs
        
        Always validate record existence before updating and use transactions for bulk operations.
        """
    
    async def process_message(self, message: str, user_id: str = None) -> Dict[str, Any]:
        """Process a user message through the agent system"""
        try:
            # Add user message to conversation history
            user_msg = ConversationMessage(
                role="user",
                content=message,
                metadata={"user_id": user_id}
            )
            self.conversation_history.append(user_msg)
            
            # If no OpenAI client, use fallback
            if not self.client:
                return await self._fallback_processing(message, user_id)
            
            # Process with current agent
            response = await self._process_with_agent(message, self.current_agent)
            
            # Add assistant response to history
            assistant_msg = ConversationMessage(
                role="assistant",
                content=response.get("content", ""),
                agent_type=self.current_agent,
                metadata=response.get("metadata", {})
            )
            self.conversation_history.append(assistant_msg)
            
            return response
            
        except Exception as e:
            error_response = {
                "content": f"I encountered an error: {str(e)}",
                "agent": self.current_agent,
                "error": True,
                "metadata": {"error_type": type(e).__name__}
            }
            return error_response
    
    async def _process_with_agent(self, message: str, agent_name: str) -> Dict[str, Any]:
        """Process message with specified agent"""
        agent_config = self.agents.get(agent_name)
        if not agent_config:
            return {"content": f"Unknown agent: {agent_name}", "error": True}
        
        # Build conversation context
        messages = [
            {"role": "system", "content": agent_config["system_prompt"]}
        ]
        
        # Add recent conversation history
        for msg in self.conversation_history[-5:]:  # Last 5 messages for context
            messages.append({
                "role": msg.role,
                "content": msg.content
            })
        
        # Add current message
        messages.append({"role": "user", "content": message})
        
        try:
            # Call OpenAI API
            response = self.client.chat.completions.create(
                model="gpt-4",
                messages=messages,
                temperature=0.7,
                max_tokens=1000
            )
            
            content = response.choices[0].message.content
            
            # Check if agent wants to hand off
            handoff = self._check_for_handoff(content)
            if handoff:
                return await self._handle_handoff(handoff, message)
            
            # Check if agent wants to execute functions
            function_call = self._check_for_function_call(content, agent_name)
            if function_call:
                return await self._execute_function(function_call, message)
            
            return {
                "content": content,
                "agent": agent_name,
                "timestamp": datetime.now().isoformat(),
                "metadata": {
                    "model": "gpt-4",
                    "tokens_used": response.usage.total_tokens
                }
            }
            
        except Exception as e:
            return {
                "content": f"Error processing with {agent_name}: {str(e)}",
                "agent": agent_name,
                "error": True
            }
    
    def _check_for_handoff(self, content: str) -> Optional[AgentHandoff]:
        """Check if the response indicates a handoff to another agent"""
        handoff_keywords = {
            "creation_agent": ["create", "add", "new"],
            "sql_agent": ["query", "analyze", "report", "data"],
            "update_agent": ["update", "modify", "change", "increase", "decrease"]
        }
        
        content_lower = content.lower()
        
        for agent, keywords in handoff_keywords.items():
            if any(keyword in content_lower for keyword in keywords):
                if f"handoff to {agent}" in content_lower or f"transfer to {agent}" in content_lower:
                    return AgentHandoff(
                        target_agent=agent,
                        context=content,
                        user_request=self.conversation_history[-1].content if self.conversation_history else "",
                        data_gathered={}
                    )
        
        return None
    
    def _check_for_function_call(self, content: str, agent_name: str) -> Optional[Dict[str, Any]]:
        """Check if the response indicates a function call"""
        agent_config = self.agents.get(agent_name, {})
        functions = agent_config.get("functions", [])
        
        content_lower = content.lower()
        
        for function in functions:
            if function in content_lower:
                return {
                    "function": function,
                    "agent": agent_name,
                    "content": content
                }
        
        return None
    
    async def _handle_handoff(self, handoff: AgentHandoff, original_message: str) -> Dict[str, Any]:
        """Handle agent handoff"""
        self.current_agent = handoff.target_agent
        
        # Process with new agent
        return await self._process_with_agent(original_message, handoff.target_agent)
    
    async def _execute_function(self, function_call: Dict[str, Any], message: str) -> Dict[str, Any]:
        """Execute a function call"""
        function_name = function_call["function"]
        agent_name = function_call["agent"]
        
        try:
            if function_name == "execute_query":
                return await self._execute_sql_query(message)
            elif function_name in ["create_customer", "create_product", "create_forecast", "create_machine", "create_bom"]:
                return await self._create_record(function_name, message)
            elif function_name in ["update_sales", "update_pricing", "update_quantities", "bulk_update"]:
                return await self._update_record(function_name, message)
            else:
                return {
                    "content": f"Function {function_name} not implemented yet",
                    "agent": agent_name,
                    "function": function_name
                }
        except Exception as e:
            return {
                "content": f"Error executing {function_name}: {str(e)}",
                "agent": agent_name,
                "error": True
            }
    
    async def _execute_sql_query(self, message: str) -> Dict[str, Any]:
        """Execute SQL query safely"""
        if not execute_sql:
            return {
                "content": "Database functions not available. Please ensure database is properly configured.",
                "agent": "sql_agent",
                "error": True
            }
        
        # Simple SQL extraction - in production, use better parsing
        if "SELECT" in message.upper():
            # Extract SQL query from message
            sql_start = message.upper().find("SELECT")
            sql_query = message[sql_start:].split(";")[0] + ";"
            
            try:
                result = execute_sql(sql_query, description="Agent SQL Query")
                
                if result["status"] == "success":
                    return {
                        "content": f"Query executed successfully. Found {len(result.get('data', []))} rows.",
                        "agent": "sql_agent",
                        "data": result.get("data", []),
                        "sql_query": sql_query
                    }
                else:
                    return {
                        "content": f"Query failed: {result.get('error', 'Unknown error')}",
                        "agent": "sql_agent",
                        "error": True
                    }
            except Exception as e:
                return {
                    "content": f"SQL execution error: {str(e)}",
                    "agent": "sql_agent",
                    "error": True
                }
        else:
            return {
                "content": "Please provide a valid SQL SELECT query.",
                "agent": "sql_agent",
                "error": True
            }
    
    async def _create_record(self, function_name: str, message: str) -> Dict[str, Any]:
        """Create a new database record"""
        # Placeholder implementation - would need proper parsing
        return {
            "content": f"Record creation for {function_name} would be implemented here. Message: {message}",
            "agent": "creation_agent",
            "function": function_name,
            "placeholder": True
        }
    
    async def _update_record(self, function_name: str, message: str) -> Dict[str, Any]:
        """Update existing database record"""
        # Placeholder implementation - would need proper parsing
        return {
            "content": f"Record update for {function_name} would be implemented here. Message: {message}",
            "agent": "update_agent",
            "function": function_name,
            "placeholder": True
        }
    
    async def _fallback_processing(self, message: str, user_id: str = None) -> Dict[str, Any]:
        """Fallback processing when OpenAI is not available"""
        return {
            "content": "OpenAI API is not configured. Please set up the API key to use the AI agents.",
            "agent": "fallback",
            "error": True,
            "metadata": {"requires_openai": True}
        }
    
    def get_conversation_history(self) -> List[Dict[str, Any]]:
        """Get conversation history"""
        return [
            {
                "role": msg.role,
                "content": msg.content,
                "timestamp": msg.timestamp.isoformat(),
                "agent_type": msg.agent_type,
                "metadata": msg.metadata
            }
            for msg in self.conversation_history
        ]
    
    def clear_conversation(self):
        """Clear conversation history"""
        self.conversation_history = []
        self.current_agent = "chat_agent"
    
    def get_available_agents(self) -> Dict[str, Dict[str, Any]]:
        """Get information about available agents"""
        return {
            name: {
                "name": config["name"],
                "description": config["description"],
                "functions": config["functions"]
            }
            for name, config in self.agents.items()
        }

# Global service instance
openai_agents_service = OpenAIAgentsService()

# API request models
class AgentChatRequest(BaseModel):
    message: str = Field(..., description="User message")
    user_id: Optional[str] = Field(None, description="User ID for tracking")
    agent: Optional[str] = Field(None, description="Specific agent to use")

class AgentResponse(BaseModel):
    content: str = Field(..., description="Agent response")
    agent: str = Field(..., description="Agent that processed the request")
    timestamp: str = Field(..., description="Response timestamp")
    error: bool = Field(False, description="Whether an error occurred")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")

async def process_agent_chat(request: AgentChatRequest) -> AgentResponse:
    """Process chat request through agent system"""
    try:
        # Set specific agent if requested
        if request.agent and request.agent in openai_agents_service.agents:
            openai_agents_service.current_agent = request.agent
        
        # Process message
        result = await openai_agents_service.process_message(request.message, request.user_id)
        
        return AgentResponse(
            content=result.get("content", ""),
            agent=result.get("agent", "unknown"),
            timestamp=result.get("timestamp", datetime.now().isoformat()),
            error=result.get("error", False),
            metadata=result.get("metadata", {})
        )
        
    except Exception as e:
        return AgentResponse(
            content=f"Error processing chat: {str(e)}",
            agent="error_handler",
            timestamp=datetime.now().isoformat(),
            error=True,
            metadata={"error_type": type(e).__name__}
        )

def get_conversation_history() -> List[Dict[str, Any]]:
    """Get conversation history"""
    return openai_agents_service.get_conversation_history()

def clear_conversation():
    """Clear conversation history"""
    openai_agents_service.clear_conversation()

def get_available_agents() -> Dict[str, Dict[str, Any]]:
    """Get available agents"""
    return openai_agents_service.get_available_agents()