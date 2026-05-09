import type { PinnedChart } from "@/lib/traces/types";
import { A2UIChart } from "./A2UIChart";

type Props = {
  pinned: PinnedChart[];
  onUnpin?: (id: string) => void;
};

export function PinnedCharts({ pinned, onUnpin }: Props) {
  if (pinned.length === 0) {
    return (
      <div className="p-4 text-sm text-zinc-500">
        Pinned generative-UI components from the analyst will appear here.
      </div>
    );
  }
  return (
    <div className="space-y-3 p-3">
      {pinned.map((p) => (
        <div
          key={p.id}
          className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
        >
          <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-500">
            <span className="font-mono">
              {p.kind}
              {p.name ? `: ${p.name}` : ""}
            </span>
            {onUnpin && (
              <button
                type="button"
                onClick={() => onUnpin(p.id)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                ✕
              </button>
            )}
          </div>
          <PinnedBody pinned={p} />
        </div>
      ))}
    </div>
  );
}

function PinnedBody({ pinned }: { pinned: PinnedChart }) {
  if (pinned.kind === "html" && pinned.html) {
    return (
      <iframe
        sandbox=""
        srcDoc={pinned.html}
        className="h-64 w-full rounded border border-zinc-800 bg-white"
      />
    );
  }
  if (pinned.kind === "a2ui") {
    return <A2UIChart name={pinned.name} props={pinned.props} />;
  }
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-zinc-950 p-2 font-mono text-[11px] text-zinc-300">
      {JSON.stringify({ name: pinned.name, props: pinned.props }, null, 2)}
    </pre>
  );
}
