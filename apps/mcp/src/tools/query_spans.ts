import type { MCPServer } from "mcp-use/server";
import { text } from "mcp-use/server";
import { z } from "zod";
import { querySpans } from "../db";

export function registerQuerySpans(server: MCPServer): void {
  server.tool(
    {
      name: "query_spans",
      description:
        "Query individual spans by run, trace, name prefix, service, or status. Returns up to `limit` spans ordered by start time.",
      schema: z.object({
        run_id: z.string().optional(),
        trace_id: z.string().optional(),
        name_prefix: z
          .string()
          .optional()
          .describe(
            "Match by span-name prefix, e.g. 'hermes.tool.' for all tool calls.",
          ),
        service_name: z.string().optional(),
        status_code: z.enum(["ok", "error"]).optional(),
        limit: z.number().int().min(1).max(5000).optional().default(200),
      }),
    },
    async (args) => {
      const rows = querySpans(args);
      return text(JSON.stringify({ spans: rows }, null, 2));
    },
  );
}
