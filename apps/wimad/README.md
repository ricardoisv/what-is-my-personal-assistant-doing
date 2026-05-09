# wimad — What Is My Assistant Doing

Tiny Python tracing SDK for AI agents. Decorators emit OTel spans; spans are batched and POSTed to a SQLite-backed MCP server.

## Install

```bash
uv pip install -e ./apps/wimad
```

This places `hermes-traced` on PATH.

## Use it for your own agent

```python
from wimad import workflow, task, tool, agent, span, configure

configure(service_name="my-agent")

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
```

`configure()` is idempotent and reads `WIMAD_INGEST_URL` (default `http://localhost:3001/traces/ingest`).

## Use it to trace Hermes

1. Install Hermes: `curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash`
2. Run `hermes setup` to point Hermes at your model provider (OpenRouter recommended).
3. Run `hermes-traced` instead of `hermes`. The wrapper monkey-patches Hermes's dispatch points before launch — no fork, no source edits.

## Span shapes

| Decorator | Span name | Default attributes |
|---|---|---|
| `@workflow(name)` | `wimad.workflow.{name}` | `wimad.run_id`, `wimad.workflow.query` |
| `@task(name)` | `wimad.task.{name}` | inherited via OTel context |
| `@tool(name)` | `wimad.tool.{name}` | `wimad.tool.name`, `wimad.tool.args` (truncated) |
| `@agent(name)` | `wimad.agent.{name}` | `wimad.agent.name` |

The Hermes adapter emits under `hermes.*` (`hermes.workflow.run_conversation`, `hermes.tool.{name}`, `hermes.llm.{mode}`).

## Env vars

| Var | Default | Purpose |
|---|---|---|
| `WIMAD_INGEST_URL` | `http://localhost:3001/traces/ingest` | Where to POST batched spans |
| `WIMAD_BATCH_SIZE` | `32` | Max spans per batch |
| `WIMAD_BATCH_INTERVAL_MS` | `500` | Max ms between flushes |
| `WIMAD_DEBUG` | unset | Log every span to stderr |

## Architecture

OTel SDK manages trace context (free `trace_id` / `span_id` and parent linking). A custom `BatchSpanProcessor` + `HttpSpanExporter` sends batches over HTTP. If the ingest endpoint is unreachable the exporter buffers in memory and retries on the next flush.
