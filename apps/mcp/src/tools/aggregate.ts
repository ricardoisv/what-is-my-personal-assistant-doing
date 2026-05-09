import type { MCPServer } from "mcp-use/server";
import { text } from "mcp-use/server";
import { z } from "zod";
import { aggregate } from "../db";

export function registerAggregate(server: MCPServer): void {
  server.tool(
    {
      name: "aggregate",
      description:
        "Aggregate span durations grouped by span name, service, run, or status. Returns count, total_ns, p50_ns, p95_ns, max_ns per group, sorted by total_ns desc. Useful for 'which tool dominates wall time' questions.",
      schema: z.object({
        metric: z.enum(["duration", "count"]).default("duration"),
        group_by: z
          .enum(["name", "service_name", "run_id", "status_code"])
          .default("name"),
        run_id: z.string().optional(),
        service_name: z.string().optional(),
      }),
    },
    async (args) => {
      const rows = aggregate(args);
      return text(JSON.stringify({ aggregates: rows }, null, 2));
    },
  );
}
