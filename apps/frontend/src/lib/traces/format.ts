export function formatNs(ns: number | null | undefined): string {
  if (ns == null || isNaN(ns)) return "—";
  if (ns < 1_000) return `${ns}ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(1)}µs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(1)}ms`;
  return `${(ns / 1_000_000_000).toFixed(2)}s`;
}

export function formatRelativeNs(ns: number | null | undefined): string {
  if (ns == null) return "—";
  // start_ns is OTel-style nanos since epoch.
  const ms = ns / 1_000_000;
  const delta = Date.now() - ms;
  if (delta < 5_000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

export function shorten(s: string | null | undefined, len = 8): string {
  if (!s) return "—";
  return s.length <= len ? s : s.slice(0, len);
}

// Stable color from a span name — same name always gets same color. Tuned
// to readable Tailwind palette positions. Used for the timeline bars.
const PALETTE = [
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-teal-500",
  "bg-fuchsia-500",
  "bg-lime-500",
  "bg-orange-500",
  "bg-cyan-500",
];

export function colorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length];
}
