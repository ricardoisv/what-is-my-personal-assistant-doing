import { formatNs, formatRelativeNs, shorten } from "@/lib/traces/format";
import type { Run } from "@/lib/traces/types";

type Props = {
  runs: Run[];
  selectedRunId: string | null;
  onSelect: (run_id: string) => void;
};

const statusColor: Record<string, string> = {
  running: "bg-sky-500/20 text-sky-200 border-sky-500/30",
  done: "bg-emerald-500/20 text-emerald-200 border-emerald-500/30",
  failed: "bg-rose-500/20 text-rose-200 border-rose-500/30",
};

export function RunList({ runs, selectedRunId, onSelect }: Props) {
  if (runs.length === 0) {
    return (
      <div className="p-4 text-sm text-zinc-400">
        No runs yet. Run the wimad smoke test (
        <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs">
          uv run python apps/wimad/scripts/smoke_test.py
        </code>
        ) or launch <code>hermes-traced</code> to populate this list.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-800">
      {runs.map((r) => {
        const isSel = r.run_id === selectedRunId;
        const dur = r.ended_ns ? r.ended_ns - r.started_ns : null;
        return (
          <li key={r.run_id}>
            <button
              type="button"
              onClick={() => onSelect(r.run_id)}
              className={`flex w-full flex-col gap-1 px-3 py-2 text-left text-sm transition ${
                isSel
                  ? "bg-zinc-800/80"
                  : "hover:bg-zinc-800/50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-zinc-400">
                  {shorten(r.run_id, 10)}
                </span>
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                    statusColor[r.status] ?? "border-zinc-700 text-zinc-300"
                  }`}
                >
                  {r.status}
                </span>
              </div>
              <div className="line-clamp-2 text-zinc-200">
                {r.query?.replace(/^\{.*?'args':\s*\(/, "") ?? "(no query)"}
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-500">
                <span>{formatRelativeNs(r.started_ns)}</span>
                <span>{formatNs(dur)}</span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
