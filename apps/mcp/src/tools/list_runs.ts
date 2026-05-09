import type { MCPServer } from "mcp-use/server";
import { text } from "mcp-use/server";
import { z } from "zod";
import { listRuns } from "../db";

export function registerListRuns(server: MCPServer): void {
  server.tool(
    {
      name: "list_runs",
      description:
        "List Hermes (or wimad-decorated) runs, most recent first. Returns run_id, query, status, started_ns, ended_ns, and model when available.",
      schema: z.object({
        limit: z.number().int().min(1).max(500).optional().default(50),
        status: z
          .enum(["running", "done", "failed"])
          .optional()
          .describe("Filter to runs in a single status."),
      }),
    },
    async ({ limit, status }) => {
      const rows = listRuns({ limit, status });
      return text(JSON.stringify({ runs: rows }, null, 2));
    },
  );
}
