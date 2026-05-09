"""HttpSpanExporter — batches OTel spans and POSTs JSON to an ingest endpoint.

If the endpoint is unreachable the batch goes into a bounded ring buffer and is
retried on the next export cycle. wimad never blocks the wrapped call site.

Wire format (one JSON request, batched):

    POST /traces/ingest
    {
      "spans": [
        {
          "trace_id": "<32-hex>",
          "span_id": "<16-hex>",
          "parent_span_id": "<16-hex>" | null,
          "name": "wimad.tool.search_web",
          "service_name": "my-agent",
          "kind": "internal" | "client" | "server" | ...,
          "start_ns": 1747...,
          "end_ns": 1747...,
          "status_code": "ok" | "error",
          "status_message": "..." | null,
          "attributes": { "wimad.run_id": "...", ... },
          "events": [{"ts": 1747..., "name": "...", "attributes": {...}}],
          "resource": { "service.name": "...", ... },
          "run_id": "..." | null         # convenience: also lifted from attributes
        },
        ...
      ]
    }
"""

from __future__ import annotations

import json
import logging
from collections import deque
from threading import Lock
from typing import Any, Sequence

import requests
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult
from opentelemetry.trace import StatusCode

_log = logging.getLogger("wimad.exporter")


class HttpSpanExporter(SpanExporter):
    """OTel SpanExporter that POSTs batches to a JSON HTTP endpoint."""

    def __init__(
        self,
        *,
        ingest_url: str,
        ring_buffer_size: int = 1000,
        timeout_s: float = 2.0,
        debug: bool = False,
    ) -> None:
        self._ingest_url = ingest_url
        self._timeout_s = timeout_s
        self._debug = debug
        self._ring: deque[dict[str, Any]] = deque(maxlen=ring_buffer_size)
        self._lock = Lock()

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        batch: list[dict[str, Any]] = [self._span_to_dict(s) for s in spans]

        # Drain the retry buffer onto the front of this batch so old spans
        # don't sit indefinitely while new ones keep flowing.
        with self._lock:
            if self._ring:
                batch = list(self._ring) + batch
                self._ring.clear()

        if self._debug:
            for s in batch:
                _log.debug("span: %s %s", s["name"], s["span_id"])

        try:
            r = requests.post(
                self._ingest_url,
                json={"spans": batch},
                timeout=self._timeout_s,
            )
            r.raise_for_status()
            return SpanExportResult.SUCCESS
        except Exception as e:  # noqa: BLE001 — telemetry must never raise
            _log.warning(
                "ingest failed (%s); buffering %d spans", e, len(batch),
            )
            with self._lock:
                self._ring.extend(batch)
            return SpanExportResult.FAILURE

    def shutdown(self) -> None:
        # Best-effort flush — try once more, swallow on failure.
        with self._lock:
            pending = list(self._ring)
            self._ring.clear()
        if not pending:
            return
        try:
            requests.post(
                self._ingest_url,
                json={"spans": pending},
                timeout=self._timeout_s,
            )
        except Exception:  # noqa: BLE001 — telemetry must never raise
            pass

    # ------------------------------------------------------------------ encode
    @staticmethod
    def _span_to_dict(s: ReadableSpan) -> dict[str, Any]:
        ctx = s.get_span_context()
        parent = s.parent
        attrs = dict(s.attributes or {})
        # OTel statuses: UNSET / OK / ERROR. Treat UNSET as OK for our store.
        sc = s.status.status_code if s.status else StatusCode.UNSET
        status_code = "error" if sc == StatusCode.ERROR else "ok"
        return {
            "trace_id": format(ctx.trace_id, "032x"),
            "span_id": format(ctx.span_id, "016x"),
            "parent_span_id": format(parent.span_id, "016x") if parent else None,
            "name": s.name,
            "service_name": (
                (s.resource.attributes or {}).get("service.name", "unknown")
                if s.resource
                else "unknown"
            ),
            "kind": s.kind.name.lower() if s.kind else "internal",
            "start_ns": s.start_time,
            "end_ns": s.end_time,
            "status_code": status_code,
            "status_message": s.status.description if s.status else None,
            "attributes": attrs,
            "events": [
                {
                    "ts": e.timestamp,
                    "name": e.name,
                    "attributes": dict(e.attributes or {}),
                }
                for e in (s.events or [])
            ],
            "resource": dict(s.resource.attributes or {}) if s.resource else {},
            # Convenience: lift run_id out of attributes so the server can
            # index without parsing the JSON blob on every insert.
            "run_id": attrs.get("wimad.run_id"),
        }
