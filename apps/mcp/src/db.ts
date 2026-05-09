import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Per-batch span shape received from the wimad exporter. Mirrors what
// HttpSpanExporter._span_to_dict produces in apps/wimad/src/wimad/exporter.py.
export type IngestSpan = {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  name: string;
  service_name: string;
  kind: string;
  start_ns: number;
  end_ns: number;
  status_code: "ok" | "error" | string;
  status_message: string | null;
  attributes: Record<string, unknown>;
  events: { ts: number; name: string; attributes: Record<string, unknown> }[];
  resource: Record<string, unknown>;
  run_id: string | null;
};

export type Run = {
  run_id: string;
  query: string | null;
  status: "running" | "done" | "failed";
  started_ns: number;
  ended_ns: number | null;
  model: string | null;
  hermes_session_id: string | null;
};

export type StoredSpan = {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  name: string;
  service_name: string;
  kind: string;
  start_ns: number;
  end_ns: number;
  duration_ns: number;
  status_code: string | null;
  status_message: string | null;
  attributes: Record<string, unknown>;
  events: unknown[];
  resource: Record<string, unknown>;
  run_id: string | null;
};

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  const path = process.env.TRACE_DB_PATH || "./traces.sqlite";
  _db = new Database(path);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  // Schema bootstrap — runs every boot, idempotent via IF NOT EXISTS.
  const schemaPath = join(__dirname, "..", "sql", "schema.sql");
  const schema = readFileSync(schemaPath, "utf8");
  _db.exec(schema);

  return _db;
}

// ---------------------------------------------------------------- ingest

const INSERT_SPAN = `
  INSERT OR REPLACE INTO spans (
    trace_id, span_id, parent_span_id, name, service_name, kind,
    start_ns, end_ns, status_code, status_message,
    attributes, events, resource, run_id
  ) VALUES (
    @trace_id, @span_id, @parent_span_id, @name, @service_name, @kind,
    @start_ns, @end_ns, @status_code, @status_message,
    @attributes, @events, @resource, @run_id
  )
`;

const INSERT_RUN = `
  INSERT OR IGNORE INTO runs (run_id, status, started_ns)
  VALUES (?, 'running', ?)
`;

const UPDATE_RUN_FROM_WORKFLOW = `
  UPDATE runs
     SET ended_ns = ?,
         status = ?,
         query = COALESCE(query, ?)
   WHERE run_id = ?
`;

/**
 * Insert spans + maintain the runs table from workflow-root spans.
 *
 * A span is treated as a workflow root when its name matches `*.workflow.*`
 * (covers both `wimad.workflow.{name}` and `hermes.workflow.{name}`).
 * Errors on any span in the run promote the run's status to `failed`.
 */
export function ingestSpans(spans: IngestSpan[]): void {
  const conn = db();
  const insertSpan = conn.prepare(INSERT_SPAN);
  const insertRun = conn.prepare(INSERT_RUN);
  const updateRun = conn.prepare(UPDATE_RUN_FROM_WORKFLOW);
  const markFailed = conn.prepare(
    `UPDATE runs SET status = 'failed' WHERE run_id = ? AND status != 'failed'`,
  );

  const tx = conn.transaction((rows: IngestSpan[]) => {
    for (const s of rows) {
      insertSpan.run({
        trace_id: s.trace_id,
        span_id: s.span_id,
        parent_span_id: s.parent_span_id,
        name: s.name,
        service_name: s.service_name,
        kind: s.kind,
        start_ns: s.start_ns,
        end_ns: s.end_ns,
        status_code: s.status_code ?? null,
        status_message: s.status_message ?? null,
        attributes: JSON.stringify(s.attributes ?? {}),
        events: JSON.stringify(s.events ?? []),
        resource: JSON.stringify(s.resource ?? {}),
        run_id: s.run_id,
      });

      if (s.run_id) {
        insertRun.run(s.run_id, s.start_ns);

        if (/\.workflow\./.test(s.name) && s.end_ns) {
          const status = s.status_code === "error" ? "failed" : "done";
          const query = pickQuery(s.attributes);
          updateRun.run(s.end_ns, status, query, s.run_id);
        }

        if (s.status_code === "error") {
          markFailed.run(s.run_id);
        }
      }
    }
  });

  tx(spans);
}

function pickQuery(attrs: Record<string, unknown>): string | null {
  const keys = ["wimad.workflow.query", "hermes.query"];
  for (const k of keys) {
    const v = attrs[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

// ---------------------------------------------------------------- reads

export function listRuns(opts: { limit?: number; status?: string }): Run[] {
  const conn = db();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  if (opts.status) {
    return conn
      .prepare(
        `SELECT * FROM runs WHERE status = ? ORDER BY started_ns DESC LIMIT ?`,
      )
      .all(opts.status, limit) as Run[];
  }
  return conn
    .prepare(`SELECT * FROM runs ORDER BY started_ns DESC LIMIT ?`)
    .all(limit) as Run[];
}

export function getRun(run_id: string): Run | undefined {
  return db().prepare(`SELECT * FROM runs WHERE run_id = ?`).get(run_id) as
    | Run
    | undefined;
}

export function querySpans(opts: {
  run_id?: string;
  trace_id?: string;
  name_prefix?: string;
  service_name?: string;
  status_code?: string;
  limit?: number;
}): StoredSpan[] {
  const conn = db();
  const conds: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.run_id) {
    conds.push("run_id = @run_id");
    params.run_id = opts.run_id;
  }
  if (opts.trace_id) {
    conds.push("trace_id = @trace_id");
    params.trace_id = opts.trace_id;
  }
  if (opts.name_prefix) {
    conds.push("name LIKE @name_prefix");
    params.name_prefix = `${opts.name_prefix}%`;
  }
  if (opts.service_name) {
    conds.push("service_name = @service_name");
    params.service_name = opts.service_name;
  }
  if (opts.status_code) {
    conds.push("status_code = @status_code");
    params.status_code = opts.status_code;
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 5000);
  const rows = conn
    .prepare(
      `SELECT * FROM spans ${where} ORDER BY start_ns ASC LIMIT ${limit}`,
    )
    .all(params) as Array<StoredSpan & { attributes: string; events: string; resource: string }>;
  return rows.map(decodeSpan);
}

function decodeSpan(
  r: StoredSpan & { attributes: string; events: string; resource: string },
): StoredSpan {
  return {
    ...r,
    attributes: safeParse(r.attributes, {}),
    events: safeParse(r.events, []),
    resource: safeParse(r.resource, {}),
  };
}

function safeParse<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string") return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function getTraceTree(trace_id: string): {
  root: StoredSpan | null;
  spans: StoredSpan[];
} {
  const spans = querySpans({ trace_id, limit: 5000 });
  const root = spans.find((s) => !s.parent_span_id) ?? null;
  return { root, spans };
}

// ---------------------------------------------------------------- aggregate

export type AggregateRow = {
  group_key: string;
  count: number;
  total_ns: number;
  p50_ns: number;
  p95_ns: number;
  max_ns: number;
};

export function aggregate(opts: {
  metric: "duration" | "count";
  group_by: "name" | "service_name" | "run_id" | "status_code";
  run_id?: string;
  service_name?: string;
}): AggregateRow[] {
  const conn = db();
  const conds: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.run_id) {
    conds.push("run_id = @run_id");
    params.run_id = opts.run_id;
  }
  if (opts.service_name) {
    conds.push("service_name = @service_name");
    params.service_name = opts.service_name;
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  // SQLite has no native percentile; compute in JS over the matched rows.
  const rows = conn
    .prepare(
      `SELECT ${opts.group_by} AS group_key, duration_ns FROM spans ${where} ORDER BY ${opts.group_by}, duration_ns ASC`,
    )
    .all(params) as { group_key: string; duration_ns: number }[];

  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    const k = String(r.group_key ?? "<null>");
    const arr = buckets.get(k) ?? [];
    arr.push(r.duration_ns);
    buckets.set(k, arr);
  }

  const out: AggregateRow[] = [];
  for (const [group_key, durations] of buckets) {
    const sorted = durations.slice().sort((a, b) => a - b);
    const total = sorted.reduce((s, n) => s + n, 0);
    out.push({
      group_key,
      count: sorted.length,
      total_ns: total,
      p50_ns: percentile(sorted, 0.5),
      p95_ns: percentile(sorted, 0.95),
      max_ns: sorted[sorted.length - 1] ?? 0,
    });
  }
  out.sort((a, b) => b.total_ns - a.total_ns);
  return out;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.floor(p * (sortedAsc.length - 1)),
  );
  return sortedAsc[idx];
}

// ---------------------------------------------------------------- compare

export type CompareRow = {
  group_key: string;
  a: AggregateRow | null;
  b: AggregateRow | null;
  delta_total_ns: number;
};

export function compareRuns(run_a: string, run_b: string): CompareRow[] {
  const aRows = aggregate({ metric: "duration", group_by: "name", run_id: run_a });
  const bRows = aggregate({ metric: "duration", group_by: "name", run_id: run_b });
  const aMap = new Map(aRows.map((r) => [r.group_key, r]));
  const bMap = new Map(bRows.map((r) => [r.group_key, r]));
  const keys = new Set<string>([...aMap.keys(), ...bMap.keys()]);
  const out: CompareRow[] = [];
  for (const k of keys) {
    const a = aMap.get(k) ?? null;
    const b = bMap.get(k) ?? null;
    out.push({
      group_key: k,
      a,
      b,
      delta_total_ns: (b?.total_ns ?? 0) - (a?.total_ns ?? 0),
    });
  }
  out.sort(
    (x, y) => Math.abs(y.delta_total_ns) - Math.abs(x.delta_total_ns),
  );
  return out;
}
