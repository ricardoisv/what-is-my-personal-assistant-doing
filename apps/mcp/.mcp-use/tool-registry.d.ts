// Auto-generated tool registry types - DO NOT EDIT MANUALLY
// This file is regenerated whenever tools are added, removed, or updated during development
// Generated at: 2026-05-09T23:14:20.449Z

declare module "mcp-use/react" {
  interface ToolRegistry {
    "aggregate": {
      input: { "metric": "duration" | "count"; "group_by": "name" | "service_name" | "run_id" | "status_code"; "run_id"?: string | undefined; "service_name"?: string | undefined };
      output: Record<string, unknown>;
    };
    "compare_runs": {
      input: { "run_a": string; "run_b": string };
      output: Record<string, unknown>;
    };
    "get_run": {
      input: { "run_id": string };
      output: Record<string, unknown>;
    };
    "get_trace_tree": {
      input: { "trace_id": string };
      output: Record<string, unknown>;
    };
    "list_runs": {
      input: { "limit": number | undefined; "status"?: "running" | "done" | "failed" | undefined };
      output: Record<string, unknown>;
    };
    "query_spans": {
      input: { "run_id"?: string | undefined; "trace_id"?: string | undefined; "name_prefix"?: string | undefined; "service_name"?: string | undefined; "status_code"?: "ok" | "error" | undefined; "limit": number | undefined };
      output: Record<string, unknown>;
    };
  }
}

export {};
