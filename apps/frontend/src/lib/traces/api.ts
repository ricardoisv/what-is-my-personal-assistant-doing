// Fetch helpers for the canvas. The trace HTTP server runs alongside the
// MCP (apps/mcp/src/http.ts), default port 3012. Endpoints are plain
// JSON over HTTP — the Analyst Deep Agent uses the MCP-protocol versions
// of the same data.

import type { AggregateRow, Run, Span } from "./types";

const TRACE_BASE_URL =
  process.env.NEXT_PUBLIC_TRACE_HTTP_URL || "http://localhost:3012";

async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(`${TRACE_BASE_URL}${path}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}

export function listRuns(opts?: {
  limit?: number;
  status?: "running" | "done" | "failed";
}): Promise<{ runs: Run[] }> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.status) params.set("status", opts.status);
  const qs = params.toString();
  return fetchJson<{ runs: Run[] }>(`/runs${qs ? `?${qs}` : ""}`);
}

export function getRun(run_id: string): Promise<{
  run: Run;
  workflow: Span | null;
  spans: Span[];
}> {
  return fetchJson(`/runs/${encodeURIComponent(run_id)}`);
}

export function getTrace(trace_id: string): Promise<{
  trace_id: string;
  root: Span | null;
  spans: Span[];
}> {
  return fetchJson(`/traces/${encodeURIComponent(trace_id)}`);
}

export function querySpans(opts: {
  run_id?: string;
  trace_id?: string;
  name_prefix?: string;
  service_name?: string;
  status_code?: "ok" | "error";
  limit?: number;
}): Promise<{ spans: Span[] }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }
  const qs = params.toString();
  return fetchJson(`/spans${qs ? `?${qs}` : ""}`);
}

export function fetchAggregate(opts: {
  metric?: "duration" | "count";
  group_by?: "name" | "service_name" | "run_id" | "status_code";
  run_id?: string;
}): Promise<{ aggregates: AggregateRow[] }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }
  const qs = params.toString();
  return fetchJson(`/aggregate${qs ? `?${qs}` : ""}`);
}

export function streamUrl(): string {
  return `${TRACE_BASE_URL}/traces/stream`;
}
