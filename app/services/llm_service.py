import httpx
import json
import asyncio
from typing import Dict, Any, Optional, List
from pydantic import BaseModel
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class LLMRequest(BaseModel):
    """Request model for LLM service"""
    message: str
    context: Optional[Dict[str, Any]] = None
    temperature: Optional[float] = 0.1
    max_tokens: Optional[int] = 1000

class LLMResponse(BaseModel):
    """Response model for LLM service"""
    sql_statement: str
    explanation: str
    confidence: float
    requires_approval: bool
    suggested_actions: List[str]
    error: Optional[str] = None

class DatabaseSchema:
    """Database schema information for LLM context"""
    
    TABLES = {
        "customers": {
            "description": "Customer information and metadata",
            "columns": {
                "customer_id": "TEXT PRIMARY KEY - Unique customer identifier",
                "customer_name": "TEXT NOT NULL - Customer company name",
                "customer_type": "TEXT - Type of customer (Manufacturing, Technology, etc.)",
                "region": "TEXT - Geographic region"
            }
        },
        "units": {
            "description": "Product/unit information for manufacturing",
            "columns": {
                "unit_id": "TEXT PRIMARY KEY - Unique unit identifier",
                "unit_name": "TEXT NOT NULL - Product name",
                "unit_description": "TEXT - Detailed product description",
                "base_price": "REAL - Standard unit price",
                "unit_type": "TEXT - Product category (Component, Assembly, Electronics)"
            }
        },
        "sales": {
            "description": "Sales transactions with customer and unit relationships",
            "columns": {
                "sale_id": "TEXT PRIMARY KEY - Unique sale identifier",
                "customer_id": "TEXT FOREIGN KEY - Reference to customers table",
                "unit_id": "TEXT FOREIGN KEY - Reference to units table",
                "period": "TEXT - Sales period (YYYY-MM)",
                "quantity": "INTEGER - Number of units sold",
                "unit_price": "REAL - Actual sale price per unit",
                "total_revenue": "REAL - Total revenue for this sale"
            }
        },
        "bom": {
            "description": "Bill of Materials - links units to their manufacturing routers",
            "columns": {
                "bom_id": "TEXT PRIMARY KEY - Unique BOM identifier",
                "unit_id": "TEXT FOREIGN KEY - Reference to units table",
                "router_id": "TEXT - Manufacturing router identifier",
                "material_cost": "REAL - Total material cost per unit"
            }
        },
        "routers": {
            "description": "Manufacturing routing information - defines the production steps",
            "columns": {
                "router_id": "TEXT PRIMARY KEY - Router identifier",
                "unit_id": "TEXT FOREIGN KEY - Reference to units table",
                "machine_id": "TEXT FOREIGN KEY - Reference to machines table",
                "machine_minutes": "INTEGER - Machine time required",
                "labor_minutes": "INTEGER - Labor time required",
                "sequence": "INTEGER - Production step sequence"
            }
        },
        "machines": {
            "description": "Manufacturing equipment and their rates",
            "columns": {
                "machine_id": "TEXT PRIMARY KEY - Unique machine identifier",
                "machine_name": "TEXT NOT NULL - Machine name",
                "machine_description": "TEXT - Detailed machine description",
                "machine_rate": "REAL - Hourly machine rate",
                "labor_type": "TEXT - Type of labor required"
            }
        },
        "labor_rates": {
            "description": "Standard labor rates by type",
            "columns": {
                "rate_id": "TEXT PRIMARY KEY - Unique rate identifier",
                "rate_name": "TEXT NOT NULL - Rate name",
                "rate_description": "TEXT - Detailed rate description",
                "rate_amount": "REAL - Hourly rate amount",
                "rate_type": "TEXT - Rate type (Hourly, etc.)"
            }
        },
        "payroll": {
            "description": "Employee information and costs",
            "columns": {
                "employee_id": "TEXT PRIMARY KEY - Unique employee identifier",
                "employee_name": "TEXT NOT NULL - Employee name",
                "weekly_hours": "INTEGER - Standard weekly hours",
                "hourly_rate": "REAL - Employee hourly rate",
                "labor_type": "TEXT - Type of labor performed",
                "start_date": "TEXT - Employment start date",
                "end_date": "TEXT - Employment end date"
            }
        }
    }
    
    @classmethod
    def get_schema_context(cls) -> str:
        """Get formatted schema context for LLM"""
        context = "Database Schema:\n\n"
        for table_name, table_info in cls.TABLES.items():
            context += f"Table: {table_name}\n"
            context += f"Description: {table_info['description']}\n"
            context += "Columns:\n"
            for col_name, col_desc in table_info['columns'].items():
                context += f"  - {col_name}: {col_desc}\n"
            context += "\n"
        return context

class LLMService:
    """Service for interacting with Ollama LLM to generate SQL"""
    
    def __init__(self, ollama_url: str = "http://ollama:11434", model: str = "llama3.1"):
        self.ollama_url = ollama_url
        self.model = model
        self.schema_context = DatabaseSchema.get_schema_context()
        
    async def generate_sql(self, request: LLMRequest) -> LLMResponse:
        """Generate SQL statement from natural language request"""
        try:
            # Build the prompt with schema context
            prompt = self._build_prompt(request.message, request.context)
            
            # Call Ollama API
            response = await self._call_ollama(prompt, request.temperature, request.max_tokens)
            
            # Parse the response
            return self._parse_llm_response(response, request.message)
            
        except Exception as e:
            logger.error(f"Error generating SQL: {str(e)}")
            return LLMResponse(
                sql_statement="",
                explanation=f"Error generating SQL: {str(e)}",
                confidence=0.0,
                requires_approval=True,
                suggested_actions=[],
                error=str(e)
            )
    
    def _build_prompt(self, message: str, context: Optional[Dict[str, Any]] = None) -> str:
        """Build the prompt for the LLM"""
        
        # Base system prompt
        system_prompt = """You are an expert SQL assistant for a financial forecasting database. Your job is to convert natural language requests into SQL statements that modify the forecast data.

IMPORTANT RULES:
1. Always use UPDATE or INSERT statements for modifications
2. Be very careful with WHERE clauses to avoid unintended changes
3. Use transactions when making multiple related changes
4. Always include a comment explaining what the SQL does
5. Return ONLY valid SQL - no explanations in the SQL itself
6. Use proper SQL syntax for SQLite
7. Be conservative - prefer specific WHERE clauses over broad changes

Common operations you should handle:
- Increase/decrease unit prices for specific periods or customers
- Modify sales quantities by customer and period
- Update material costs, machine rates, or labor rates
- Adjust manufacturing times (machine_minutes, labor_minutes)
- Add new sales records or modify existing ones

Example patterns:
- "Increase unit prices by 10% for all sales in 2024-01" → UPDATE sales SET unit_price = unit_price * 1.1 WHERE period = '2024-01';
- "Decrease sales quantity by 20% for customer CUST-001 in 2024-02" → UPDATE sales SET quantity = quantity * 0.8 WHERE customer_id = 'CUST-001' AND period = '2024-02';
- "Set material cost to $50 for unit PROD-001" → UPDATE bom SET material_cost = 50.0 WHERE unit_id = 'PROD-001';

Database Schema:
"""
        
        # Add schema context
        prompt = system_prompt + self.schema_context
        
        # Add user context if provided
        if context:
            prompt += f"\nAdditional Context:\n{json.dumps(context, indent=2)}\n"
        
        # Add the user's request
        prompt += f"\nUser Request: {message}\n\nGenerate SQL:"
        
        return prompt
    
    async def _call_ollama(self, prompt: str, temperature: float = 0.1, max_tokens: int = 1000) -> str:
        """Call the Ollama API"""
        async with httpx.AsyncClient(timeout=30.0) as client:
            payload = {
                "model": self.model,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": temperature,
                    "num_predict": max_tokens
                }
            }
            
            response = await client.post(
                f"{self.ollama_url}/api/generate",
                json=payload
            )
            
            if response.status_code != 200:
                raise Exception(f"Ollama API error: {response.status_code} - {response.text}")
            
            result = response.json()
            return result.get("response", "")
    
    def _parse_llm_response(self, response: str, original_message: str) -> LLMResponse:
        """Parse the LLM response and extract SQL and explanation"""
        try:
            # Clean up the response
            response = response.strip()
            
            # Extract SQL statement (look for SQL keywords)
            sql_statement = self._extract_sql(response)
            
            # Generate explanation
            explanation = self._generate_explanation(sql_statement, original_message)
            
            # Determine confidence and approval requirements
            confidence = self._assess_confidence(sql_statement, response)
            requires_approval = self._requires_approval(sql_statement)
            
            # Generate suggested actions
            suggested_actions = self._generate_suggested_actions(sql_statement)
            
            return LLMResponse(
                sql_statement=sql_statement,
                explanation=explanation,
                confidence=confidence,
                requires_approval=requires_approval,
                suggested_actions=suggested_actions
            )
            
        except Exception as e:
            logger.error(f"Error parsing LLM response: {str(e)}")
            return LLMResponse(
                sql_statement="",
                explanation=f"Error parsing response: {str(e)}",
                confidence=0.0,
                requires_approval=True,
                suggested_actions=[],
                error=str(e)
            )
    
    def _extract_sql(self, response: str) -> str:
        """Extract SQL statement from LLM response"""
        # Look for SQL keywords and extract the statement
        sql_keywords = ["SELECT", "UPDATE", "INSERT", "DELETE", "CREATE", "ALTER", "DROP"]
        
        lines = response.split('\n')
        sql_lines = []
        in_sql = False
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
                
            # Check if line contains SQL keywords
            if any(keyword in line.upper() for keyword in sql_keywords):
                in_sql = True
                sql_lines.append(line)
            elif in_sql and line.endswith(';'):
                sql_lines.append(line)
                break
            elif in_sql and not line.startswith('--'):
                sql_lines.append(line)
        
        sql_statement = ' '.join(sql_lines)
        
        # If no SQL found, try to extract from the entire response
        if not sql_statement:
            # Look for SQL-like patterns
            import re
            sql_pattern = r'((?:SELECT|UPDATE|INSERT|DELETE|CREATE|ALTER|DROP).*?;)'
            matches = re.findall(sql_pattern, response, re.IGNORECASE | re.DOTALL)
            if matches:
                sql_statement = matches[0]
        
        return sql_statement.strip()
    
    def _generate_explanation(self, sql_statement: str, original_message: str) -> str:
        """Generate a human-readable explanation of the SQL"""
        if not sql_statement:
            return "No valid SQL statement could be generated from the request."
        
        explanation = f"Based on your request '{original_message}', I've generated the following SQL statement:\n\n"
        explanation += f"```sql\n{sql_statement}\n```\n\n"
        
        # Add specific explanation based on SQL type
        sql_upper = sql_statement.upper()
        if "UPDATE" in sql_upper:
            explanation += "This UPDATE statement will modify existing records in the database. "
            if "WHERE" in sql_upper:
                explanation += "The WHERE clause ensures only specific records are affected. "
            else:
                explanation += "⚠️ WARNING: No WHERE clause found - this will affect ALL records in the table! "
        elif "INSERT" in sql_upper:
            explanation += "This INSERT statement will add new records to the database. "
        elif "DELETE" in sql_upper:
            explanation += "This DELETE statement will remove records from the database. "
            explanation += "⚠️ WARNING: Please review carefully before applying! "
        
        explanation += "\n\nPlease review the SQL statement above and approve it before execution."
        
        return explanation
    
    def _assess_confidence(self, sql_statement: str, response: str) -> float:
        """Assess confidence level in the generated SQL"""
        if not sql_statement:
            return 0.0
        
        confidence = 0.5  # Base confidence
        
        # Increase confidence for well-formed SQL
        if sql_statement.endswith(';'):
            confidence += 0.1
        
        if 'WHERE' in sql_statement.upper():
            confidence += 0.2
        
        if any(keyword in sql_statement.upper() for keyword in ['UPDATE', 'INSERT', 'DELETE']):
            confidence += 0.1
        
        # Decrease confidence for potentially dangerous operations
        if 'DELETE' in sql_statement.upper():
            confidence -= 0.2
        
        if 'UPDATE' in sql_statement.upper() and 'WHERE' not in sql_statement.upper():
            confidence -= 0.3
        
        return max(0.0, min(1.0, confidence))
    
    def _requires_approval(self, sql_statement: str) -> bool:
        """Determine if the SQL requires explicit approval"""
        if not sql_statement:
            return True
        
        sql_upper = sql_statement.upper()
        
        # Always require approval for dangerous operations
        if 'DELETE' in sql_upper:
            return True
        
        if 'UPDATE' in sql_upper and 'WHERE' not in sql_upper:
            return True
        
        if 'DROP' in sql_upper or 'ALTER' in sql_upper:
            return True
        
        return True  # Always require approval for safety
    
    def _generate_suggested_actions(self, sql_statement: str) -> List[str]:
        """Generate suggested actions for the user"""
        actions = []
        
        if not sql_statement:
            actions.append("Review the request and try rephrasing it")
            actions.append("Check if the request is clear and specific")
            return actions
        
        sql_upper = sql_statement.upper()
        
        if 'UPDATE' in sql_upper:
            actions.append("Review the WHERE clause to ensure correct records are targeted")
            actions.append("Consider running a SELECT query first to preview affected records")
        
        if 'INSERT' in sql_upper:
            actions.append("Verify the data values are correct")
            actions.append("Check for any required fields that might be missing")
        
        if 'DELETE' in sql_upper:
            actions.append("⚠️ Double-check the WHERE clause - this operation cannot be undone")
            actions.append("Consider backing up the database before proceeding")
        
        actions.append("Review the SQL syntax for correctness")
        actions.append("Test the SQL in a development environment if possible")
        
        return actions

# Global instance
llm_service = LLMService() 