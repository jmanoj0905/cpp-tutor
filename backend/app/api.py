import os
from typing import Literal
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from app.tracer_service import run_trace, TracerTimeout, TracerError
from app.trace_model import Trace, CompileError

# Origins allowed by CORS. Defaults to the Vite dev server; deployments set
# CPP_TUTOR_CORS_ORIGINS to a comma-separated list of their own origins.
_origins = os.environ.get("CPP_TUTOR_CORS_ORIGINS", "http://localhost:5173")
ALLOW_ORIGINS = [o.strip() for o in _origins.split(",") if o.strip()]

app = FastAPI(title="cpp-tutor")
app.add_middleware(
    CORSMiddleware, allow_origins=ALLOW_ORIGINS,
    allow_methods=["*"], allow_headers=["*"],
)


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
