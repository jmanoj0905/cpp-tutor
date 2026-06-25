from app.trace_model import parse_trace, Trace

def test_parse_minimal_trace():
    raw = {
        "code": "int main(){return 0;}",
        "trace": [
            {"line": 1, "event": "step_line", "func_name": "main",
             "stack_to_render": [], "heap": {}, "globals": {},
             "ordered_globals": [], "stdout": ""}
        ],
    }
    t = parse_trace(raw)
    assert isinstance(t, Trace)
    assert len(t.trace) == 1
    assert t.trace[0].func_name == "main"
    assert t.trace[0].line == 1
