import { colorForName, formatNs } from "@/lib/traces/format";
import type { Span } from "@/lib/traces/types";

type Props = {
  spans: Span[];
  onSelectSpan?: (span: Span) => void;
  selectedSpanId?: string | null;
};

// Stacked flamegraph. Each row is a depth level; each cell is a span at that
// depth, sized by duration relative to its parent. Click to select.

type Node = Span & { children: Node[] };

function buildTree(spans: Span[]): Node[] {
  const byId = new Map<string, Node>();
  for (const s of spans) {
    byId.set(s.span_id, { ...s, children: [] });
  }
  const roots: Node[] = [];
  for (const node of byId.values()) {
    if (node.parent_span_id && byId.has(node.parent_span_id)) {
      byId.get(node.parent_span_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  for (const node of byId.values()) {
    node.children.sort((a, b) => a.start_ns - b.start_ns);
  }
  return roots;
}

export function Flamegraph({ spans, onSelectSpan, selectedSpanId }: Props) {
  if (spans.length === 0) {
    return (
      <div className="p-6 text-sm text-zinc-400">No spans on this trace.</div>
    );
  }
  const roots = buildTree(spans);
  const root = roots[0];
  if (!root) return null;
  const total = Math.max(1, root.duration_ns);

  return (
    <div className="space-y-0.5 p-2">
      <FlameRow
        nodes={[root]}
        startNs={root.start_ns}
        totalNs={total}
        onSelect={onSelectSpan}
        selectedId={selectedSpanId}
      />
    </div>
  );
}

function FlameRow({
  nodes,
  startNs,
  totalNs,
  onSelect,
  selectedId,
}: {
  nodes: Node[];
  startNs: number;
  totalNs: number;
  onSelect?: (s: Span) => void;
  selectedId?: string | null;
}) {
  if (nodes.length === 0) return null;
  return (
    <>
      <div className="relative flex h-5 w-full">
        {nodes.map((n) => {
          const offsetPct = ((n.start_ns - startNs) / totalNs) * 100;
          const widthPct = Math.max(0.3, (n.duration_ns / totalNs) * 100);
          const color =
            n.status_code === "error" ? "bg-rose-500" : colorForName(n.name);
          const sel = n.span_id === selectedId;
          return (
            <button
              key={n.span_id}
              type="button"
              onClick={() => onSelect?.(n)}
              className={`absolute h-full overflow-hidden truncate rounded-sm border px-1 text-[10px] font-mono text-zinc-950 transition ${color} ${
                sel ? "border-zinc-100" : "border-transparent"
              } hover:opacity-90`}
              style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
              title={`${n.name} · ${formatNs(n.duration_ns)}`}
            >
              {n.name.split(".").slice(-1)[0]}
            </button>
          );
        })}
      </div>
      <FlameRow
        nodes={nodes.flatMap((n) => n.children)}
        startNs={startNs}
        totalNs={totalNs}
        onSelect={onSelect}
        selectedId={selectedId}
      />
    </>
  );
}
