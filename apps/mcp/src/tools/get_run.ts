import type { MCPServer } from "mcp-use/server";
import { text } from "mcp-use/server";
import { z } from "zod";
import { getRun, querySpans } from "../db";

export function registerGetRun(server: MCPServer): void {
  server.tool(
    {
      name: "get_run",
      description:
        "Fetch a single run with its top-level workflow span. Returns the run row plus a summary of the workflow span (name, duration, status). Use get_trace_tree for the full span tree.",
      schema: z.object({ run_id: z.string() }),
    },
    async ({ run_id }) => {
      const run = getRun(run_id);
      if (!run) {
        return text(JSON.stringify({ error: "run not found", run_id }));
      }
      const spans = querySpans({ run_id, limit: 5000 });
      const root = spans.find((s) => /\.workflow\./.test(s.name)) ?? null;
      return text(
        JSON.stringify({ run, workflow: root, span_count: spans.length }, null, 2),
      );
    },
  );
}
