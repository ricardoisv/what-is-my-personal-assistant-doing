"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  CopilotChatConfigurationProvider,
  CopilotSidebar,
  useAgent,
  useConfigureSuggestions,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { ThreadsDrawer } from "@/components/threads-drawer";
import drawerStyles from "@/components/threads-drawer/threads-drawer.module.css";

import { initialState, mergeAgentState } from "@/lib/traces/state";
import { getRun, getTrace, listRuns } from "@/lib/traces/api";
import type { AgentState, PinnedChart, Run, Span } from "@/lib/traces/types";

import { RunList } from "@/components/traces/RunList";
import { Timeline } from "@/components/traces/Timeline";
import { Flamegraph } from "@/components/traces/Flamegraph";
import { SpanDetail } from "@/components/traces/SpanDetail";
import { MetricsStrip } from "@/components/traces/MetricsStrip";
import { PinnedCharts } from "@/components/traces/PinnedCharts";

function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <>{children}</>;
}

// `useFrontendTool({ render })` registers the closure once and never updates
// it. To get fresh state inside renderers, subscribe to `useAgent()` from a
// helper component rather than capturing state in the registered closure.
function useLiveAgentState(): {
  agent: ReturnType<typeof useAgent>["agent"];
  state: AgentState;
  setState: (updater: (prev: AgentState) => AgentState) => void;
} {
  const { agent } = useAgent();
  const state = mergeAgentState(agent?.state);
  const setState = useCallback(
    (updater: (prev: AgentState) => AgentState) => {
      agent?.setState(updater(mergeAgentState(agent?.state)));
    },
    [agent],
  );
  return { agent, state, setState };
}

function CanvasInner() {
  const { agent, state, setState } = useLiveAgentState();

  useConfigureSuggestions({
    available: "before-first-message",
    suggestions: [
      {
        title: "What were the recent runs?",
        message: "List the last 5 runs and tell me which one was slowest.",
      },
      {
        title: "Why was the last run slow?",
        message:
          "Look at the most recent run, aggregate by tool name, and tell me what dominated wall time.",
      },
      {
        title: "Compare the last two runs",
        message: "Compare the last two runs and tell me what regressed.",
      },
      {
        title: "Show me the failures",
        message:
          "Find any spans with status_code=error in the last 10 runs and explain.",
      },
    ],
  });

  // Local mirror of the run list — populated by polling the trace HTTP server.
  // We intentionally don't push this through agent state on every poll: the
  // canvas is the live view; agent state holds the pinned/selected fields.
  const [runs, setRuns] = useState<Run[]>([]);
  const [traceSpans, setTraceSpans] = useState<Span[]>([]);
  const [runWorkflow, setRunWorkflow] = useState<Span | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [view, setView] = useState<"timeline" | "flamegraph">("timeline");

  // Initial fetch + 3s polling. Phase 6 swaps this for SSE live tail.
  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const { runs } = await listRuns({ limit: 50 });
        if (live) setRuns(runs);
      } catch {
        if (live) setRuns([]);
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  // When selectedRunId changes, fetch the spans for that run.
  useEffect(() => {
    let live = true;
    const runId = state.selectedRunId;
    if (!runId) {
      setTraceSpans([]);
      setRunWorkflow(null);
      setSelectedSpanId(null);
      return;
    }
    (async () => {
      try {
        const { workflow, spans } = await getRun(runId);
        if (!live) return;
        setRunWorkflow(workflow);
        setTraceSpans(spans);
        setSelectedSpanId(null);
      } catch {
        if (!live) return;
        setRunWorkflow(null);
        setTraceSpans([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [state.selectedRunId]);

  // When selectedTraceId changes, fetch that trace tree (overrides spans).
  useEffect(() => {
    let live = true;
    const traceId = state.selectedTraceId;
    if (!traceId) return;
    (async () => {
      try {
        const { spans } = await getTrace(traceId);
        if (!live) return;
        setTraceSpans(spans);
        setSelectedSpanId(null);
      } catch {
        // ignore
      }
    })();
    return () => {
      live = false;
    };
  }, [state.selectedTraceId]);

  // ---- frontend tools the analyst can call -------------------------------

  useFrontendTool({
    name: "selectRun",
    description:
      "Focus a run in the TraceDetail panel. Pass the run_id from list_runs.",
    parameters: z.object({ run_id: z.string() }),
    handler: async ({ run_id }) => {
      setState((prev) => ({ ...prev, selectedRunId: run_id }));
      return `Focused run ${run_id}`;
    },
  });

  useFrontendTool({
    name: "selectTrace",
    description:
      "Focus one trace in the Flamegraph/Timeline. Pass the trace_id from a span.",
    parameters: z.object({ trace_id: z.string() }),
    handler: async ({ trace_id }) => {
      setState((prev) => ({ ...prev, selectedTraceId: trace_id }));
      return `Focused trace ${trace_id}`;
    },
  });

  useFrontendTool({
    name: "showTimeline",
    description: "Switch the TraceDetail center pane to the Timeline view.",
    parameters: z.object({}),
    handler: async () => {
      setView("timeline");
      return "Timeline view active";
    },
  });

  useFrontendTool({
    name: "showFlamegraph",
    description: "Switch the TraceDetail center pane to the Flamegraph view.",
    parameters: z.object({}),
    handler: async () => {
      setView("flamegraph");
      return "Flamegraph view active";
    },
  });

  useFrontendTool({
    name: "renderChart",
    description:
      "Pin an A2UI declarative chart into the canvas free area. Pass `name` (chart type, e.g. 'bar', 'line', 'donut') and `props` (chart props). The free area persists across turns.",
    parameters: z
      .object({
        name: z.string(),
        props: z.record(z.string(), z.any()).optional(),
      })
      .passthrough(),
    handler: async ({ name, props }) => {
      const id = randomId();
      setState((prev) => ({
        ...prev,
        pinnedCharts: [
          ...prev.pinnedCharts,
          { id, kind: "a2ui", name, props } as PinnedChart,
        ],
      }));
      return `Pinned chart ${name} (id=${id}). Use clearPinned to remove.`;
    },
  });

  useFrontendTool({
    name: "renderHTML",
    description:
      "Pin an open-ended generative-UI HTML blob into the canvas free area (sandboxed iframe). Use only when neither a controlled component nor an A2UI chart fits.",
    parameters: z.object({ html: z.string() }),
    handler: async ({ html }) => {
      const id = randomId();
      setState((prev) => ({
        ...prev,
        pinnedCharts: [
          ...prev.pinnedCharts,
          { id, kind: "html", html } as PinnedChart,
        ],
      }));
      return `Pinned HTML component (id=${id}).`;
    },
  });

  useFrontendTool({
    name: "clearPinned",
    description: "Remove all pinned charts from the canvas free area.",
    parameters: z.object({}),
    handler: async () => {
      setState((prev) => ({ ...prev, pinnedCharts: [] }));
      return "Cleared.";
    },
  });

  // ---- derived ------------------------------------------------------------

  const selectedRun = useMemo<Run | null>(() => {
    if (!state.selectedRunId) return null;
    return runs.find((r) => r.run_id === state.selectedRunId) ?? null;
  }, [runs, state.selectedRunId]);

  const selectedSpan = useMemo<Span | null>(
    () => traceSpans.find((s) => s.span_id === selectedSpanId) ?? null,
    [traceSpans, selectedSpanId],
  );

  // ---- layout -------------------------------------------------------------

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <div>
          <h1 className="text-base font-semibold">{state.header.title}</h1>
          <p className="text-xs text-zinc-500">{state.header.subtitle}</p>
        </div>
        <div className="text-xs text-zinc-500">
          {runs.length} runs · {traceSpans.length} spans loaded
        </div>
      </header>

      <MetricsStrip run={selectedRun} spans={traceSpans} />

      <section className="grid min-h-0 flex-1 grid-cols-[280px_1fr_360px] divide-x divide-zinc-800">
        {/* Left rail */}
        <aside className="min-h-0 overflow-y-auto bg-zinc-950/50">
          <RunList
            runs={runs}
            selectedRunId={state.selectedRunId}
            onSelect={(id) =>
              setState((prev) => ({
                ...prev,
                selectedRunId: prev.selectedRunId === id ? null : id,
                selectedTraceId: null,
              }))
            }
          />
        </aside>

        {/* Center: TraceDetail */}
        <section className="flex min-h-0 flex-col">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 text-xs">
            <button
              type="button"
              onClick={() => setView("timeline")}
              className={`rounded px-2 py-1 ${
                view === "timeline"
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Timeline
            </button>
            <button
              type="button"
              onClick={() => setView("flamegraph")}
              className={`rounded px-2 py-1 ${
                view === "flamegraph"
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Flamegraph
            </button>
            {runWorkflow && (
              <span className="ml-auto font-mono text-[11px] text-zinc-500">
                trace={runWorkflow.trace_id.slice(0, 12)}
              </span>
            )}
          </div>
          <div className="grid min-h-0 flex-1 grid-rows-[1fr_minmax(180px,40%)]">
            <div className="min-h-0 overflow-y-auto">
              {view === "timeline" ? (
                <Timeline
                  spans={traceSpans}
                  selectedSpanId={selectedSpanId}
                  onSelectSpan={(s) => setSelectedSpanId(s.span_id)}
                />
              ) : (
                <Flamegraph
                  spans={traceSpans}
                  selectedSpanId={selectedSpanId}
                  onSelectSpan={(s) => setSelectedSpanId(s.span_id)}
                />
              )}
            </div>
            <div className="min-h-0 overflow-y-auto border-t border-zinc-800">
              <SpanDetail span={selectedSpan} />
            </div>
          </div>
        </section>

        {/* Right rail: pinned charts */}
        <aside className="min-h-0 overflow-y-auto bg-zinc-950/50">
          <div className="border-b border-zinc-800 px-3 py-2 text-[11px] uppercase tracking-wide text-zinc-500">
            Pinned
          </div>
          <PinnedCharts
            pinned={state.pinnedCharts}
            onUnpin={(id) =>
              setState((prev) => ({
                ...prev,
                pinnedCharts: prev.pinnedCharts.filter((p) => p.id !== id),
              }))
            }
          />
        </aside>
      </section>

      <CopilotSidebar
        defaultOpen
        width={420}
        input={{ disclaimer: () => null, className: "pb-6" }}
      />
    </main>
  );
}

function HomePage() {
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  return (
    <div className={drawerStyles.layout}>
      <ThreadsDrawer
        agentId="default"
        threadId={threadId}
        onThreadChange={setThreadId}
      />
      <div className={drawerStyles.mainPanel}>
        <CopilotChatConfigurationProvider agentId="default" threadId={threadId}>
          <CanvasInner />
        </CopilotChatConfigurationProvider>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <ClientOnly>
      <HomePage />
    </ClientOnly>
  );
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return `pin-${Date.now()}`;
}
