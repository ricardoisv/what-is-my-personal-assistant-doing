"""Decorators: @workflow, @task, @tool, @agent.

Each opens a wimad span around the wrapped call. `@workflow` additionally
generates a fresh `run_id` (UUID4 hex) and pushes it onto the contextvar
so descendant spans inherit it.

Args / kwargs are stringified into a single attribute (truncated to 4KB) so
they're queryable downstream without blowing up span size.
"""

from __future__ import annotations

import functools
import uuid
from typing import Any, Callable, TypeVar

from .context import _reset_run_id, _set_run_id, span

F = TypeVar("F", bound=Callable[..., Any])

_MAX_ARGS_LEN = 4096


def _stringify_args(args: tuple, kwargs: dict, limit: int = _MAX_ARGS_LEN) -> str:
    try:
        rendered = repr({"args": args, "kwargs": kwargs})
    except Exception:  # noqa: BLE001 — repr can fail on exotic objects
        rendered = "<unrepresentable>"
    if len(rendered) > limit:
        rendered = rendered[:limit] + "...[truncated]"
    return rendered


def workflow(name: str) -> Callable[[F], F]:
    """Mark a function as a workflow root. Generates a run_id; nested spans inherit it."""
    def decorator(fn: F) -> F:
        @functools.wraps(fn)
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            run_id = uuid.uuid4().hex
            token = _set_run_id(run_id)
            attrs = {
                "wimad.run_id": run_id,
                "wimad.workflow.name": name,
                "wimad.workflow.query": _stringify_args(args, kwargs, 1024),
            }
            try:
                with span(f"wimad.workflow.{name}", attributes=attrs):
                    return fn(*args, **kwargs)
            finally:
                _reset_run_id(token)

        return wrapped  # type: ignore[return-value]

    return decorator


def task(name: str) -> Callable[[F], F]:
    """Mark a function as a sub-step of a workflow."""
    def decorator(fn: F) -> F:
        @functools.wraps(fn)
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            with span(f"wimad.task.{name}", attributes={"wimad.task.name": name}):
                return fn(*args, **kwargs)

        return wrapped  # type: ignore[return-value]

    return decorator


def tool(name: str) -> Callable[[F], F]:
    """Mark a function as a tool invocation. Args go on the span (truncated)."""
    def decorator(fn: F) -> F:
        @functools.wraps(fn)
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            attrs = {
                "wimad.tool.name": name,
                "wimad.tool.args": _stringify_args(args, kwargs),
            }
            with span(f"wimad.tool.{name}", attributes=attrs):
                return fn(*args, **kwargs)

        return wrapped  # type: ignore[return-value]

    return decorator


def agent(name: str) -> Callable[[F], F]:
    """Mark a function as a sub-agent invocation."""
    def decorator(fn: F) -> F:
        @functools.wraps(fn)
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            with span(f"wimad.agent.{name}", attributes={"wimad.agent.name": name}):
                return fn(*args, **kwargs)

        return wrapped  # type: ignore[return-value]

    return decorator
