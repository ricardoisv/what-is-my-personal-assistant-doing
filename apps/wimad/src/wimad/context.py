"""Tracer configuration + the public `span()` context manager.

`configure()` is idempotent. Subsequent calls are no-ops so callers can
defensively call it from multiple entry points.

`span()` automatically attaches the current run_id (set by `@workflow`) to
every span via OTel attributes, so the ingest server can group spans by run
without parents needing to thread a parameter through.
"""

from __future__ import annotations

import contextvars
import logging
import os
import sys
from contextlib import contextmanager
from typing import Any, Iterator

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from .exporter import HttpSpanExporter

_log = logging.getLogger("wimad.context")
_configured = False
_current_run_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "wimad_run_id", default=None
)


def configure(
    *,
    ingest_url: str | None = None,
    service_name: str = "wimad",
    batch_size: int | None = None,
    batch_interval_ms: int | None = None,
    debug: bool | None = None,
) -> None:
    """Idempotently install the global tracer provider + HTTP exporter.

    Reads env vars when arguments aren't passed:
      - WIMAD_INGEST_URL        (default http://localhost:3012/traces/ingest)
      - WIMAD_BATCH_SIZE        (default 32)
      - WIMAD_BATCH_INTERVAL_MS (default 500)
      - WIMAD_DEBUG             (any truthy value enables debug logging)
    """
    global _configured
    if _configured:
        return

    ingest_url = ingest_url or os.getenv(
        "WIMAD_INGEST_URL", "http://localhost:3012/traces/ingest"
    )
    batch_size = batch_size or int(os.getenv("WIMAD_BATCH_SIZE", "32"))
    batch_interval_ms = batch_interval_ms or int(
        os.getenv("WIMAD_BATCH_INTERVAL_MS", "500")
    )
    if debug is None:
        debug = bool(os.getenv("WIMAD_DEBUG"))

    if debug:
        logging.basicConfig(stream=sys.stderr, level=logging.DEBUG)
        _log.setLevel(logging.DEBUG)

    resource = Resource.create({"service.name": service_name})
    provider = TracerProvider(resource=resource)
    exporter = HttpSpanExporter(ingest_url=ingest_url, debug=debug)
    processor = BatchSpanProcessor(
        exporter,
        max_export_batch_size=batch_size,
        schedule_delay_millis=batch_interval_ms,
    )
    provider.add_span_processor(processor)
    trace.set_tracer_provider(provider)
    _configured = True
    _log.debug(
        "configured: service=%s ingest=%s batch=%d interval_ms=%d",
        service_name,
        ingest_url,
        batch_size,
        batch_interval_ms,
    )


def _tracer() -> trace.Tracer:
    """Return the wimad tracer, configuring lazily with defaults if needed."""
    if not _configured:
        configure()
    return trace.get_tracer("wimad")


def current_run_id() -> str | None:
    """Return the current run_id (set by `@workflow`), or None outside a workflow."""
    return _current_run_id.get()


def _set_run_id(run_id: str | None) -> contextvars.Token:
    """Internal: push a run_id onto the contextvar; caller restores via reset()."""
    return _current_run_id.set(run_id)


def _reset_run_id(token: contextvars.Token) -> None:
    _current_run_id.reset(token)


@contextmanager
def span(
    name: str,
    *,
    attributes: dict[str, Any] | None = None,
) -> Iterator[trace.Span]:
    """Open a span. The current run_id is auto-attached when present.

    Exceptions inside the block set status=ERROR and record the exception, then
    re-raise — wimad never swallows errors from instrumented code.
    """
    tracer = _tracer()
    attrs = dict(attributes or {})
    rid = _current_run_id.get()
    if rid and "wimad.run_id" not in attrs:
        attrs["wimad.run_id"] = rid
    with tracer.start_as_current_span(name, attributes=attrs) as s:
        try:
            yield s
        except Exception as e:  # noqa: BLE001 — re-raised below
            s.set_status(trace.Status(trace.StatusCode.ERROR, str(e)))
            s.record_exception(e)
            raise
