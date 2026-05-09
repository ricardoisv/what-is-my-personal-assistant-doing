# What Is My Personal Assistant Doing — Hackathon Plan (Final)

> Generative UI Global Hackathon: Agentic Interfaces
> Repo: [ricardoisv/what-is-my-personal-assistant-doing](https://github.com/ricardoisv/what-is-my-personal-assistant-doing)
> Drafted 2026-05-09 · Final after Hermes repo review

## TL;DR

We ship **`wimad`** (What-Is-My-Assistant-Doing) — a small Python tracing SDK with `@workflow`, `@task`, `@tool`, `@agent` decorators that emit OTel-style spans and POST them to a SQLite-backed MCP server. We then use it to instrument [NousResearch's `hermes-agent`](https://github.com/NousResearch/hermes-agent) via a thin **adapter** that monkey-patches Hermes from outside (Hermes is third-party — we can't sprinkle decorators into its source). On top of that, a CopilotKit canvas runs an **Analyst** Deep Agent that loads the same MCP and uses generative UI to visualize and reason about every Hermes run.

- **`wimad` SDK** is reusable for any Python agent — decorators for code we own, the adapter pattern for code we don't.
- **The Hermes adapter** uses the same SDK primitives (the public `span()` context manager) — there's one tracer, one exporter, one ingest pipe.
- **CLI** is just `hermes` (Hermes's own TUI). **Telegram** is just `hermes gateway`. No code on our side.
- **Daytona sandbox** holds the trace MCP server (Manufact `mcp-use`) + `traces.sqlite` + live-tail SSE. Single deploy.
- **Klira SDK**: not used. **OTel SDK**: yes, as a primitive (trace context, span lifecycle); no auto-instrumentation packages.

### Why this project exists (motivation)

Hermes itself doesn't have trace observability today. Two open issues in its own repo confirm the gap:

- [`hermes-agent#1501`](https://github.com/NousResearch/hermes-agent/issues/1501) — *"[Feature]: Add Langfuse tracing for subagents and gateway sessions"*
- [`hermes-agent#6741`](https://github.com/NousResearch/hermes-agent/issues/6741) — *"feat(observability): structured session tracing with start/end timestamps"*

What Hermes *has*: structured text logs (`hermes_logging.py`), UI callbacks (spinner, tool preview, approval prompts), and SQLite-backed chat sessions. What it *lacks*: OTel spans, span trees, latency / token usage tracking, queryable trace store, OTLP export. We build that.

---

## Vision / Demo Story

The judge sees the CopilotKit canvas (running locally) and a terminal.

1. Judge runs `hermes-traced` in the terminal. The Hermes TUI boots; our wrapper has already attached the `wimad` Hermes adapter.
2. Judge asks Hermes: *"Survey the latest work on speculative decoding and write a one-pager."* Hermes plans, calls tools, calls the LLM repeatedly. Spans stream out to the Daytona-hosted MCP.
3. The canvas **live-tails** spans as they arrive. Timeline fills in tool by tool. Latest run's headline metrics tick in the top strip.
4. Judge prompts the Analyst in chat: *"Why was that run slow?"* → Analyst calls `aggregate` and `query_spans` → emits an **A2UI bar chart** of p95 latency by tool, plus a **flamegraph** for the slowest trace.
5. *"Compare to the previous run."* → side-by-side A2UI rendering.
6. *"Score this run for completeness."* → Analyst calls `judge_trace`; LLM-judge scores stream into a column on the run list.
7. (Stretch) *"Re-run with the slow tool replaced."* → Analyst spawns Hermes as a subprocess with a tweaked prompt, auto-compares against the prior run.

**Why all three GenUI tiers show up naturally:** trace lists and flamegraphs are stable enough to be controlled components; "show me X by Y" answers map perfectly to A2UI; novel visualizations (Sankey of tool→tool transitions, custom scrubbers) land in openGenUI.

---

## What Hermes is, and what we know about it

From the repo and docs:

| Property | Value |
|---|---|
| **Language** | Python (88.7%) + TS (7.9%) |
| **Framework** | Custom (not LangChain / LangGraph) |
| **Install** | `curl ... install.sh \| bash`; lives in `~/.hermes/` |
| **Entry points** | `hermes` (TUI), `hermes gateway` (Telegram/Discord/Slack/WhatsApp/Signal), `cli.py`, `run_agent.py` |
| **Core class** | `AIAgent` in `run_agent.py` — sync orchestration engine |
| **Loop** | `HermesCLI.process_input()` → `AIAgent.run_conversation()` → `prompt_builder.build_system_prompt()` → `runtime_provider.resolve_runtime_provider()` → API call → tool calls (loop) → SessionDB persist |
| **API modes** | `chat_completions` · `codex_responses` · `anthropic_messages` |
| **LLM providers** | 18+ (OpenAI, OpenRouter, Anthropic, Nous Portal, Gemini via OpenRouter, etc.) |
| **Tools** | 70+ across ~28 toolsets, registered via `tools/registry.py`, dispatched by `model_tools.handle_function_call()` |
| **Terminal backends** | local · Docker · SSH · Daytona · Modal · Singularity · Vercel |
| **State** | SQLite + FTS5 (`hermes_state.py`); `~/.hermes/config.yaml` for config |
| **MCP** | First-class consumer, supports stdio + HTTP, hot-reload via `/reload-mcp` |
| **Hooks** | `hermes_cli/callbacks.py` · `gateway/hooks.py` · `agent/display.py` (UI callbacks, not trace hooks) |
| **Trace observability** | ❌ Not built — issues #1501 and #6741 are open feature requests |

---

## `wimad` — the SDK

A small Python package shipping decorators + a span context manager + an exporter. Public surface is intentionally tiny.

### Public API

```python
from wimad import workflow, task, tool, agent, span, configure

# One-time setup, env-driven by default.
configure(
    ingest_url=os.getenv("WIMAD_INGEST_URL", "http://localhost:3001/traces/ingest"),
    service_name="my-agent",
    # Optional: ring-buffer size on ingest failure, batch size, batch interval
)

# Root span per logical run. The decorated function's call site opens a workflow
# span; nested @task / @tool / @agent calls become children automatically via
# OTel context propagation.
@workflow("research")
def run_research(query: str) -> str:
    notes = collect_notes(query)
    return summarize(notes)

@task("collect_notes")
def collect_notes(query: str) -> list[str]:
    return [search_web(query), search_arxiv(query)]

@tool("search_web")
def search_web(q: str) -> list[dict]:
    ...

@agent("planner")
def planner(state):
    ...

# Ad-hoc spans for code paths that don't fit a decorator
with span("custom.section", attributes={"k": "v"}):
    do_thing()
```

### Span shapes

| Decorator | Span name | Default attributes |
|---|---|---|
| `@workflow(name)` | `wimad.workflow.{name}` | `wimad.run_id`, `wimad.args` (truncated) |
| `@task(name)` | `wimad.task.{name}` | inherited from workflow context |
| `@tool(name)` | `wimad.tool.{name}` | `wimad.tool.name`, `wimad.tool.args` (truncated to 4KB) |
| `@agent(name)` | `wimad.agent.{name}` | `wimad.agent.name` |
| `span(name, ...)` | the name you pass | the attrs you pass |

All spans carry `service.name` from `configure(service_name=…)`. Errors (any exception during the wrapped call) are recorded with `status_code = "error"` and the exception message in `status_message`.

### What's inside `wimad` (not API — internals)

```
apps/wimad/
├── pyproject.toml
├── README.md
└── src/wimad/
    ├── __init__.py           # public exports
    ├── decorators.py         # @workflow, @task, @tool, @agent
    ├── context.py            # span() context manager + configure()
    ├── exporter.py           # OTel SpanExporter → batched HTTP POST + ring buffer
    ├── runs.py               # run_id lifecycle helpers
    └── adapters/
        ├── __init__.py
        └── hermes.py         # install() → monkey-patch + sets service_name
```

Built on `opentelemetry-api` + `opentelemetry-sdk`. No auto-instrumentation packages — those need framework-specific support that Hermes doesn't have. We use OTel only as primitive plumbing.

### How the exporter works

```python
class HttpSpanExporter(SpanExporter):
    def export(self, spans):
        batch = [_to_dict(s) for s in spans]
        try:
            requests.post(INGEST_URL, json={"spans": batch}, timeout=2.0)
            return SpanExportResult.SUCCESS
        except Exception:
            _ring_buffer.extend(batch)        # in-memory retry buffer
            return SpanExportResult.FAILURE
```

Batched (size + time triggered). Drops to a bounded ring buffer if ingest is unreachable; never blocks the wrapped call.

---

## Hermes adapter — `wimad.adapters.hermes`

Because Hermes is third-party, we can't decorate its source. The adapter monkey-patches three call sites *before* Hermes imports them, then everything Hermes does flows through the same `wimad` exporter as if it were decorated.

```python
# apps/wimad/src/wimad/adapters/hermes.py — sketch
from functools import wraps
from .. import configure, span

def install():
    configure(service_name="hermes")
    _patch_run_conversation()       # → hermes.workflow.run_conversation
    _patch_handle_function_call()   # → hermes.tool.{name}
    _patch_llm_calls()              # → hermes.llm.{mode}, with gen_ai.* attrs

def _patch_run_conversation():
    from run_agent import AIAgent
    orig = AIAgent.run_conversation
    @wraps(orig)
    def wrapped(self, *a, **kw):
        with span("hermes.workflow.run_conversation",
                  attributes={"hermes.query": _extract_query(a, kw)}):
            return orig(self, *a, **kw)
    AIAgent.run_conversation = wrapped

def _patch_handle_function_call():
    import model_tools
    orig = model_tools.handle_function_call
    @wraps(orig)
    def wrapped(call, *a, **kw):
        name = call.get("name", "unknown")
        with span(f"hermes.tool.{name}",
                  attributes={
                      "hermes.tool.name": name,
                      "hermes.tool.args": _truncate(call.get("arguments"), 4096),
                  }):
            return orig(call, *a, **kw)
    model_tools.handle_function_call = wrapped

def _patch_llm_calls():
    # 3 modes — chat_completions, codex_responses, anthropic_messages
    # each gets a span with gen_ai.system / gen_ai.request.model /
    # gen_ai.usage.input_tokens / gen_ai.usage.output_tokens / finish_reasons
    ...
```

### Why monkey-patch and not hooks

Hermes's hooks (`gateway/hooks.py`, `agent/display.py`) are **UI callbacks**, not lifecycle observability hooks. They fire for things like "render approval prompt" or "emit tool-preview line" — neither gives us reliable start/end timestamps for the dispatch points we care about. Patching the dispatch sites directly is more robust.

### `hermes-traced` wrapper

User runs `hermes-traced` instead of `hermes`. It's a 5-line script:

```python
# apps/wimad/bin/hermes-traced
from wimad.adapters.hermes import install
install()  # patches must be applied before hermes_cli imports run_agent
from hermes_cli.main import main
main()
```

Pip-installable via `uv pip install -e ./apps/wimad`. Places `hermes-traced` on PATH. No fork of Hermes, no source edits.

---

## Stack Decisions (final)

### Span namespace

- **`wimad.*`** — spans emitted by code we decorate (the SDK's own services, future agents we write).
- **`hermes.*`** — spans emitted by the Hermes adapter. Distinct prefix because Hermes isn't ours.

```
wimad.workflow.{name}
wimad.task.{name}
wimad.tool.{name}
wimad.agent.{name}

hermes.workflow.run_conversation
hermes.tool.{tool_name}
hermes.llm.{chat_completions|codex_responses|anthropic_messages}
hermes.mcp.{server_name}.{tool_name}
```

`service.name` per process (`hermes`, or whatever the user passes to `configure()`).

### Reuse from the starter kit

| Kit asset | Use as-is | Replace | Notes |
|---|---|---|---|
| `apps/frontend` (canvas, threads, A2UI, openGenUI) | ✅ | — | Swap lead cards for trace components |
| `apps/bff` (Hono + CopilotRuntime) | ✅ | — | No changes |
| `apps/agent` (Deep Agent runtime) | ✅ runtime | tools + prompt | Becomes the Analyst |
| `apps/mcp` (Manufact `mcp-use`) | ✅ scaffold | tool surface | Becomes the **Trace MCP server**; deployed in Daytona |
| `apps/agent/src/timing.py` | 📋 reference | — | Pattern source |
| Notion MCP wiring | ❌ | remove | Not relevant |
| Postgres + Redis (Intelligence threads) | ✅ | — | Keeps chat thread persistence; trace store is independent |

New packages:
- `apps/wimad/` (Python SDK + Hermes adapter + `hermes-traced` script)

---

## Architecture

```
┌── User's machine (local) ─────────────────────────────┐
│                                                       │
│ apps/frontend ── canvas + threads + A2UI/openGenUI    │
│ apps/bff      ── Hono + CopilotRuntime                │
│ apps/agent    ── Analyst Deep Agent (Gemini Flash)    │
│   └── backend tools via mcp-use ──┐                   │
│                                   │                   │
│ hermes (system-installed CLI in ~/.hermes/)           │
│   ↑                               │                   │
│ hermes-traced (apps/wimad/bin/)   │                   │
│   ├── wimad.adapters.hermes.install()                 │
│   ├── OTel SDK + HttpSpanExporter (batch + ring buf)  │
│   └── batched HTTP POST ──────────┼──┐                │
│                                   │  │                │
└───────────────────────────────────┼──┼────────────────┘
                                    │  │
                            HTTPS (MCP)│ HTTPS (POST /traces/ingest)
                                    │  │
                                    ▼  ▼
┌── Daytona sandbox (single deploy) ─────────────────────┐
│                                                        │
│ apps/mcp ── Manufact mcp-use ── TRACE MCP SERVER       │
│   MCP tools (read):                                    │
│     list_runs(filter, limit)                           │
│     get_run(run_id)                                    │
│     query_spans(filter, limit)                         │
│     get_trace_tree(trace_id)                           │
│     aggregate(metric, group_by, window)                │
│     find_anomalies(metric, baseline_run_id)            │
│     compare_runs(run_a, run_b)                         │
│     judge_trace(trace_id, rubric)                      │
│   HTTP routes:                                         │
│     POST /traces/ingest        (exporter → server)     │
│     GET  /traces/stream        (SSE — live tail)       │
│     GET  /healthz                                      │
│   Schema bootstrap on boot from sql/schema.sql         │
│                                                        │
│ traces.sqlite  (WAL mode, lives until sandbox dies)    │
└────────────────────────────────────────────────────────┘
                                          ▲
                                          │ MCP (optional, demo bonus)
                                  Claude / ChatGPT
```

**Why this shape:**

- **Hermes runs locally** (heavy interactive TUI; sandboxing it kills the demo). Daytona is already a Hermes terminal backend for risky tool exec — separate concern.
- **MCP server + SQLite live in Daytona** for judge optics, single-deploy simplicity, and zero tunneling.
- **One MCP server, three consumers**: Analyst (local), Hermes (could load it as stretch — self-reflection), external Claude/ChatGPT (Manufact Cloud deploy stretch).
- **No control-plane tools** in the MCP — Hermes drives itself; our MCP is read-plane + judge.
- **No persistence** beyond sandbox lifetime. Add `export_traces()` if we ever need a snapshot.

---

## Trace Schema (SQLite)

Lives at `/data/traces.sqlite` inside the sandbox. WAL mode. One row per span.

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE runs (
  run_id      TEXT PRIMARY KEY,
  query       TEXT NOT NULL,
  status      TEXT NOT NULL,           -- running | done | failed
  started_ns  INTEGER NOT NULL,
  ended_ns    INTEGER,
  model       TEXT,
  hermes_session_id TEXT
);

CREATE TABLE spans (
  trace_id        TEXT NOT NULL,
  span_id         TEXT NOT NULL,
  parent_span_id  TEXT,
  name            TEXT NOT NULL,
  service_name    TEXT NOT NULL,
  kind            TEXT NOT NULL,
  start_ns        INTEGER NOT NULL,
  end_ns          INTEGER NOT NULL,
  duration_ns     INTEGER GENERATED ALWAYS AS (end_ns - start_ns) STORED,
  status_code     TEXT,
  status_message  TEXT,
  attributes      TEXT,                -- JSON
  events          TEXT,                -- JSON array
  resource        TEXT,                -- JSON
  run_id          TEXT NOT NULL REFERENCES runs(run_id),
  PRIMARY KEY (trace_id, span_id)
);

CREATE INDEX idx_spans_run            ON spans(run_id);
CREATE INDEX idx_spans_name_start     ON spans(service_name, name, start_ns);
CREATE INDEX idx_spans_trace          ON spans(trace_id, start_ns);
CREATE INDEX idx_spans_errors         ON spans(status_code) WHERE status_code = 'error';

CREATE TABLE trace_scores (
  trace_id    TEXT NOT NULL,
  rubric      TEXT NOT NULL,           -- correctness | efficiency | safety | completeness
  score       REAL NOT NULL,           -- 0..1
  rationale   TEXT,
  judge_model TEXT,
  created_ns  INTEGER NOT NULL,
  PRIMARY KEY (trace_id, rubric)
);
```

**Schema versioning:** none. Sandbox redeploys reset everything. `apps/mcp/sql/schema.sql` runs on server boot.

---

## Components

### 1. `apps/wimad/` — SDK + Hermes adapter (new, Python)

Public package: decorators (`@workflow`, `@task`, `@tool`, `@agent`), `span()` context manager, `configure()` helper, `HttpSpanExporter`, `wimad.adapters.hermes.install()`. Ships `hermes-traced` script on PATH.

### 2. `apps/mcp/` — Trace MCP server (Manufact `mcp-use`)

Built on the existing scaffold, lives in the Daytona sandbox.

- **MCP tools**: read-plane (list/get/query/aggregate/compare) + `judge_trace`.
- **HTTP routes**: `POST /traces/ingest` (single transactional write per batch), `GET /traces/stream` (SSE), `GET /healthz`.
- **Storage**: thin DB wrapper around `bun:sqlite` (matches BFF runtime) with single writer queue.
- **`judge_trace`**: pulls trace tree, sends to Gemini with a rubric prompt, writes scores. Reuses `GEMINI_API_KEY`.

### 3. `apps/agent/` — Analyst Deep Agent

Replaces `notion_tools.py` with `trace_tools.py` that loads MCP tools from the sandbox. New system prompt: *"You are a trace insights analyst…"*. Frontend tool stubs stay React-only (kit gotcha — Gemini rejects duplicates; `apps/agent/main.py:14`).

### 4. `apps/frontend/` — Canvas

- **Left rail** — `RunList` (controlled).
- **Center** — `TraceDetail` with Timeline / Flamegraph / Span detail tabs.
- **Top strip** — `MetricsStrip`.
- **Free area** — A2UI / openGenUI components the analyst pins.
- **Live tail** — `EventSource` against `/traces/stream`.

Frontend tools: `selectTrace`, `showTimeline`, `showFlamegraph`, `showHeatmap`, `pinChart`, `renderChart` (A2UI), `renderHTML` (openGenUI).

---

## Generative UI Strategy

| Tier | Used for | Examples |
|---|---|---|
| **Controlled** | High-frequency, stable views | RunList, Flamegraph, SpanCard, MetricsStrip, Timeline |
| **A2UI** | Analyst-chosen charts | "p95 latency by tool", "tool-call distribution", "tokens vs duration scatter", "judge score breakdown" |
| **openGenUI** | One-off, novel views | Sankey of tool→tool transitions, custom scrubber, ad-hoc viz |

System-prompt rule: *"Prefer controlled components when one fits the question. Use A2UI for charts. Use openGenerativeUI only when neither fits."*

---

## Phases

Each phase is independently demoable.

1. **`wimad` SDK skeleton** — decorators + `span()` + `configure()` + `HttpSpanExporter`. Unit tests against a fake ingest endpoint. No Hermes yet — verifies the SDK works on a toy decorated function.
2. **Trace MCP server (local)** — `apps/mcp/` with `/traces/ingest`, `query_spans`, `get_trace_tree`, `aggregate`. Schema bootstrap. End-to-end: a script using `wimad` decorators emits spans → MCP ingests → `query_spans` returns them.
3. **Hermes adapter + `hermes-traced`** — monkey-patch the three call sites; run a real Hermes session; verify spans land in SQLite.
4. **Analyst tools (read-only) end-to-end** — Analyst loads MCP via mcp-use; chat answers "list runs", "show me trace X", "what was slowest" in plain text.
5. **Controlled GenUI components** — `RunList`, `Flamegraph`, `MetricsStrip`, `TraceDetail` wired via `useFrontendTool`.
6. **Live tail SSE** — `/traces/stream` + canvas EventSource.
7. **A2UI charts** — `renderChart` tool.
8. **openGenUI fallback** — `renderHTML` for novel views.
9. **Daytona deployment** — sandbox image with the MCP server + schema bootstrap, exposed HTTPS port. `WIMAD_INGEST_URL` and `MCP_SERVER_URL` set in `.env`.
10. **LLM-judge eval** — `judge_trace`, score column on RunList.
11. **Demo polish** — preload demo prompts in the chat sidebar; write a README at `apps/wimad/README.md`.

Stretch:

- **S1. Closed-loop fix-and-rerun** — Analyst spawns Hermes via subprocess.
- **S2. Manufact Cloud deploy** — `npm run -w mcp deploy`; external Claude/ChatGPT can connect.
- **S3. Hermes self-reflection** — load our trace MCP into Hermes's `~/.hermes/config.yaml`.
- **S4. Telegram surface** — `hermes gateway` config; zero new code.

---

## Risks & Gotchas

- **Hermes version drift.** Module names (`run_agent.AIAgent`, `model_tools.handle_function_call`) may rename across releases. Mitigation: pin a Hermes commit in the README; the adapter logs and warns loudly if a patch target is missing.
- **Three API call modes.** Patch all three; integration test exercises each.
- **Tool args may contain large blobs.** `wimad.tool.args` truncated to 4KB.
- **Daytona cold-start latency.** Pre-warmed snapshot mitigates.
- **SQLite write contention.** Single writer thread; readers use WAL.
- **Live-tail SSE through Daytona's reverse proxy.** Send 15s keep-alive comments; fall back to long-polling if proxy still cuts.
- **Gemini rejects duplicate function declarations** (kit gotcha — `apps/agent/main.py:14`). Frontend tool stubs stay React-only.
- **`langgraph dev` resets Postgres-stored thread state on every boot** (`apps/agent/main.py:45`). Independent of trace store.
- **Ingest reachability.** Local ring buffer in the exporter handles offline; `--local-ingest` flag points at localhost MCP for dev.

---

## Out of Scope

- Multi-tenant auth.
- Production-grade ingest (rate limiting, backpressure).
- Real OTLP-over-gRPC compliance — JSON over HTTP only.
- Schema migrations / persistence beyond a sandbox lifetime.
- PII redaction (no real user data in the demo).
- Sampling (always-on for the demo).
- Meta-observability (tracing the Analyst itself).
- Klira platform integration.
- Forking hermes-agent.
- Building our own CLI (`hermes` exists).
- Building a Telegram surface (`hermes gateway` exists).

---

## All open questions resolved

1. ~~NousResearch hermes-agent stack~~ — Python custom framework. Patch `AIAgent.run_conversation`, `model_tools.handle_function_call`, three API-mode call paths.
2. ~~Does Hermes already do tracing?~~ — No. Open issues #1501 and #6741 confirm the gap. We build it.
3. ~~Daytona sandbox image~~ — Bun runtime + Manufact `mcp-use` MCP server + `sql/schema.sql` bootstrap. Pre-warmed snapshot.
4. ~~CLI~~ — Hermes's own `hermes`. We ship `hermes-traced` wrapper only.
5. ~~A/B compare~~ — `compare_runs(run_a, run_b)` over two recent runs.
6. ~~Single sandbox or per-run~~ — single long-lived.
7. ~~Where Hermes lives in the repo~~ — it doesn't. User installs Hermes via curl; we ship `apps/wimad/`.
8. ~~Closed-loop trigger~~ — stretch only.
9. ~~Telemetry packaging~~ — `apps/wimad/`, installed once with `uv pip install -e ./apps/wimad`. Wrapper `hermes-traced` placed on PATH.
10. ~~Span namespace~~ — `wimad.*` for our code, `hermes.*` for the adapter.
11. ~~Live tail vs query-on-demand~~ — live tail via SSE.
12. ~~LLM-judge eval~~ — in scope, phase 10.
13. ~~Persistence~~ — none. Sandbox-bounded.
14. ~~Decorator API vs monkey-patch~~ — both. Decorators are the public SDK; monkey-patch is the third-party adapter pattern. Same primitives underneath.
15. ~~Package name~~ — `wimad`.
