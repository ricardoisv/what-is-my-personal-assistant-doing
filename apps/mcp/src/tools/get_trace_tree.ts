import type { MCPServer } from "mcp-use/server";
import { text } from "mcp-use/server";
import { z } from "zod";
import { getTraceTree } from "../db";

export function registerGetTraceTree(server: MCPServer): void {
  server.tool(
    {
      name: "get_trace_tree",
      description:
        "Fetch every span on a trace, ordered by start time. The caller can rebuild the parent/child tree from `parent_span_id`. Includes the root span and total span count.",
      schema: z.object({ trace_id: z.string() }),
    },
    async ({ trace_id }) => {
      const { root, spans } = getTraceTree(trace_id);
      return text(JSON.stringify({ trace_id, root, spans }, null, 2));
    },
  );
}
