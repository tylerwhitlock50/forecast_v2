from __future__ import annotations

import asyncio
from typing import Optional, Dict, Any

from langchain_community.llms.ollama import Ollama
from langchain_community.utilities.sql_database import SQLDatabase
from langchain_community.agent_toolkits.sql.toolkit import SQLDatabaseToolkit
from langchain.agents import initialize_agent, AgentType
from langchain.memory import ConversationBufferWindowMemory

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
        # session_id can be provided in context or separately


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
        self.session_history_size = 6
        self.sessions: Dict[str, Any] = {}
        self._setup_shared()

    def _setup_shared(self) -> None:
        """Initialize shared LLM, database connection and tools."""
        self.llm = Ollama(base_url=self.ollama_url, model=self.model)
        self.db = SQLDatabase.from_uri(f"sqlite:///{self.database_path}")

        self.toolkit = SQLDatabaseToolkit(db=self.db, llm=self.llm)
        self.system_prefix = f"{AGENT_SYSTEM_PROMPT}\n\n{self.schema_context}"

    def _create_agent(self) -> Any:
        memory = ConversationBufferWindowMemory(
            k=self.session_history_size,
            return_messages=True,
            memory_key="chat_history",
        )

        agent = initialize_agent(
            tools=self.toolkit.get_tools(),
            llm=self.llm,
            agent=AgentType.ZERO_SHOT_REACT_DESCRIPTION,
            verbose=True,
            agent_kwargs={"prefix": self.system_prefix},
            memory=memory,
        )
        return agent

    def _get_agent(self, session_id: str) -> Any:
        if session_id not in self.sessions:
            self.sessions[session_id] = self._create_agent()
        return self.sessions[session_id]

    async def run(self, request: AgentRequest) -> str:
        """Run the agent with the given request."""
        import json

        session_id = request.context.get("session_id", "default")
        agent = self._get_agent(session_id)

        prompt = request.message
        context = {k: v for k, v in request.context.items() if k != "session_id"}
        if context:
            prompt += f"\nContext:\n{json.dumps(context, indent=2)}"

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, agent.run, prompt)
        return result if isinstance(result, str) else str(result)


# Global instance used by FastAPI
agent_service = AgentService()
