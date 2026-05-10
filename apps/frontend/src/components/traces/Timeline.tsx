import { colorForName, formatNs } from "@/lib/traces/format";
import type { Span } from "@/lib/traces/types";

type Props = {
  spans: Span[];
  onSelectSpan?: (span: Span) => void;
  selectedSpanId?: string | null;
};

// Gantt-style timeline. Each span is one row; bar position is
// (start - rootStart) / totalDuration, width is duration / totalDuration.
// Indentation reflects parent depth so the tree shape is readable.

export function Timeline({ spans, onSelectSpan, selectedSpanId }: Props) {
  if (spans.length === 0) {
    return (
      <div className="p-6 text-sm text-zinc-400">No spans on this trace.</div>
    );
  }

  const sorted = [...spans].sort((a, b) => a.start_ns - b.start_ns);
  const rootStart = sorted[0].start_ns;
  const rootEnd = sorted.reduce((m, s) => Math.max(m, s.end_ns), 0);
  const total = Math.max(1, rootEnd - rootStart);

  const depth = computeDepth(sorted);

  return (
    <div className="flex flex-col gap-0.5 p-3 font-mono text-[11px]">
      {sorted.map((s) => {
        const offsetPct = ((s.start_ns - rootStart) / total) * 100;
        // Min width 4px so even sub-millisecond spans are visible at narrow
        // viewports. Done as a clamped Tailwind arbitrary value via inline style.
        const widthPct = Math.max(0.5, (s.duration_ns / total) * 100);
        const indent = (depth.get(s.span_id) ?? 0) * 14;
        const color = s.status_code === "error" ? "bg-rose-500" : colorForName(s.name);
        const sel = s.span_id === selectedSpanId;
        return (
          <button
            key={s.span_id}
            type="button"
            onClick={() => onSelectSpan?.(s)}
            className={`grid w-full grid-cols-[240px_1fr_64px] items-center gap-3 rounded-sm py-1 pl-1 pr-2 text-left transition ${
              sel ? "bg-zinc-800" : "hover:bg-zinc-900"
            }`}
            title={s.name}
          >
            <span
              className={`truncate ${sel ? "text-zinc-50" : "text-zinc-300"}`}
              style={{ paddingLeft: indent }}
            >
              {s.name}
            </span>
            <span className="relative h-4 w-full overflow-hidden rounded-sm bg-zinc-900 ring-1 ring-zinc-800">
              <span
                className={`absolute top-0 bottom-0 rounded-sm ${color} shadow-sm`}
                style={{
                  left: `${offsetPct}%`,
                  width: `max(${widthPct}%, 4px)`,
                }}
              />
            </span>
            <span className="text-right text-zinc-400">
              {formatNs(s.duration_ns)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function computeDepth(spans: Span[]): Map<string, number> {
  const byId = new Map(spans.map((s) => [s.span_id, s] as const));
  const depth = new Map<string, number>();
  function d(id: string): number {
    if (depth.has(id)) return depth.get(id)!;
    const s = byId.get(id);
    if (!s || !s.parent_span_id || !byId.has(s.parent_span_id)) {
      depth.set(id, 0);
      return 0;
    }
    const v = d(s.parent_span_id) + 1;
    depth.set(id, v);
    return v;
  }
  for (const s of spans) d(s.span_id);
  return depth;
}
