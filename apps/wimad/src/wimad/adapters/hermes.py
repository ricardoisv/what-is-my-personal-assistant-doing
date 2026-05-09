"""Hermes adapter — monkey-patches NousResearch's hermes-agent from outside.

Why monkey-patch and not hooks: Hermes's hooks (gateway/hooks.py,
hermes_cli/callbacks.py) are UI callbacks, not lifecycle observability hooks.
They fire for "render approval prompt" / "emit tool-preview line", neither of
which gives us reliable start/end timestamps for the dispatch points we care
about. Patching the dispatch sites directly is more robust.

Patched call sites:
  - run_agent.AIAgent.run_conversation     → hermes.workflow.run_conversation
  - model_tools.handle_function_call       → hermes.tool.{name}
  - runtime_provider's three API-mode calls → hermes.llm.{mode}

`install()` must be called BEFORE hermes_cli's modules are imported so we
patch the original definitions, not stale bound references.
"""

from __future__ import annotations

import functools
import logging
import uuid
from typing import Any

from .. import configure
from ..context import _reset_run_id, _set_run_id, span

_log = logging.getLogger("wimad.adapters.hermes")
_installed = False


def install() -> None:
    """Apply all Hermes patches. Idempotent."""
    global _installed
    if _installed:
        return

    configure(service_name="hermes")

    _patch_run_conversation()
    _patch_handle_function_call()
    _patch_llm_calls()

    _installed = True
    _log.info("wimad.adapters.hermes installed")


# ---------------------------------------------------------------- patch helpers

def _safe_patch(import_path: str, attr: str, wrapper):
    """Patch `attr` on the module at `import_path` with `wrapper(orig)`.

    Logs and skips quietly when the target is missing — Hermes module names
    can drift across versions, and a missing patch should warn loudly but not
    break Hermes itself.
    """
    try:
        import importlib
        mod = importlib.import_module(import_path)
    except Exception as e:  # noqa: BLE001
        _log.warning("could not import %s (%s); skipping patch", import_path, e)
        return
    orig = getattr(mod, attr, None)
    if orig is None:
        _log.warning("missing %s.%s; skipping patch", import_path, attr)
        return
    setattr(mod, attr, wrapper(orig))
    _log.debug("patched %s.%s", import_path, attr)


def _safe_patch_method(import_path: str, cls_name: str, method: str, wrapper):
    """Patch a method on a class. See _safe_patch for failure semantics."""
    try:
        import importlib
        mod = importlib.import_module(import_path)
    except Exception as e:  # noqa: BLE001
        _log.warning("could not import %s (%s); skipping patch", import_path, e)
        return
    cls = getattr(mod, cls_name, None)
    if cls is None:
        _log.warning("missing %s.%s; skipping patch", import_path, cls_name)
        return
    orig = getattr(cls, method, None)
    if orig is None:
        _log.warning(
            "missing %s.%s.%s; skipping patch", import_path, cls_name, method,
        )
        return
    setattr(cls, method, wrapper(orig))
    _log.debug("patched %s.%s.%s", import_path, cls_name, method)


# ----------------------------------------------------------------- hermes loop

def _patch_run_conversation() -> None:
    """Wrap AIAgent.run_conversation as the workflow root span."""

    def wrapper(orig):
        @functools.wraps(orig)
        def wrapped(self, *args: Any, **kwargs: Any) -> Any:
            run_id = uuid.uuid4().hex
            token = _set_run_id(run_id)
            attrs = {
                "wimad.run_id": run_id,
                "hermes.query": _extract_query(args, kwargs),
            }
            try:
                with span(
                    "hermes.workflow.run_conversation",
                    attributes=attrs,
                ):
                    return orig(self, *args, **kwargs)
            finally:
                _reset_run_id(token)

        return wrapped

    _safe_patch_method("run_agent", "AIAgent", "run_conversation", wrapper)


def _patch_handle_function_call() -> None:
    """Wrap each tool dispatch as hermes.tool.{name}."""

    def wrapper(orig):
        @functools.wraps(orig)
        def wrapped(call: Any, *args: Any, **kwargs: Any) -> Any:
            name, raw_args = _extract_tool_call(call)
            attrs = {
                "hermes.tool.name": name,
                "hermes.tool.args": _truncate(raw_args, 4096),
            }
            with span(f"hermes.tool.{name}", attributes=attrs):
                return orig(call, *args, **kwargs)

        return wrapped

    _safe_patch("model_tools", "handle_function_call", wrapper)


# ------------------------------------------------------------------- llm calls

# Hermes supports three API modes; each lives at a different module path
# inside `runtime_provider`. We patch the most-likely dispatch entry on each.
# If a target is missing the patch is skipped silently with a log line — the
# remaining modes still get coverage. Mode names line up with the docs'
# "chat_completions / codex_responses / anthropic_messages" trio.
_LLM_PATCH_TARGETS = (
    # (module_path, attr_name, mode)
    ("runtime_provider.chat_completions", "send", "chat_completions"),
    ("runtime_provider.codex_responses", "send", "codex_responses"),
    ("runtime_provider.anthropic_messages", "send", "anthropic_messages"),
)


def _patch_llm_calls() -> None:
    for mod_path, attr, mode in _LLM_PATCH_TARGETS:
        _patch_one_llm(mod_path, attr, mode)


def _patch_one_llm(mod_path: str, attr: str, mode: str) -> None:
    def wrapper(orig):
        @functools.wraps(orig)
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            attrs = {
                "gen_ai.system": mode,
                "gen_ai.request.model": _extract_model(args, kwargs),
            }
            with span(f"hermes.llm.{mode}", attributes=attrs) as s:
                response = orig(*args, **kwargs)
                # Best-effort: lift token usage off the response.
                _annotate_llm_response(s, response)
                return response

        return wrapped

    _safe_patch(mod_path, attr, wrapper)


# -------------------------------------------------------------------- helpers

def _truncate(value: Any, limit: int) -> str:
    if value is None:
        return ""
    s = value if isinstance(value, str) else repr(value)
    return s if len(s) <= limit else s[:limit] + "...[truncated]"


def _extract_query(args: tuple, kwargs: dict) -> str:
    """Pull the user message out of run_conversation's args (best-effort)."""
    for cand in (kwargs.get("user_input"), kwargs.get("message"), kwargs.get("prompt")):
        if isinstance(cand, str):
            return _truncate(cand, 1024)
    for a in args:
        if isinstance(a, str):
            return _truncate(a, 1024)
    return ""


def _extract_tool_call(call: Any) -> tuple[str, Any]:
    """Pull (name, arguments) out of Hermes's tool-call payload."""
    if isinstance(call, dict):
        return (
            str(call.get("name", "unknown")),
            call.get("arguments") or call.get("args"),
        )
    name = getattr(call, "name", None) or getattr(call, "function", None) or "unknown"
    args = getattr(call, "arguments", None) or getattr(call, "args", None)
    return (str(name), args)


def _extract_model(args: tuple, kwargs: dict) -> str:
    """Try to find the model id in send() args (best-effort, version-resilient)."""
    m = kwargs.get("model")
    if isinstance(m, str):
        return m
    for a in args:
        if isinstance(a, dict) and isinstance(a.get("model"), str):
            return a["model"]
        if hasattr(a, "model") and isinstance(getattr(a, "model"), str):
            return getattr(a, "model")
    return "unknown"


def _annotate_llm_response(s: Any, response: Any) -> None:
    """Best-effort: lift token usage and finish reasons onto the LLM span."""
    try:
        usage = (
            getattr(response, "usage", None)
            or (response.get("usage") if isinstance(response, dict) else None)
        )
        if usage:
            in_t = getattr(usage, "input_tokens", None) or (
                usage.get("input_tokens") if isinstance(usage, dict) else None
            )
            out_t = getattr(usage, "output_tokens", None) or (
                usage.get("output_tokens") if isinstance(usage, dict) else None
            )
            if in_t is not None:
                s.set_attribute("gen_ai.usage.input_tokens", int(in_t))
            if out_t is not None:
                s.set_attribute("gen_ai.usage.output_tokens", int(out_t))
    except Exception:  # noqa: BLE001 — telemetry never raises
        pass
