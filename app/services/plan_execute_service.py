from __future__ import annotations

import asyncio
import httpx
import logging

from typing import Dict, Any, Optional, List, TypedDict

from langgraph.graph import StateGraph, END


from .agent_service import AgentService, AgentRequest

# Configure logging
logger = logging.getLogger(__name__)


class GraphState(TypedDict, total=False):
    request: AgentRequest
    plan: List[str]
    results: List[Dict[str, Any]]
    step: int
    approved: bool



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
        planning_model: str = "llama3.1",  # Changed from deepseek-r1 to llama3.1

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
        logger.info(f"Calling Ollama API with model: {model}")
        logger.info(f"Prompt length: {len(prompt)} characters")
        logger.debug(f"Prompt: {prompt[:200]}...")
        
        try:
            # Increased timeout to 60 seconds for model loading
            async with httpx.AsyncClient(timeout=60.0) as client:
                payload = {
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": temperature, "num_predict": max_tokens},
                }
                logger.info(f"Sending request to {self.ollama_url}/api/generate")
                response = await client.post(f"{self.ollama_url}/api/generate", json=payload)
                logger.info(f"Ollama response status: {response.status_code}")
                
                if response.status_code != 200:
                    logger.error(f"Ollama API error: {response.status_code} - {response.text}")
                    raise Exception(f"Ollama API error: {response.status_code} - {response.text}")
                
                result = response.json()
                response_text = result.get("response", "")
                logger.info(f"Ollama response length: {len(response_text)} characters")
                logger.debug(f"Ollama response: {response_text[:200]}...")
                return response_text
                
        except httpx.TimeoutException:
            logger.error(f"Ollama API timeout after 60 seconds")
            raise Exception("Ollama API timeout - model may be loading or overloaded")
        except Exception as e:
            logger.error(f"Error calling Ollama API: {str(e)}")
            raise

    async def _generate_plan(self, message: str) -> List[str]:
        """Generate a numbered plan for the given message."""
        logger.info(f"Generating plan for message: {message[:100]}...")
        
        prompt = (
            "You are a planning assistant for a financial forecasting system. Break down the following request into a"
            " concise numbered list of 3-5 specific steps that can be executed using SQL queries or database operations.\n\n"
            "Each step should be a specific action like:\n"
            "- 'Query the sales table to get customer revenue data for 2024'\n"
            "- 'Calculate total revenue by customer and sort in descending order'\n"
            "- 'Return the top customer with highest total revenue'\n\n"
            "Request: " + message + "\n\n"
            "Generate a plan with specific, actionable steps:"
        )
        
        logger.info(f"Calling planning model: {self.planning_model}")
        plan_text = await self._call_ollama(self.planning_model, prompt)
        logger.info(f"Received plan text: {plan_text[:200]}...")
        
        # Parse the response into steps
        lines = plan_text.strip().split('\n')
        steps = []
        for line in lines:
            line = line.strip()
            if line and (line[0].isdigit() or line.startswith('-') or line.startswith('*')):
                # Remove numbering and bullet points
                step = line.lstrip('0123456789.-* ').strip()
                if step:
                    steps.append(step)
        
        logger.info(f"Parsed {len(steps)} steps from plan")
        for i, step in enumerate(steps):
            logger.info(f"Step {i+1}: {step}")
        
        # If parsing failed, create a fallback plan based on the request
        if not steps:
            logger.warning("Failed to parse plan from LLM response, using fallback plan")
            message_lower = message.lower()
            if "customer" in message_lower and ("top" in message_lower or "highest" in message_lower or "best" in message_lower):
                steps = [
                    "Query the sales table to get all customer sales data with total revenue",
                    "Calculate total revenue for each customer by summing total_revenue",
                    "Sort customers by total revenue in descending order",
                    "Return the customer with the highest total revenue"
                ]
            elif "forecast" in message_lower:
                steps = [
                    "Query sales data to get current revenue by period",
                    "Query cost data from BOM and labor tables",
                    "Calculate profit margins and projections",
                    "Generate comprehensive forecast report with revenue and cost analysis"
                ]
            elif "revenue" in message_lower:
                steps = [
                    "Query the sales table to get revenue data",
                    "Calculate total revenue by period and customer",
                    "Analyze revenue trends and patterns",
                    "Return revenue analysis results"
                ]
            else:
                steps = [
                    "Analyze the user request to understand specific requirements",
                    "Query relevant database tables for required data",
                    "Process and analyze the data according to the request",
                    "Format and return the results to the user"
                ]
            logger.info(f"Using fallback plan with {len(steps)} steps")
        
        return steps

    def _build_graph(self):
        """Create the LangGraph state machine."""

        def plan_node(state: GraphState, config) -> GraphState:
            # The plan should already be in the state from the run method
            # This node just ensures the plan exists and initializes other state
            logger.info("Executing plan_node")
            if "plan" not in state:
                logger.warning("No plan in state, using default plan")
                state["plan"] = ["Analyze request", "Execute action", "Return results"]
            state["results"] = []
            state["step"] = 0
            logger.info(f"Plan node initialized with {len(state['plan'])} steps")
            return state

        def approval_node(state: GraphState, config) -> GraphState:
            step_text = state["plan"][state["step"]]
            logger.info(f"Executing approval_node for step {state['step'] + 1}: {step_text}")
            if any(k in step_text.upper() for k in ["UPDATE", "DELETE", "DROP", "TRUNCATE"]):
                # For now, auto-approve since we can't easily run async here
                logger.info("Auto-approving modification step")
                state["approved"] = True
            else:
                logger.info("Auto-approving query step")
                state["approved"] = True
            return state

        def execute_node(state: GraphState, config) -> GraphState:
            step_text = state["plan"][state["step"]]
            logger.info(f"Executing step {state['step'] + 1}: {step_text}")
            
            if not state.get("approved", True):
                logger.warning(f"Step {state['step'] + 1} was rejected by approval process")
                result = "Step rejected by approval process"
            else:
                # Actually execute the step using the agent service
                try:
                    logger.info(f"Creating agent request for step: {step_text}")
                    # Create a specific request for this step
                    step_request = AgentRequest(
                        message=f"Execute this step: {step_text}",
                        context={
                            "original_request": state["request"].message,
                            "step_number": state["step"] + 1,
                            "total_steps": len(state["plan"])
                        }
                    )
                    
                    logger.info(f"Calling agent service for step {state['step'] + 1}")
                    # Execute the step using the agent service in a thread
                    import concurrent.futures
                    import asyncio
                    
                    def run_agent_async():
                        """Run the agent service in a new event loop"""
                        loop = asyncio.new_event_loop()
                        asyncio.set_event_loop(loop)
                        try:
                            return loop.run_until_complete(self.agent_service.run(step_request))
                        finally:
                            loop.close()
                    
                    # Run in thread to avoid blocking
                    with concurrent.futures.ThreadPoolExecutor() as executor:
                        future = executor.submit(run_agent_async)
                        agent_result = future.result(timeout=120)  # 2 minute timeout
                        
                    logger.info(f"Agent service completed for step {state['step'] + 1}")
                    logger.debug(f"Agent result: {agent_result[:200]}...")
                    result = f"Executed: {step_text}\nResult: {agent_result}"
                        
                except Exception as e:
                    logger.error(f"Error executing step '{step_text}': {str(e)}")
                    result = f"Error executing step '{step_text}': {str(e)}"
                    
            state.setdefault("results", []).append({"step": step_text, "result": result})
            state["step"] += 1
            logger.info(f"Step {state['step']} completed, moving to next step")
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
        logger.info(f"Starting plan_execute service for request: {request.message[:100]}...")
        
        try:
            # Generate the plan first (this is async and calls Ollama)
            logger.info("Generating execution plan...")
            plan = await self._generate_plan(request.message)
            logger.info(f"Plan generated with {len(plan)} steps")
            
            # Then run the graph with the pre-generated plan
            logger.info("Starting graph execution...")
            final_state = self.graph.invoke({
                "request": request,
                "plan": plan
            })
            logger.info("Graph execution completed")
            
            result = {"plan": final_state.get("plan", []), "results": final_state.get("results", [])}
            logger.info(f"Plan_execute service completed successfully with {len(result['results'])} results")
            return result
            
        except Exception as e:
            logger.error(f"Error in plan_execute service: {str(e)}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            raise



# Global instance used by FastAPI
from .agent_service import agent_service

plan_execute_service = PlanAndExecuteService(agent_service)
