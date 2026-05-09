"""LangGraph entry point for `langgraph dev --port 8133`.

Wires the Trace Insights Analyst:
- A switchable runtime (Gemini Flash-Lite + deepagents | Gemini Flash-Lite + react)
  selected by `AGENT_RUNTIME`. See `src/runtime.py` and the README's
  "Switching to a different model".
- Trace-MCP-backed backend tools (always present; reads via mcp-use against
  the wimad trace MCP at MCP_SERVER_URL).
- TimingMiddleware (per-turn wall-time logging — see `src/timing.py`)
- TraceStateMiddleware + CopilotKitMiddleware for canvas state + AG-UI

Frontend tools (showTimeline, showFlamegraph, renderChart, etc.) are
declared on the React side via `useFrontendTool({ name, parameters,
handler })`. The runtime forwards those declarations into the agent's
tool list at run time, so we deliberately do NOT include Python stubs
here — adding them would cause Gemini to reject the request with
"Duplicate function declaration found: <name>".
"""

from __future__ import annotations

import os
import socket
from urllib.parse import urlparse

from dotenv import load_dotenv

from src.intelligence_cleanup import wipe_orphan_threads
from src.prompts import build_system_prompt
from src.runtime import build_graph
from src.trace_tools import load_trace_tools


# Load .env early so GEMINI_API_KEY / MCP_SERVER_URL are visible.
load_dotenv()


# `langgraph dev` uses an in-memory checkpoint store, so every agent boot
# starts with zero threads in LangGraph but the Intelligence Postgres
# still holds the chat history from the previous run. Without this
# cleanup, the next `getCheckpointByMessage` lookup throws "Message not
# found" and surfaces in the UI as an opaque rxjs stack trace.
wipe_orphan_threads()


def _format_integration_status() -> str:
    """Probe the trace MCP at boot and return a one-line status.

    Just opens a TCP connection to the MCP host:port — full MCP
    handshake at this layer is too noisy. The agent will surface a
    real error on the first tool call if the MCP misbehaves.
    """
    url = os.getenv("MCP_SERVER_URL", "http://localhost:3011/mcp")
    parsed = urlparse(url)
    host = parsed.hostname or "localhost"
    port = parsed.port or (443 if parsed.scheme == "https" else 3011)
    try:
        with socket.create_connection((host, port), timeout=1.5):
            line = f"source=trace-mcp host={host}:{port} status=reachable"
    except Exception as e:  # noqa: BLE001
        line = (
            f"source=trace-mcp host={host}:{port} status=unreachable "
            f"reason={type(e).__name__}: {e}. "
            "Start the MCP with `npm run dev:mcp`."
        )
    print(f"[trace_mcp] {line}", flush=True)
    return line


_AGENT_RUNTIME = os.getenv("AGENT_RUNTIME", "gemini-flash-deep")
print(f"[runtime] AGENT_RUNTIME={_AGENT_RUNTIME}", flush=True)

_gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""
if _AGENT_RUNTIME.startswith("gemini-") and (
    not _gemini_key or _gemini_key.startswith("stub")
):
    print(
        "\n  GEMINI_API_KEY is unset or a stub.\n"
        "   The agent will boot but chat will fail on the first turn.\n"
        "   Get a key at https://aistudio.google.com → Get API key,\n"
        "   then set GEMINI_API_KEY in .env and apps/agent/.env.\n",
        flush=True,
    )


backend_tools = load_trace_tools()


_integration_status = _format_integration_status()
SYSTEM_PROMPT = build_system_prompt(_integration_status)


_use_noop = (
    _AGENT_RUNTIME.startswith("gemini-")
    and (not _gemini_key or _gemini_key.startswith("stub"))
)
if _use_noop:
    print(
        "\n[runtime] GEMINI_API_KEY missing or stub — using noop fallback graph.\n"
        "          Chat will reply with a setup pointer instead of hanging.\n",
        flush=True,
    )

# Frontend tools are NOT listed here — see module docstring.
graph = build_graph(
    "noop" if _use_noop else _AGENT_RUNTIME,
    tools=backend_tools,
    system_prompt=SYSTEM_PROMPT,
)


def main() -> None:
    """Entry point for `uv run dev` / `python -m agent`.

    `langgraph dev` is the canonical local-dev runner — this just exists to
    satisfy the `[project.scripts] dev = "agent:main"` entry point.
    """
    import subprocess

    subprocess.run(
        ["langgraph", "dev", "--port", "8133"],
        check=True,
    )


if __name__ == "__main__":
    main()
