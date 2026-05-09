"""mcp-use client wrapper around the wimad Trace MCP server.

Same pattern as the kit's previous notion_mcp.py: per-call sessions to
keep things stateless, with a sync facade so the @tool functions in
trace_tools.py don't have to learn asyncio.

Auth: none for the local dev server. The MCP_SERVER_URL env points at
the trace MCP (defaults to http://localhost:3011/mcp). When deployed to
Daytona, point at the sandbox-exposed URL.

Tools exposed by the server (JSON-stringified text result per call):
  list_runs, get_run, query_spans, get_trace_tree, aggregate, compare_runs

The MCP server lives at apps/mcp/. See apps/mcp/src/tools/* for shapes.
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
from typing import Any, Dict

from dotenv import load_dotenv

load_dotenv()


def _client_config() -> Dict[str, Any]:
    """Build mcp-use config for the trace MCP (HTTP transport)."""
    url = os.getenv("MCP_SERVER_URL", "http://localhost:3011/mcp")
    return {
        "mcpServers": {
            "trace": {
                "url": url,
            }
        }
    }


# --- async core ----------------------------------------------------------

async def _call_tool_async(name: str, arguments: Dict[str, Any]) -> Any:
    """Open a fresh mcp-use session, call one tool, close it."""
    from mcp_use import MCPClient  # type: ignore

    client = MCPClient.from_dict(_client_config())
    try:
        session = await client.create_session("trace")
        if session is None:
            raise RuntimeError(
                "Failed to create MCP session for the trace MCP. "
                "Is apps/mcp running? (npm run dev:mcp)"
            )
        return await session.call_tool(name, arguments)
    finally:
        try:
            await client.close_all_sessions()
        except Exception:  # noqa: BLE001 - cleanup is best-effort
            pass


def _run_sync(coro) -> Any:
    """Run an async coroutine to completion from sync code, even when
    a parent event loop is already running.

    Same trick as notion_mcp.py — `langgraph dev`'s tool-execution path is
    sync-on-async; `asyncio.run` would error inside a running loop.
    """
    try:
        asyncio.get_running_loop()
        running = True
    except RuntimeError:
        running = False

    if not running:
        return asyncio.run(coro)

    result_holder: Dict[str, Any] = {}

    def _runner() -> None:
        loop = asyncio.new_event_loop()
        try:
            asyncio.set_event_loop(loop)
            result_holder["value"] = loop.run_until_complete(coro)
        except Exception as e:  # noqa: BLE001
            result_holder["error"] = e
        finally:
            loop.close()

    t = threading.Thread(target=_runner, daemon=True)
    t.start()
    t.join()
    if "error" in result_holder:
        raise result_holder["error"]  # type: ignore[misc]
    return result_holder.get("value")


def _extract_payload(result: Any) -> Dict[str, Any]:
    """Normalize an MCP tool-call result into a plain dict.

    Our trace MCP tools return `text(JSON.stringify(...))`, so the result
    has a single text content block we JSON.parse.
    """
    if result is None:
        raise RuntimeError("trace MCP returned no result")

    sc = getattr(result, "structuredContent", None)
    if isinstance(sc, dict) and sc:
        return sc

    content = getattr(result, "content", None)
    if not content:
        raise RuntimeError(
            f"trace MCP returned empty content. is_error="
            f"{getattr(result, 'isError', None)} raw={result!r}"
        )

    for block in content:
        text = getattr(block, "text", None)
        if not text:
            continue
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            raise RuntimeError(f"trace MCP error: {text}")

    raise RuntimeError(f"trace MCP returned no parseable text block: {result!r}")


# --- public sync facade -------------------------------------------------

def call_trace_tool(name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Call one trace-MCP tool and return its parsed JSON result."""
    return _extract_payload(_run_sync(_call_tool_async(name, arguments)))
