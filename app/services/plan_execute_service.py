from __future__ import annotations

import asyncio
import httpx
from typing import Dict, Any, Optional, List

from .agent_service import AgentService, AgentRequest


class PlanAndExecuteService:
    """Service that plans with one model and executes with another."""

    def __init__(
        self,
        agent_service: AgentService,
        ollama_url: str = "http://ollama:11434",
        planning_model: str = "deepseek:r1",
    ) -> None:
        self.agent_service = agent_service
        self.ollama_url = ollama_url
        self.planning_model = planning_model

    async def _call_ollama(
        self, model: str, prompt: str, temperature: float = 0.2, max_tokens: int = 500
    ) -> str:
        """Call the Ollama API with the given model and prompt."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            payload = {
                "model": model,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": temperature, "num_predict": max_tokens},
            }
            response = await client.post(f"{self.ollama_url}/api/generate", json=payload)
            if response.status_code != 200:
                raise Exception(f"Ollama API error: {response.status_code} - {response.text}")
            result = response.json()
            return result.get("response", "")

    async def _generate_plan(self, message: str) -> List[str]:
        """Generate a numbered plan for the given message."""
        prompt = (
            "You are a planning assistant. Break down the following request into a"
            " concise numbered list of steps.\nRequest:" + message + "\nPlan:"
        )
        plan_text = await self._call_ollama(self.planning_model, prompt)
        steps = [step.strip("- ") for step in plan_text.split("\n") if step.strip()]
        return steps

    async def run(self, request: AgentRequest) -> Dict[str, Any]:
        """Plan with DeepSeek and execute each step with the Llama agent."""
        steps = await self._generate_plan(request.message)
        results = []
        for step in steps:
            step_request = AgentRequest(message=step, context=request.context)
            res = await self.agent_service.run(step_request)
            results.append({"step": step, "result": res})
        return {"plan": steps, "results": results}


# Global instance used by FastAPI
from .agent_service import agent_service

plan_execute_service = PlanAndExecuteService(agent_service)
