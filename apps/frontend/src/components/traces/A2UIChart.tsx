// Minimal A2UI-shape chart renderer. The analyst pins charts via the
// `renderChart` frontend tool, which stores them as
// `{kind: 'a2ui', name, props}`. This component renders the three shapes
// the analyst is most likely to ask for: bar, donut, line. Anything else
// falls back to a JSON dump so the pin is still visible.
//
// Schema per kind:
//   bar:   { data: [{label, value}], unit?: string }
//   donut: { data: [{label, value, color?}] }
//   line:  { series: [{label, points: [{x, y}]}], unit?: string }

import { colorForName } from "@/lib/traces/format";

type Datum = { label: string; value: number; color?: string };

export function A2UIChart({
  name,
  props,
}: {
  name?: string;
  props?: Record<string, unknown>;
}) {
  const kind = (name ?? "").toLowerCase();
  if (kind === "bar") return <BarChart data={(props?.data as Datum[]) ?? []} unit={String(props?.unit ?? "")} />;
  if (kind === "donut") return <DonutChart data={(props?.data as Datum[]) ?? []} />;
  if (kind === "line")
    return (
      <LineChart
        series={(props?.series as { label: string; points: { x: number; y: number }[] }[]) ?? []}
      />
    );
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-zinc-950 p-2 font-mono text-[11px] text-zinc-300">
      {JSON.stringify({ name, props }, null, 2)}
    </pre>
  );
}

function BarChart({ data, unit }: { data: Datum[]; unit: string }) {
  if (data.length === 0) return <Empty />;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-1">
      {data.map((d) => {
        const pct = (d.value / max) * 100;
        const color = d.color ?? colorForName(d.label);
        return (
          <div key={d.label} className="grid grid-cols-[1fr_60px] items-center gap-2 text-xs">
            <div className="relative h-5 w-full rounded bg-zinc-900">
              <div
                className={`absolute inset-y-0 left-0 rounded ${color}`}
                style={{ width: `${pct}%` }}
              />
              <div className="absolute inset-0 flex items-center px-2 text-[10px] text-zinc-100 mix-blend-difference">
                {d.label}
              </div>
            </div>
            <div className="text-right font-mono text-zinc-300">
              {d.value}
              {unit ? ` ${unit}` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DonutChart({ data }: { data: Datum[] }) {
  if (data.length === 0) return <Empty />;
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total <= 0) return <Empty />;
  let acc = 0;
  const radius = 28;
  const circ = 2 * Math.PI * radius;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90">
        {data.map((d) => {
          const len = (d.value / total) * circ;
          const off = (acc / total) * circ;
          acc += d.value;
          const color = colorForName(d.label).replace("bg-", "");
          return (
            <circle
              key={d.label}
              r={radius}
              cx={40}
              cy={40}
              fill="transparent"
              strokeWidth={12}
              stroke={cssColor(color)}
              strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-off}
            />
          );
        })}
      </svg>
      <ul className="space-y-1 text-xs">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${colorForName(d.label)}`}
            />
            <span className="text-zinc-200">{d.label}</span>
            <span className="ml-auto font-mono text-zinc-400">
              {((d.value / total) * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LineChart({
  series,
}: {
  series: { label: string; points: { x: number; y: number }[] }[];
}) {
  if (series.length === 0 || series[0].points.length === 0) return <Empty />;
  const allPoints = series.flatMap((s) => s.points);
  const minX = Math.min(...allPoints.map((p) => p.x));
  const maxX = Math.max(...allPoints.map((p) => p.x));
  const minY = Math.min(...allPoints.map((p) => p.y));
  const maxY = Math.max(...allPoints.map((p) => p.y));
  const w = 220;
  const h = 80;
  const sx = (x: number) => ((x - minX) / Math.max(1, maxX - minX)) * w;
  const sy = (y: number) => h - ((y - minY) / Math.max(1, maxY - minY)) * h;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full">
      {series.map((s, i) => {
        const path = s.points
          .map((p, j) => `${j === 0 ? "M" : "L"} ${sx(p.x)} ${sy(p.y)}`)
          .join(" ");
        return (
          <path
            key={s.label}
            d={path}
            fill="none"
            stroke={cssColor(["sky-400", "emerald-400", "amber-400", "rose-400"][i % 4])}
            strokeWidth={1.5}
          />
        );
      })}
    </svg>
  );
}

function Empty() {
  return <div className="text-xs text-zinc-500">no data</div>;
}

// Map our Tailwind palette tokens to CSS colors for inline SVG strokes.
function cssColor(token: string): string {
  const map: Record<string, string> = {
    "sky-400": "#38bdf8",
    "sky-500": "#0ea5e9",
    "emerald-400": "#34d399",
    "emerald-500": "#10b981",
    "amber-400": "#fbbf24",
    "amber-500": "#f59e0b",
    "rose-400": "#fb7185",
    "rose-500": "#f43f5e",
    "violet-500": "#8b5cf6",
    "teal-500": "#14b8a6",
    "fuchsia-500": "#d946ef",
    "lime-500": "#84cc16",
    "orange-500": "#f97316",
    "cyan-500": "#06b6d4",
  };
  return map[token] ?? "#71717a";
}
