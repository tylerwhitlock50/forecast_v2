from __future__ import annotations

import asyncio

from typing import Dict, Any, Optional, List, TypedDict

from langgraph.graph import StateGraph, END


from .agent_service import AgentService, AgentRequest



class HumanApproval:
    """Placeholder human approval step."""

    async def approve(self, step: str) -> bool:
        # In production this would involve prompting a real human.
        # For now, automatically approve and log the step.
        print(f"[HUMAN REVIEW] Approving step: {step}")
        return True
class PlanAndExecuteService:
    """Service that plans with one model and executes with another."""

    def __init__(
        self,
        agent_service: AgentService,
        ollama_url: str = "http://ollama:11434",
        planning_model: str = "deepseek:r1",

        human_approval: Optional[HumanApproval] = None,

    ) -> None:
        self.agent_service = agent_service
        self.ollama_url = ollama_url
        self.planning_model = planning_model

        self.human_approval = human_approval or HumanApproval()
        self.graph = self._build_graph()

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


    def _build_graph(self):
        """Create the LangGraph state machine."""

        class GraphState(TypedDict, total=False):
            request: AgentRequest
            plan: List[str]
            results: List[Dict[str, Any]]
            step: int
            approved: bool

        async def plan_node(state: GraphState, config) -> GraphState:
            steps = await self._generate_plan(state["request"].message)
            state["plan"] = steps
            state["results"] = []
            state["step"] = 0
            return state

        async def approval_node(state: GraphState, config) -> GraphState:
            step_text = state["plan"][state["step"]]
            if any(k in step_text.upper() for k in ["UPDATE", "DELETE", "DROP", "TRUNCATE"]):
                state["approved"] = await self.human_approval.approve(step_text)
            else:
                state["approved"] = True
            return state

        async def execute_node(state: GraphState, config) -> GraphState:
            step_text = state["plan"][state["step"]]
            if not state.get("approved", True):
                result = "rejected"
            else:
                req = AgentRequest(message=step_text, context=state["request"].context)
                result = await self.agent_service.run(req)
            state.setdefault("results", []).append({"step": step_text, "result": result})
            state["step"] += 1
            return state

        def should_continue(state: GraphState) -> str:
            return "continue" if state.get("step", 0) < len(state.get("plan", [])) else "end"

        builder = StateGraph(GraphState)
        builder.add_node("plan", plan_node)
        builder.add_node("approval", approval_node)
        builder.add_node("execute", execute_node)
        builder.set_entry_point("plan")
        builder.add_edge("plan", "approval")
        builder.add_edge("approval", "execute")
        builder.add_conditional_edges("execute", should_continue, {"continue": "approval", "end": END})

        return builder.compile()

    async def run(self, request: AgentRequest) -> Dict[str, Any]:
        """Run the planning and execution graph."""
        final_state = await self.graph.invoke({"request": request})
        return {"plan": final_state.get("plan", []), "results": final_state.get("results", [])}



# Global instance used by FastAPI
from .agent_service import agent_service

plan_execute_service = PlanAndExecuteService(agent_service)
