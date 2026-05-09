-- Trace store schema. Bootstrapped on server boot.
--
-- runs is upserted from incoming spans: a fresh run_id seen on any span
-- inserts a `running` row, and the workflow-root span's end transitions
-- it to `done` (or `failed` if status_code='error'). spans.run_id is
-- nullable so spans emitted outside a workflow are still ingested.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS runs (
  run_id            TEXT PRIMARY KEY,
  query             TEXT,
  status            TEXT NOT NULL,
  started_ns        INTEGER NOT NULL,
  ended_ns          INTEGER,
  model             TEXT,
  hermes_session_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_started_desc
  ON runs(started_ns DESC);

CREATE TABLE IF NOT EXISTS spans (
  trace_id        TEXT NOT NULL,
  span_id         TEXT NOT NULL,
  parent_span_id  TEXT,
  name            TEXT NOT NULL,
  service_name    TEXT NOT NULL,
  kind            TEXT NOT NULL,
  start_ns        INTEGER NOT NULL,
  end_ns          INTEGER NOT NULL,
  duration_ns     INTEGER GENERATED ALWAYS AS (end_ns - start_ns) STORED,
  status_code     TEXT,
  status_message  TEXT,
  attributes      TEXT,
  events          TEXT,
  resource        TEXT,
  run_id          TEXT,
  PRIMARY KEY (trace_id, span_id)
);

CREATE INDEX IF NOT EXISTS idx_spans_run         ON spans(run_id);
CREATE INDEX IF NOT EXISTS idx_spans_name_start  ON spans(service_name, name, start_ns);
CREATE INDEX IF NOT EXISTS idx_spans_trace       ON spans(trace_id, start_ns);
CREATE INDEX IF NOT EXISTS idx_spans_errors      ON spans(status_code) WHERE status_code = 'error';

CREATE TABLE IF NOT EXISTS trace_scores (
  trace_id    TEXT NOT NULL,
  rubric      TEXT NOT NULL,
  score       REAL NOT NULL,
  rationale   TEXT,
  judge_model TEXT,
  created_ns  INTEGER NOT NULL,
  PRIMARY KEY (trace_id, rubric)
);
