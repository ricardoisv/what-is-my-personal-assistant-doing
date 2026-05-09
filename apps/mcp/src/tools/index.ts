import type { MCPServer } from "mcp-use/server";
import { registerListRuns } from "./list_runs";
import { registerGetRun } from "./get_run";
import { registerQuerySpans } from "./query_spans";
import { registerGetTraceTree } from "./get_trace_tree";
import { registerAggregate } from "./aggregate";
import { registerCompareRuns } from "./compare_runs";
import { registerJudgeTrace } from "./judge_trace";

/**
 * Register every trace-MCP tool on the given server. Tools return JSON
 * stringified into an MCP `text()` result so any MCP client (the Analyst
 * Deep Agent via mcp-use, or Claude/ChatGPT) can parse and use them.
 */
export function registerTraceTools(server: MCPServer): void {
  registerListRuns(server);
  registerGetRun(server);
  registerQuerySpans(server);
  registerGetTraceTree(server);
  registerAggregate(server);
  registerCompareRuns(server);
  registerJudgeTrace(server);
}
