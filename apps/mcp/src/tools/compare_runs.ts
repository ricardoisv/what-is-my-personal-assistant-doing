import type { MCPServer } from "mcp-use/server";
import { text } from "mcp-use/server";
import { z } from "zod";
import { compareRuns } from "../db";

export function registerCompareRuns(server: MCPServer): void {
  server.tool(
    {
      name: "compare_runs",
      description:
        "Diff two runs by span-name aggregates. For each name appearing in either run, returns the per-run stats plus delta_total_ns (run_b - run_a). Sorted by absolute delta. Useful for 'why was today's run slower than yesterday's?' questions.",
      schema: z.object({
        run_a: z.string(),
        run_b: z.string(),
      }),
    },
    async ({ run_a, run_b }) => {
      const rows = compareRuns(run_a, run_b);
      return text(JSON.stringify({ run_a, run_b, comparison: rows }, null, 2));
    },
  );
}
