from contextlib import asynccontextmanager
from typing import Literal
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel
from app import tracer_service
from app.trace_cache import run_trace
from app.tracer_service import TracerTimeout, TracerError
from app.trace_model import Trace, CompileError


@asynccontextmanager
async def _lifespan(app: FastAPI):
    yield
    tracer_service.shutdown_pool()

app = FastAPI(title="cpp-tutor", lifespan=_lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["http://localhost:5173"],
    allow_methods=["*"], allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)


class TraceRequest(BaseModel):
    code: str
    lang: Literal["c", "cpp"]


@app.post("/api/trace")
def trace(req: TraceRequest) -> Trace | CompileError:
    try:
        return run_trace(req.code, req.lang)
    except TracerTimeout:
        raise HTTPException(status_code=503,
                            detail="Program ran too long — try a smaller example.")
    except TracerError as e:
        raise HTTPException(status_code=500, detail=str(e))
