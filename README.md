# What Is My Personal Assistant Doing

> Generative UI Global Hackathon: Agentic Interfaces

A trace-observability workbench for AI assistants. We instrument
[NousResearch's `hermes-agent`](https://github.com/NousResearch/hermes-agent)
(a research assistant with 70+ tools, 18+ LLM providers, and a built-in
Telegram/Discord/Slack gateway) and surface what it does in a CopilotKit
canvas: live timelines, flamegraphs, latency aggregates, A2UI charts,
and an LLM-judge that scores runs.

The point isn't the assistant — it's **knowing at all times what it's
doing**. We built what hermes-agent
[issue #1501](https://github.com/NousResearch/hermes-agent/issues/1501)
and [issue #6741](https://github.com/NousResearch/hermes-agent/issues/6741)
are asking for.

## Stack

- **`wimad`** — a tiny Python tracing SDK with `@workflow`, `@task`,
  `@tool`, `@agent` decorators (`apps/wimad/`). Use it to instrument any
  Python agent.
- **Hermes adapter** — `wimad.adapters.hermes` monkey-patches Hermes's
  three dispatch points (`AIAgent.run_conversation`,
  `model_tools.handle_function_call`, runtime_provider's API calls).
  Run `hermes-traced` instead of `hermes`. No fork, no source edits.
- **Trace MCP server** — `apps/mcp/`, built on Manufact `mcp-use`.
  Exposes 7 read-plane MCP tools (`list_runs`, `query_spans`,
  `aggregate`, `compare_runs`, `judge_trace`, …) plus HTTP routes:
  `POST /traces/ingest`, `GET /traces/stream` (SSE live tail),
  `GET /runs`, `GET /runs/:id`, `GET /traces/:id`, `GET /aggregate`.
  SQLite store with one row per span.
- **Analyst Deep Agent** — `apps/agent/`, a LangChain Deep Agent on
  Gemini Flash-Lite. Loads the trace MCP via `mcp-use` and renders
  answers as controlled / A2UI / openGenUI components on the canvas.
- **Canvas** — `apps/frontend/`, Next.js + CopilotKit v2. RunList
  (left), TraceDetail with Timeline / Flamegraph / Span detail tabs
  (center), MetricsStrip (top), Pinned charts (right), CopilotSidebar
  chat. Live-tails new spans via SSE.

```
┌── User's machine ────────────────────────────┐
│ Canvas (Next.js) ── Analyst (Python) ──┐     │
│                                        │ MCP │
│ hermes (~/.hermes/)                    │     │
│   ↑                                    │     │
│ hermes-traced ──── POST /traces/ingest ▼     │
└─────────────────────────────┬───────────┬────┘
                              │           │
                              ▼           ▼
                  ┌── Trace MCP server (Bun) ──────┐
                  │ apps/mcp/ on :3011 (MCP)       │
                  │             :3012 (ingest+SSE) │
                  │ traces.sqlite                  │
                  └────────────────────────────────┘
```

## Run it locally

**Prerequisites**

- Node.js 20+
- Python 3.10+
- [`uv`](https://docs.astral.sh/uv/getting-started/installation/)
- Docker Desktop (for Postgres / Redis / CopilotKit Intelligence)

**API keys you'll need** (see [PLAN.md §What you need](PLAN.md) for
where to get each):

| Var | Purpose |
|---|---|
| `GEMINI_API_KEY` | Analyst Deep Agent + `judge_trace` LLM judge |
| `COPILOTKIT_LICENSE_TOKEN` | CopilotKit Intelligence (chat threads) |
| `DAYTONA_API_KEY` | Hermes terminal backend (sandboxed code exec) |
| One LLM key for Hermes itself (e.g. `OPENROUTER_API_KEY`) | Hermes's model calls |

**Boot the stack**

```bash
cp .env.example .env && cp apps/agent/.env.example apps/agent/.env
# paste keys into both .env files

npm install
npm run dev:full   # boots ui (3010) + bff (4000) + agent (8133) + mcp (3011/3012)
```

Open <http://localhost:3010>.

## Use it with Hermes

```bash
# 1. Install Hermes
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
hermes setup        # configure your model provider

# 2. Install wimad on the same Python that runs Hermes
uv pip install -e ./apps/wimad   # installs `hermes-traced` on PATH

# 3. Run Hermes through the wrapper
WIMAD_INGEST_URL=http://localhost:3012/traces/ingest hermes-traced
```

Each Hermes turn becomes a workflow span; tool calls and LLM calls
become children. Spans land in `apps/mcp/traces.sqlite` and the canvas
live-tails them.

For the **Telegram surface**: `hermes gateway` after `hermes setup`. No
new code on our side — Hermes ships gateway built-in.

## Use wimad with your own Python agent

```python
from wimad import workflow, task, tool, configure

configure(service_name="my-agent")

@tool("search_web")
def search_web(q: str) -> list[dict]: ...

@task("collect_notes")
def collect_notes(query: str) -> list[str]:
    return [search_web(query)]

@workflow("research")
def run_research(query: str) -> str:
    return summarize(collect_notes(query))
```

Reads `WIMAD_INGEST_URL` (default `http://localhost:3012/traces/ingest`).
Buffers in-memory if the ingest endpoint is unreachable.

## Demo prompts (in the chat sidebar)

- *"List the last 5 runs and tell me which one was slowest."*
- *"Look at the most recent run, aggregate by tool name, and tell me what dominated wall time."*
- *"Compare the last two runs and tell me what regressed."*
- *"Score this run for completeness."* (uses `judge_trace`)
- *"Show me a bar chart of p95 latency by tool."* (pins an A2UI chart)

## Architecture & decisions

See [`PLAN.md`](PLAN.md) for the full architecture, span schema, phase
plan, risks, and resolved open questions.

## Daytona

Two ways Daytona fits here:

1. **As Hermes's terminal backend** (recommended) — Hermes runs locally
   but spawns ephemeral Daytona sandboxes for risky tool execution.
   Configure via Hermes's own `~/.hermes/config.yaml` and set
   `DAYTONA_API_KEY` in env. Sandbox spans show up under
   `hermes.tool.execute_code` in the canvas.
2. **For the trace MCP server itself** — deploy `apps/mcp/` to a
   long-lived Daytona sandbox, exposed over HTTPS. Point
   `MCP_SERVER_URL` and `WIMAD_INGEST_URL` at the sandbox URL. Local
   dev still works against localhost.

## License

MIT.
