"""Smoke-test wimad end-to-end against a running trace MCP server.

Usage:
    cd apps/mcp && MCP_PORT=3011 TRACE_HTTP_PORT=3012 npx tsx index.ts &
    cd apps/wimad && uv run python scripts/smoke_test.py

Emits a workflow with two task spans and three tool spans, then sleeps a
moment to let the BatchSpanProcessor flush. Ingest endpoint should return
ingested=N for each batch.
"""
from __future__ import annotations

import time

from wimad import workflow, task, tool, configure


configure(service_name="wimad-smoke-test")


@tool("search_web")
def search_web(q: str) -> list[str]:
    time.sleep(0.05)
    return [f"result-{i} for {q}" for i in range(3)]


@tool("search_arxiv")
def search_arxiv(q: str) -> list[str]:
    time.sleep(0.07)
    return [f"paper-{i} for {q}" for i in range(2)]


@tool("summarize")
def summarize(items: list[str]) -> str:
    time.sleep(0.03)
    return f"summary of {len(items)} items"


@task("collect_notes")
def collect_notes(query: str) -> list[str]:
    web = search_web(query)
    arxiv = search_arxiv(query)
    return web + arxiv


@task("compose_brief")
def compose_brief(items: list[str]) -> str:
    return summarize(items)


@workflow("research")
def run_research(query: str) -> str:
    notes = collect_notes(query)
    return compose_brief(notes)


if __name__ == "__main__":
    out = run_research("speculative decoding")
    print("workflow returned:", out)
    # Give the BatchSpanProcessor a beat to flush.
    time.sleep(2)
    print("done — spans should now be in apps/mcp/traces.sqlite")
