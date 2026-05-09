import { formatNs, shorten } from "@/lib/traces/format";
import type { Span } from "@/lib/traces/types";

export function SpanDetail({ span }: { span: Span | null }) {
  if (!span) {
    return (
      <div className="p-6 text-sm text-zinc-400">
        Pick a span on the timeline to see its attributes.
      </div>
    );
  }

  const attrEntries = Object.entries(span.attributes ?? {});
  return (
    <div className="space-y-4 p-4 font-mono text-xs">
      <header className="space-y-1">
        <h3 className="font-sans text-base font-semibold text-zinc-100">
          {span.name}
        </h3>
        <div className="flex flex-wrap gap-3 text-zinc-400">
          <span>
            service=<span className="text-zinc-200">{span.service_name}</span>
          </span>
          <span>
            kind=<span className="text-zinc-200">{span.kind}</span>
          </span>
          <span>
            duration=
            <span className="text-zinc-200">{formatNs(span.duration_ns)}</span>
          </span>
          {span.status_code === "error" && (
            <span className="text-rose-300">
              status=error{" "}
              {span.status_message && (
                <span className="text-rose-400">({span.status_message})</span>
              )}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-3 text-[11px] text-zinc-500">
          <span>trace_id={shorten(span.trace_id, 16)}</span>
          <span>span_id={shorten(span.span_id, 16)}</span>
          {span.parent_span_id && (
            <span>parent={shorten(span.parent_span_id, 16)}</span>
          )}
        </div>
      </header>

      <section>
        <h4 className="mb-2 font-sans text-xs font-medium uppercase tracking-wide text-zinc-500">
          Attributes
        </h4>
        {attrEntries.length === 0 ? (
          <div className="text-zinc-500">(none)</div>
        ) : (
          <dl className="grid grid-cols-[180px_1fr] gap-x-3 gap-y-1">
            {attrEntries.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="truncate text-zinc-400">{k}</dt>
                <dd className="break-words text-zinc-200">
                  {formatAttr(v)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {span.events?.length > 0 && (
        <section>
          <h4 className="mb-2 font-sans text-xs font-medium uppercase tracking-wide text-zinc-500">
            Events
          </h4>
          <ul className="space-y-1">
            {span.events.map((e, i) => (
              <li key={i} className="text-zinc-300">
                <span className="text-zinc-500">[{formatNs(e.ts)}]</span>{" "}
                {e.name}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function formatAttr(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
