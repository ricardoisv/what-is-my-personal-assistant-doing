import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import {
  ingestSpans,
  listRuns,
  getRun,
  querySpans,
  getTraceTree,
  aggregate,
  type IngestSpan,
} from "./db";
import { traceEvents, type SpanEvent } from "./events";

// Standalone HTTP server that runs alongside the mcp-use MCP server.
// - POST /traces/ingest    wimad exporter → SQLite
// - GET  /traces/stream    SSE live tail to the canvas
// - GET  /healthz          liveness for `npm run dev` checks
//
// Kept in the same process as the MCP server so they share one SQLite
// connection (no cross-process WAL contention).

export function startHttpServer(port: number): void {
  const app = new Hono();

  // The canvas hits this from a different origin (Next.js on :3010 / BFF
  // on :4010). Wide-open CORS is fine for a hackathon demo.
  app.use("*", cors());

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.post("/traces/ingest", async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { spans?: IngestSpan[] }
      | null;
    if (!body?.spans?.length) {
      return c.json({ ingested: 0 });
    }
    try {
      ingestSpans(body.spans);
      for (const span of body.spans) {
        traceEvents.emit("span", { type: "span", span } satisfies SpanEvent);
      }
      return c.json({ ingested: body.spans.length });
    } catch (e) {
      console.error("[ingest] failed:", e);
      return c.json({ error: "ingest failed" }, 500);
    }
  });

  // Convenience read endpoints for the canvas (plain HTTP, not MCP).
  // The Analyst Deep Agent uses the MCP tools for the same data.
  app.get("/runs", (c) => {
    const limit = Number(c.req.query("limit") ?? 50);
    const status = c.req.query("status");
    const runs = listRuns({
      limit,
      status: status as "running" | "done" | "failed" | undefined,
    });
    return c.json({ runs });
  });

  app.get("/runs/:run_id", (c) => {
    const run = getRun(c.req.param("run_id"));
    if (!run) return c.json({ error: "not found" }, 404);
    const spans = querySpans({ run_id: run.run_id, limit: 5000 });
    const root = spans.find((s) => /\.workflow\./.test(s.name)) ?? null;
    return c.json({ run, workflow: root, spans });
  });

  app.get("/traces/:trace_id", (c) => {
    const { root, spans } = getTraceTree(c.req.param("trace_id"));
    return c.json({ trace_id: c.req.param("trace_id"), root, spans });
  });

  app.get("/spans", (c) => {
    const run_id = c.req.query("run_id");
    const trace_id = c.req.query("trace_id");
    const name_prefix = c.req.query("name_prefix");
    const service_name = c.req.query("service_name");
    const status_code = c.req.query("status_code");
    const limit = Number(c.req.query("limit") ?? 200);
    const spans = querySpans({
      run_id,
      trace_id,
      name_prefix,
      service_name,
      status_code,
      limit,
    });
    return c.json({ spans });
  });

  app.get("/aggregate", (c) => {
    const metric = (c.req.query("metric") ?? "duration") as "duration" | "count";
    const group_by = (c.req.query("group_by") ?? "name") as
      | "name"
      | "service_name"
      | "run_id"
      | "status_code";
    const run_id = c.req.query("run_id");
    const aggregates = aggregate({ metric, group_by, run_id });
    return c.json({ aggregates });
  });

  app.get("/traces/stream", (c) => {
    return streamSSE(c, async (stream) => {
      const onSpan = (evt: SpanEvent) => {
        stream
          .writeSSE({
            event: "span",
            data: JSON.stringify(evt.span),
          })
          .catch(() => {
            // client gone; cleanup happens via the outer abort handler
          });
      };

      traceEvents.on("span", onSpan);

      // Initial hello so EventSource fires onopen quickly.
      await stream.writeSSE({ event: "hello", data: "{}" });

      // Keepalive comment every 15s — Daytona's reverse proxy will cut
      // idle SSE streams otherwise.
      const keepalive = setInterval(() => {
        stream.writeSSE({ event: "ping", data: "{}" }).catch(() => {});
      }, 15_000);

      // Wait until client disconnects.
      stream.onAbort(() => {
        clearInterval(keepalive);
        traceEvents.off("span", onSpan);
      });

      // Block forever (until aborted).
      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });
    });
  });

  serve({ fetch: app.fetch, port }, () => {
    console.log(`[trace-http] listening on http://localhost:${port}`);
    console.log(`              POST /traces/ingest  (wimad exporter)`);
    console.log(`              GET  /traces/stream  (canvas live tail)`);
  });
}
