"""LRU cache in front of the tracer. Tracing is deterministic for a given
(code, lang), so a hit replaces an entire Docker + Valgrind run with a dict
lookup. Errors (timeouts, docker failures) propagate uncached — they may be
transient."""
import threading
from collections import OrderedDict
from app import tracer_service
from app.trace_model import Trace, CompileError

MAX_ENTRIES = 64

_cache: OrderedDict[tuple[str, str], Trace | CompileError] = OrderedDict()
_lock = threading.Lock()


def run_trace(code: str, lang: str) -> Trace | CompileError:
    key = (code, lang)
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]

    result = tracer_service.run_trace(code, lang)

    with _lock:
        _cache[key] = result
        _cache.move_to_end(key)
        while len(_cache) > MAX_ENTRIES:
            _cache.popitem(last=False)
    return result


def clear() -> None:
    with _lock:
        _cache.clear()
