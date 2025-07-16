from __future__ import annotations

import asyncio
import os
from typing import Optional, Dict, Any

from langchain_ollama import OllamaLLM
from langchain_community.utilities.sql_database import SQLDatabase
from langchain_community.agent_toolkits.sql.toolkit import SQLDatabaseToolkit
from langchain.agents import AgentExecutor, create_react_agent
from langchain_core.prompts import PromptTemplate


from .llm_service import DatabaseSchema

# Basic system prompt for the agent. Must contain the `dialect` and `top_k`
# placeholders expected by `create_sql_agent` so the helper can correctly
# initialize the underlying LangChain prompt.
AGENT_SYSTEM_PROMPT = (
    """You are an operational assistant for a financial forecasting database.

You can:
- Query data using SQL (use SQLite dialect, max 10 rows unless specified)
- Modify data using `UPDATE`, `INSERT`, or `DELETE` when required

When given a goal (e.g., "increase July revenue by $100k"):
- Query the current data to understand the gap
- Recommend specific changes that would close the gap
- Use `UPDATE` statements to adjust `quantity` or `unit_price`
- Only update data in the `forecast_results` table (not historical `sales`)
- Avoid wild changes; adjust a few rows with plausible deltas
- Include a `WHERE` clause with `period = '2024-07'` or matching

Only return valid SQL unless explicitly asked for explanation."""
)


class AgentRequest:
    """Simple request model for the agent service"""

    def __init__(self, message: str, context: Optional[Dict[str, Any]] = None):
        self.message = message
        self.context = context or {}
        # session_id can be provided in context or separately


class AgentService:
    """Agentic interface that can reason over the database using LangChain."""

    def __init__(
        self,
        database_path: str = None,
        ollama_url: str = "http://ollama:11434",
        model: str = "llama3.1",
    ) -> None:
        # Use local paths for development, Docker paths for production
        if database_path is None:
            if os.path.exists('/data'):  # Docker environment
                self.database_path = '/data/forecast.db'
            else:  # Local development
                self.database_path = './data/forecast.db'
        else:
            self.database_path = database_path
            
        self.ollama_url = ollama_url
        self.model = model
        # Prepare schema context once so it can be inserted into the prompt
        self.schema_context = DatabaseSchema.get_schema_context()
        self.session_history_size = 6
        self.sessions: Dict[str, Any] = {}
        self._setup_shared()

    def _setup_shared(self) -> None:
        """Initialize shared LLM, database connection and tools."""
        self.llm = OllamaLLM(base_url=self.ollama_url, model=self.model)
        self.db = SQLDatabase.from_uri(f"sqlite:///{self.database_path}")

        self.toolkit = SQLDatabaseToolkit(db=self.db, llm=self.llm)
        self.system_prefix = f"{AGENT_SYSTEM_PROMPT}\n\n{self.schema_context}"

    def _create_agent(self) -> Any:
        import logging
        logger = logging.getLogger(__name__)
        logger.info("Creating new agent instance...")
        
        # Create prompt template with required React agent variables
        prompt = PromptTemplate.from_template(f"""{self.system_prefix}

You have access to the following tools:
{{tools}}

Use the following format:

Question: the input question you must answer
Thought: you should always think about what to do
Action: the action to take, should be one of [{{tool_names}}]
Action Input: the input to the action
Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat N times)
Thought: I now know the final answer
Final Answer: the final answer to the original input question

IMPORTANT: Only provide ONE response format at a time. Either continue with Thought/Action OR provide Final Answer, but never both.

Question: {{input}}
Thought: {{agent_scratchpad}}""")

        # Create agent using newer API
        logger.info("Creating React agent...")
        agent = create_react_agent(
            llm=self.llm,
            tools=self.toolkit.get_tools(),
            prompt=prompt
        )

        # Wrap in executor with error handling
        logger.info("Creating AgentExecutor...")
        agent_executor = AgentExecutor(
            agent=agent,
            tools=self.toolkit.get_tools(),
            verbose=True,
            handle_parsing_errors=True,  # Handle parsing errors gracefully
            max_iterations=10  # Limit iterations to prevent infinite loops
        )
        logger.info("Agent creation completed successfully")
        return agent_executor

    def _get_agent(self, session_id: str) -> Any:
        if session_id not in self.sessions:
            self.sessions[session_id] = self._create_agent()
        return self.sessions[session_id]

    async def run(self, request: AgentRequest) -> str:
        """Run the agent with the given request."""
        import json
        import logging

        logger = logging.getLogger(__name__)

        try:
            session_id = request.context.get("session_id", "default")
            logger.info(f"Agent service starting for session: {session_id}")
            logger.info(f"Request message: {request.message[:100]}...")
            logger.info(f"Request context: {request.context}")
            
            logger.info(f"Getting agent for session: {session_id}")
            agent = self._get_agent(session_id)

            prompt = request.message
            #logger.debug(f"Agent full system prompt:\n{prompt.template}")
            context = {k: v for k, v in request.context.items() if k != "session_id"}
            if context:
                prompt += f"\nContext:\n{json.dumps(context, indent=2)}"

            logger.info(f"Final prompt length: {len(prompt)} characters")
            logger.info(f"Running agent with prompt: {prompt[:200]}...")
            logger.info(f"Agent type: {type(agent)}")

            loop = asyncio.get_event_loop()
            logger.info("Starting agent execution...")
            # Use invoke instead of run to avoid deprecation warning
            result = await loop.run_in_executor(None, lambda: agent.invoke({"input": prompt}))
            
            logger.info(f"Agent execution completed")
            logger.info(f"Agent result type: {type(result)}")
            logger.info(f"Agent result length: {len(str(result))} characters")
            logger.debug(f"Agent result: {result}")
            
            output = result.get("output", str(result)) if isinstance(result, dict) else str(result)
            logger.info(f"Returning output length: {len(output)} characters")
            return output
            
        except Exception as e:
            logger.error(f"Error in agent execution: {str(e)}")
            logger.error(f"Error type: {type(e)}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            raise


# Global instance used by FastAPI
agent_service = AgentService()
