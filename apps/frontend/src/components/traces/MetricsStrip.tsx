import { formatNs } from "@/lib/traces/format";
import type { Run, Span } from "@/lib/traces/types";

type Props = {
  run: Run | null;
  spans: Span[];
};

export function MetricsStrip({ run, spans }: Props) {
  const total = run?.ended_ns && run.started_ns ? run.ended_ns - run.started_ns : null;
  const errorCount = spans.filter((s) => s.status_code === "error").length;

  // Top tool by total duration — workhorse stat for "where did this run spend its time".
  const totalsByName = new Map<string, number>();
  for (const s of spans) {
    if (!s.name.includes(".tool.")) continue;
    totalsByName.set(s.name, (totalsByName.get(s.name) ?? 0) + s.duration_ns);
  }
  const topTool = [...totalsByName.entries()].sort((a, b) => b[1] - a[1])[0];

  // Approximate token usage if any LLM span carries gen_ai.usage.* attributes.
  let inputTokens = 0;
  let outputTokens = 0;
  for (const s of spans) {
    const attrs = (s.attributes as Record<string, unknown>) ?? {};
    const i = Number(attrs["gen_ai.usage.input_tokens"]);
    const o = Number(attrs["gen_ai.usage.output_tokens"]);
    if (!isNaN(i)) inputTokens += i;
    if (!isNaN(o)) outputTokens += o;
  }
  const totalTokens = inputTokens + outputTokens;

  const cells: Array<{ label: string; value: string; tone?: string }> = [
    { label: "Status", value: run?.status ?? "—" },
    { label: "Total time", value: formatNs(total) },
    {
      label: "Errors",
      value: String(errorCount),
      tone: errorCount > 0 ? "text-rose-300" : undefined,
    },
    {
      label: "Top tool",
      value: topTool ? `${topTool[0]} (${formatNs(topTool[1])})` : "—",
    },
    {
      label: "Tokens",
      value: totalTokens > 0 ? `${totalTokens} (in:${inputTokens} / out:${outputTokens})` : "—",
    },
    { label: "Spans", value: String(spans.length) },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-zinc-800 bg-zinc-900/30 px-4 py-2.5 md:grid-cols-3 lg:grid-cols-6">
      {cells.map((c) => (
        <div key={c.label} className="space-y-0.5">
          <div className="text-[9px] font-medium uppercase tracking-wider text-zinc-500">
            {c.label}
          </div>
          <div
            className={`truncate font-mono text-[12px] ${
              c.tone ?? "text-zinc-100"
            }`}
            title={c.value}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}
