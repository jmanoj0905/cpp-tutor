import os
from contextlib import asynccontextmanager
from typing import Literal
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
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
# Cross-origin only matters when the frontend is served from a different host
# (e.g. a Cloudflare Pages deploy hitting this backend on Render). Comma-list
# via CPP_TUTOR_CORS_ORIGINS; defaults to the local Vite dev server. In the
# all-in-one image the frontend is same-origin, so this is irrelevant there.
# CPP_TUTOR_CORS_ORIGIN_REGEX covers origins that cannot be enumerated: a
# VSCode webview's origin carries a per-panel uuid, so the extension sets
# '^vscode-webview://.*' when it launches the container.
_cors_origins = [
    o.strip()
    for o in os.environ.get("CPP_TUTOR_CORS_ORIGINS", "http://localhost:5173").split(",")
    if o.strip()
]
# Passed to CORSMiddleware verbatim: Starlette fullmatch()es this pattern
# against the entire Origin header, so a prefix-style pattern must carry its
# own trailing '.*' — we never rewrite the operator's regex.
_cors_origin_regex = os.environ.get("CPP_TUTOR_CORS_ORIGIN_REGEX") or None
app.add_middleware(
    CORSMiddleware, allow_origins=_cors_origins,
    allow_origin_regex=_cors_origin_regex,
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


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# In the all-in-one container the backend also serves the built frontend.
# Same-origin, so the dev CORS allowance above is irrelevant there.
_static_dir = os.environ.get("CPP_TUTOR_STATIC", "")
if _static_dir and os.path.isdir(_static_dir):
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")
