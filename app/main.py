"""FastAPI application entry point."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.database import initialize_database
from app.routes.agent import router as agent_router
from app.routes.tasks import router as tasks_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Also initialize on startup so the API is usable immediately after launch.
    initialize_database()
    yield


app = FastAPI(
    title="Local Task Manager API",
    description=(
        "A FastAPI + SQLite task manager with a local Ollama-powered agent."
    ),
    version="1.0.0",
    lifespan=lifespan,
)
app.include_router(tasks_router)
app.include_router(agent_router)

# Serve the static local UI from the same origin as the API. This avoids
# browser CORS issues when opening the app at http://localhost:8000/.
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
