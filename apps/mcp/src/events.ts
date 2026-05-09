import { EventEmitter } from "node:events";
import type { IngestSpan } from "./db";

// In-memory pub/sub for live-tail SSE. The HTTP /traces/ingest handler
// publishes after each successful insert; /traces/stream subscribes per
// connection. We don't persist events — fan-out is best-effort.

export const traceEvents = new EventEmitter();

// Bump default — multiple canvas tabs subscribing simultaneously is normal.
traceEvents.setMaxListeners(50);

export type SpanEvent = { type: "span"; span: IngestSpan };
