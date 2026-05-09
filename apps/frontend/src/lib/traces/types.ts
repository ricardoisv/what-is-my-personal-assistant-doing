// Mirrors apps/agent/src/trace_state.py (Python TypedDicts) and
// apps/mcp/src/db.ts (SQLite row shapes returned over /runs etc).

export type Run = {
  run_id: string;
  query: string | null;
  status: "running" | "done" | "failed";
  started_ns: number;
  ended_ns: number | null;
  model: string | null;
  hermes_session_id?: string | null;
};

export type Span = {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  name: string;
  service_name: string;
  kind: string;
  start_ns: number;
  end_ns: number;
  duration_ns: number;
  status_code: "ok" | "error" | string | null;
  status_message: string | null;
  attributes: Record<string, unknown>;
  events: { ts: number; name: string; attributes: Record<string, unknown> }[];
  resource: Record<string, unknown>;
  run_id: string | null;
};

export type AggregateRow = {
  group_key: string;
  count: number;
  total_ns: number;
  p50_ns: number;
  p95_ns: number;
  max_ns: number;
};

export type PinnedChart = {
  id: string;
  kind: "controlled" | "a2ui" | "html";
  name?: string;
  props?: Record<string, unknown>;
  html?: string;
};

export type Header = {
  title: string;
  subtitle: string;
};

export type AgentState = {
  runs: Run[];
  selectedRunId: string | null;
  selectedTraceId: string | null;
  pinnedCharts: PinnedChart[];
  header: Header;
};
