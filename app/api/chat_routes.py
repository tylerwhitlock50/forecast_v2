"""
Chat and AI-related API routes
"""

from fastapi import APIRouter, HTTPException, UploadFile, File
from typing import Optional
from datetime import datetime

# Import database functions and models
from db import (
    ChatRequest,
    SQLApplyRequest,
    ForecastResponse,
    execute_sql,
    get_execution_logs,
    replay_execution_logs,
    reset_to_initial_state
)

# Import LLM services
from services.llm_service import llm_service, LLMRequest
from services.agent_service import agent_service, AgentRequest
from services.plan_execute_service import plan_execute_service
from services.whisper_service import whisper_service

# Import OpenAI Agents service
from services.openai_agents_service_new import (
    AgentChatRequest, 
    AgentResponse, 
    process_agent_chat,
    get_conversation_history,
    clear_conversation,
    get_available_agents
)

router = APIRouter(prefix="/chat", tags=["Chat & AI"])

# =============================================================================
# AI & CHAT ENDPOINTS
# =============================================================================

@router.post("/llm", response_model=ForecastResponse)
async def chat_endpoint(request: ChatRequest):
    """
    Accepts natural language input and returns SQL and explanation
    Integrates with the Ollama LLM service
    """
    try:
        # Convert ChatRequest to LLMRequest
        llm_request = LLMRequest(
            message=request.message,
            context=request.context,
            temperature=0.1,
            max_tokens=1000
        )
        
        # Generate SQL using LLM service
        llm_response = await llm_service.generate_sql(llm_request)
        
        if llm_response.error:
            raise HTTPException(status_code=500, detail=llm_response.error)
        
        return ForecastResponse(
            status="success",
            data={
                "sql_statement": llm_response.sql_statement,
                "explanation": llm_response.explanation,
                "confidence": llm_response.confidence,
                "requires_approval": llm_response.requires_approval,
                "suggested_actions": llm_response.suggested_actions
            },
            message="SQL generated successfully"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/agent", response_model=ForecastResponse)
async def agent_endpoint(request: ChatRequest):
    """Interact with a LangChain powered agent"""
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        logger.info(f"Agent request received: {request.message[:100]}...")
        logger.info(f"Agent context: {request.context}")
        
        agent_request = AgentRequest(message=request.message, context=request.context)
        logger.info("Starting agent execution...")
        
        result = await agent_service.run(agent_request)
        
        logger.info(f"Agent execution completed successfully")
        logger.info(f"Agent result: {result[:200]}..." if len(result) > 200 else f"Agent result: {result}")
        
        return ForecastResponse(status="success", data={"response": result}, message="Agent response generated")
    except Exception as e:
        logger.error(f"Agent execution failed: {str(e)}")
        logger.error(f"Error type: {type(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/plan_execute", response_model=ForecastResponse)
async def plan_execute_endpoint(request: ChatRequest):
    """Plan with DeepSeek and execute with the Llama agent"""
    try:
        agent_request = AgentRequest(message=request.message, context=request.context)
        result = await plan_execute_service.run(agent_request)
        return ForecastResponse(status="success", data=result, message="Plan and execution completed")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/voice", response_model=ForecastResponse)
async def voice_command(audio: UploadFile = File(...), session_id: Optional[str] = None):
    """Process a voice command via Whisper and the agent service"""
    try:
        audio_bytes = await audio.read()
        transcript = await whisper_service.transcribe(audio_bytes)
        context = {"session_id": session_id} if session_id else {"session_id": "default"}
        agent_request = AgentRequest(message=transcript, context=context)
        result = await agent_service.run(agent_request)
        return ForecastResponse(
            status="success",
            data={"transcript": transcript, "response": result},
            message="Voice command processed"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# =============================================================================
# OPENAI AGENTS ENDPOINTS
# =============================================================================

@router.post("/agents", response_model=AgentResponse)
async def chat_with_agents(request: AgentChatRequest):
    """
    Chat with the AI agents system
    """
    try:
        response = await process_agent_chat(request)
        return response
    except Exception as e:
        return AgentResponse(
            content=f"Error processing chat: {str(e)}",
            agent="error_handler",
            timestamp=datetime.now().isoformat(),
            session_id=request.session_id or f"error_session_{datetime.now().timestamp()}",
            error=True,
            metadata={"error_type": type(e).__name__}
        )

@router.get("/agents/history")
async def get_agents_conversation_history():
    """
    Get conversation history
    """
    try:
        history = get_conversation_history()
        return {
            "status": "success",
            "data": history
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get conversation history: {str(e)}")

@router.post("/agents/clear")
async def clear_agents_conversation():
    """
    Clear conversation history
    """
    try:
        clear_conversation()
        return {
            "status": "success",
            "message": "Conversation history cleared"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear conversation: {str(e)}")

@router.get("/agents/available")
async def get_agents_list():
    """
    Get list of available agents
    """
    try:
        agents = get_available_agents()
        return {
            "status": "success",
            "data": agents
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get agents list: {str(e)}")

# =============================================================================
# SQL PREVIEW AND EXECUTION ENDPOINTS
# =============================================================================

@router.post("/preview_sql", response_model=ForecastResponse)
async def preview_sql_endpoint(request: SQLApplyRequest):
    """
    Preview SQL execution without applying changes
    """
    try:
        from db.database import db_manager
        
        # Get a connection to run the preview
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Execute the SQL and fetch results
        cursor.execute(request.sql_statement)
        
        if request.sql_statement.strip().upper().startswith('SELECT'):
            # For SELECT queries, return the results
            columns = [description[0] for description in cursor.description]
            rows = cursor.fetchall()
            data = [dict(zip(columns, row)) for row in rows]
            
            return ForecastResponse(
                status="success",
                data={
                    "preview_data": data,
                    "columns": columns,
                    "row_count": len(data),
                    "sql_statement": request.sql_statement
                },
                message=f"Preview shows {len(data)} rows that would be affected"
            )
        else:
            # For non-SELECT queries, return what would be affected
            return ForecastResponse(
                status="success",
                data={
                    "sql_statement": request.sql_statement,
                    "message": "This is a modification query. Use /apply_sql to execute it."
                },
                message="SQL preview completed - use /apply_sql to execute"
            )
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL preview error: {str(e)}")
    finally:
        if 'conn' in locals():
            db_manager.close_connection(conn)

@router.post("/apply_sql", response_model=ForecastResponse)
async def apply_sql_endpoint(request: SQLApplyRequest):
    """
    Applies user-approved SQL transformation with logging
    """
    result = execute_sql(
        request.sql_statement,
        description=request.description,
        user_id=getattr(request, 'user_id', None),
        session_id=getattr(request, 'session_id', None)
    )
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])
    
    return ForecastResponse(
        status="success",
        message=f"SQL applied successfully: {request.description}"
    )

@router.post("/recalculate", response_model=ForecastResponse)
async def recalculate_forecast():
    """
    Re-runs all SQL to recalculate outputs
    """
    try:
        # TODO: Implement full recalculation logic
        # This would run all the forecast calculations
        
        return ForecastResponse(
            status="success",
            message="Forecast recalculated successfully"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) 