from typing import Literal
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from app.tracer_service import run_trace, TracerTimeout, TracerError
from app.trace_model import Trace, CompileError

app = FastAPI(title="cpp-tutor")
app.add_middleware(
    CORSMiddleware, allow_origins=["http://localhost:5173"],
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
