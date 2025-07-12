from __future__ import annotations

import asyncio
from typing import Optional, Dict, Any

from langchain_community.agent_toolkits.sql.base import create_sql_agent
from langchain_community.llms.ollama import Ollama
from langchain_community.utilities.sql_database import SQLDatabase

from .llm_service import DatabaseSchema

# Basic system prompt for the agent. Must contain the `dialect` and `top_k`
# placeholders expected by `create_sql_agent` so the helper can correctly
# initialize the underlying LangChain prompt.
AGENT_SYSTEM_PROMPT = (
    "You are an operational assistant for a financial forecasting database. "
    "You can query the database and make modifications using SQL. "
    "When a request is ambiguous, ask clarifying questions before executing any "
    "SQL. Use the {dialect} dialect and limit SELECT queries to at most {top_k} "
    "rows unless instructed otherwise."
)


class AgentRequest:
    """Simple request model for the agent service"""

    def __init__(self, message: str, context: Optional[Dict[str, Any]] = None):
        self.message = message
        self.context = context or {}


class AgentService:
    """Agentic interface that can reason over the database using LangChain."""

    def __init__(
        self,
        database_path: str = "./data/forecast.db",
        ollama_url: str = "http://ollama:11434",
        model: str = "llama3.1",
    ) -> None:
        self.database_path = database_path
        self.ollama_url = ollama_url
        self.model = model
        # Prepare schema context once so it can be inserted into the prompt
        self.schema_context = DatabaseSchema.get_schema_context()
        self._setup_agent()

    def _setup_agent(self) -> None:
        llm = Ollama(base_url=self.ollama_url, model=self.model)
        db = SQLDatabase.from_uri(f"sqlite:///{self.database_path}")

        # Combine the generic system prompt with the database schema so the agent
        # has immediate knowledge of the available tables and columns.
        prefix = f"{AGENT_SYSTEM_PROMPT}\n\n{self.schema_context}"

        # create_sql_agent returns a chain that can execute natural language queries
        self.agent = create_sql_agent(llm=llm, db=db, prefix=prefix, verbose=True)

    async def run(self, request: AgentRequest) -> str:
        """Run the agent with the given request."""
        import json

        prompt = request.message
        if request.context:
            prompt += f"\nContext:\n{json.dumps(request.context, indent=2)}"

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, self.agent.invoke, prompt)
        if isinstance(result, dict) and "output" in result:
            return result["output"]
        return str(result)


# Global instance used by FastAPI
agent_service = AgentService()
