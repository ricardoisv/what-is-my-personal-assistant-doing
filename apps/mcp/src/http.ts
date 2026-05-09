import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { ingestSpans, type IngestSpan } from "./db";
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
