"""Natural-language task-management endpoint backed by local Ollama."""

from fastapi import APIRouter, HTTPException, status

from app.schemas import AgentRequest, AgentResponse
from app.services.agent import AgentServiceError, run_agent


router = APIRouter(prefix="/api", tags=["agent"])


@router.post("/agent", response_model=AgentResponse, summary="Ask the task agent")
async def agent_endpoint(payload: AgentRequest) -> AgentResponse:
    """Run a natural-language prompt through Ollama and the SQLite tool loop."""
    try:
        result = await run_agent(payload.prompt)
        return AgentResponse.model_validate(result)
    except AgentServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
