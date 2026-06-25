from typing import Any, Literal
from pydantic import BaseModel


class ExecPoint(BaseModel):
    line: int
    event: str
    func_name: str = ""
    stack_to_render: list[Any] = []
    heap: dict[str, Any] = {}
    globals: dict[str, Any] = {}
    ordered_globals: list[str] = []
    stdout: str = ""


class Trace(BaseModel):
    code: str
    trace: list[ExecPoint]


class CompileError(BaseModel):
    status: Literal["compile_error"] = "compile_error"
    message: str
    line: int | None = None


def parse_trace(raw: dict) -> Trace:
    return Trace.model_validate(raw)
