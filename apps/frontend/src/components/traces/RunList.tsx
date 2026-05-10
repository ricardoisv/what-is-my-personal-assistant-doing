import { formatNs, formatRelativeNs, shorten } from "@/lib/traces/format";
import type { Run } from "@/lib/traces/types";

type Props = {
  runs: Run[];
  selectedRunId: string | null;
  onSelect: (run_id: string) => void;
};

const statusColor: Record<string, string> = {
  running: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  done: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  failed: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

// `wimad.workflow.query` ships a Python repr like
//   {'args': ('speculative decoding',), 'kwargs': {}}
// That's noisy in the UI. Pluck the first string arg if we can; fall back
// to the raw text otherwise.
function prettyQuery(raw: string | null | undefined): string {
  if (!raw) return "(no query)";
  const m = raw.match(/'args':\s*\(\s*['"]([^'"]+)['"]/);
  if (m?.[1]) return m[1];
  // Strip outer Python-repr braces if present.
  return raw.replace(/^\{.*?'args':\s*\(/, "").replace(/[)}\s'"]+$/, "").trim() || raw;
}

export function RunList({ runs, selectedRunId, onSelect }: Props) {
  if (runs.length === 0) {
    return (
      <div className="p-4 text-xs leading-relaxed text-zinc-500">
        No runs yet. Run the wimad smoke test (
        <code className="rounded bg-zinc-800 px-1 py-0.5 text-[11px] text-zinc-300">
          uv run python apps/wimad/scripts/smoke_test.py
        </code>
        ) or launch <code className="text-zinc-300">hermes-traced</code> to
        populate this list.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-800/70">
      {runs.map((r) => {
        const isSel = r.run_id === selectedRunId;
        const dur = r.ended_ns ? r.ended_ns - r.started_ns : null;
        return (
          <li key={r.run_id}>
            <button
              type="button"
              onClick={() => onSelect(r.run_id)}
              className={`flex w-full flex-col gap-1.5 border-l-2 px-3 py-2.5 text-left transition ${
                isSel
                  ? "border-emerald-500 bg-zinc-800/80"
                  : "border-transparent hover:bg-zinc-900"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-zinc-500">
                  {shorten(r.run_id, 10)}
                </span>
                <span
                  className={`rounded-sm border px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider ${
                    statusColor[r.status] ?? "border-zinc-700 text-zinc-400"
                  }`}
                >
                  {r.status}
                </span>
              </div>
              <div className="line-clamp-2 text-[13px] font-medium text-zinc-100">
                {prettyQuery(r.query)}
              </div>
              <div className="flex items-center justify-between text-[10px] text-zinc-500">
                <span>{formatRelativeNs(r.started_ns)}</span>
                <span className="font-mono">{formatNs(dur)}</span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
