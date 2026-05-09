import { MCPServer } from "mcp-use/server";
import { registerTraceTools } from "./src/tools";
import { startHttpServer } from "./src/http";
import { db } from "./src/db";

const MCP_PORT = Number(process.env.MCP_PORT ?? 3011);
const HTTP_PORT = Number(process.env.TRACE_HTTP_PORT ?? 3012);

const server = new MCPServer({
  name: "wimad-trace-mcp",
  title: "wimad Trace MCP",
  version: "0.1.0",
  description:
    "Read-plane MCP for the wimad trace store: list_runs, get_run, query_spans, get_trace_tree, aggregate, compare_runs. The Analyst Deep Agent in this kit consumes these tools via mcp-use; external Claude/ChatGPT can connect too.",
  baseUrl: process.env.MCP_URL || `http://localhost:${MCP_PORT}`,
  favicon: "favicon.ico",
  websiteUrl: "https://github.com/ricardoisv/what-is-my-personal-assistant-doing",
  icons: [
    {
      src: "icon.svg",
      mimeType: "image/svg+xml",
      sizes: ["512x512"],
    },
  ],
});

registerTraceTools(server);

// Boot the SQLite layer eagerly so schema-bootstrap errors surface at start
// rather than on first ingest.
db();

// HTTP ingest + SSE on a separate port, same process.
startHttpServer(HTTP_PORT);

// Pass MCP_PORT explicitly — mcp-use's listen() reads PORT (not MCP_PORT)
// so an unforwarded env var would silently default it to 3000.
server.listen(MCP_PORT).then(() => {
  console.log(`[mcp] wimad-trace-mcp listening on port ${MCP_PORT}`);
});
