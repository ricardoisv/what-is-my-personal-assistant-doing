"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  CopilotChatConfigurationProvider,
  CopilotSidebar,
  useAgent,
  useConfigureSuggestions,
  useDefaultRenderTool,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { ToolFallbackCard } from "@/components/copilot/ToolFallbackCard";
import { ThreadsDrawer } from "@/components/threads-drawer";
import drawerStyles from "@/components/threads-drawer/threads-drawer.module.css";

import { initialState, mergeAgentState } from "@/lib/traces/state";
import { getRun, getTrace, listRuns, streamUrl } from "@/lib/traces/api";
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

  // Render every backend-tool call (list_runs, aggregate, get_run, etc.)
  // as a generic CopilotKit-branded card in the chat. This is the
  // "controlled" GenUI fallback — without it, tool calls happen invisibly
  // and the user only sees the final text reply.
  useDefaultRenderTool({ render: (props) => <ToolFallbackCard {...props} /> });

  useConfigureSuggestions({
    available: "before-first-message",
    suggestions: [
      {
        title: "Show me a chart of slowest tools",
        message:
          "List the most recent run. Then call aggregate(group_by='name', run_id=<id>) and filter the rows to spans whose name starts with 'wimad.tool.'. Then call pin_chart(kind='a2ui', name='bar', props={'data': [{'label': <name>, 'value': <duration_ns/1e6>}, ...], 'unit': 'ms'}). Use the BACKEND pin_chart tool — not renderChart.",
      },
      {
        title: "Focus the slowest run",
        message:
          "Find the slowest run in the last 5, call select_run with its run_id (BACKEND tool — not selectRun) to focus the canvas, then reply in one sentence.",
      },
      {
        title: "Compare the last two runs",
        message:
          "Compare the last two runs with compare_runs. Then call pin_chart(kind='a2ui', name='bar', props={'data': [{'label': <name>, 'value': abs(delta_total_ns)/1e6}, ...], 'unit': 'ms'}). Use the BACKEND pin_chart tool.",
      },
      {
        title: "Custom HTML viz",
        message:
          "Pull the most recent trace via get_trace_tree. Then call pin_chart(kind='html', html=<sandboxed inline-styled HTML+SVG visualizing the span tree as nested boxes — width proportional to duration, indented by depth>). Use the BACKEND pin_chart tool.",
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

  // Initial fetch + SSE live tail. Each span event triggers a debounced
  // refetch of the run list (cheap — typical demo run is < 50 runs).
  // We also append matching spans to the open trace if one is focused.
  useEffect(() => {
    let live = true;
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefetch = () => {
      if (refetchTimer) clearTimeout(refetchTimer);
      refetchTimer = setTimeout(async () => {
        try {
          const { runs } = await listRuns({ limit: 50 });
          if (live) setRuns(runs);
        } catch {
          /* ignore */
        }
      }, 200);
    };

    // Initial fetch — without it, the canvas is blank until the first span.
    debouncedRefetch();

    let es: EventSource | null = null;
    try {
      es = new EventSource(streamUrl());
      es.addEventListener("span", (e) => {
        debouncedRefetch();
        try {
          const span = JSON.parse((e as MessageEvent).data) as Span;
          // If the span belongs to whatever trace is currently displayed,
          // append it in place — gives the timeline its live-tail feel.
          // Use functional setState to avoid stale closure of traceSpans.
          setTraceSpans((prev) => {
            if (prev.length === 0) return prev;
            const traceMatches = prev[0]?.trace_id === span.trace_id;
            if (!traceMatches) return prev;
            if (prev.find((p) => p.span_id === span.span_id)) return prev;
            return [...prev, span];
          });
        } catch {
          /* ignore malformed events */
        }
      });
      es.addEventListener("error", () => {
        // Silent — EventSource auto-reconnects. The debounced poll on
        // `hello` events still drives initial state.
      });
    } catch {
      // EventSource construction can fail in some environments; the
      // initial fetch keeps the UI populated either way.
    }

    // Backup poll every 10s in case SSE is silently dead.
    const id = setInterval(debouncedRefetch, 10_000);

    return () => {
      live = false;
      if (refetchTimer) clearTimeout(refetchTimer);
      clearInterval(id);
      es?.close();
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
  //
  // We deliberately register only `showTimeline` and `showFlamegraph` here
  // (UI-only view toggles that don't need to persist in agent state). All
  // canvas-state mutators (select_run, select_trace, pin_chart, clear_pinned)
  // are BACKEND tools defined in apps/agent/src/trace_tools.py — they return
  // Command(update={...}) which goes through LangGraph's state reducer and
  // survives the next STATE_SNAPSHOT. Earlier we shipped frontend duplicates
  // (renderChart / renderHTML / selectRun) that wrote only to React-local
  // state and got overwritten on the next snapshot from the agent — that's
  // why pinned charts vanished. Don't add them back.

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
    // Hard-wired dark palette — the canvas is unreadable on the kit's default
    // light theme (zinc-200 text on zinc-50 backgrounds). pr-[380px] keeps the
    // floating CopilotSidebar (width 380 below) from overlapping the right rail.
    <main className="flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100 pr-[380px]">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-zinc-800 bg-zinc-900/40 px-4 py-2.5">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold tracking-tight">
            {state.header.title}
          </h1>
          <p className="truncate text-[11px] text-zinc-500">
            {state.header.subtitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[11px] text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            live
          </span>
          <span className="font-mono">
            <span className="text-zinc-200">{runs.length}</span> runs ·{" "}
            <span className="text-zinc-200">{traceSpans.length}</span> spans
          </span>
        </div>
      </header>

      <MetricsStrip run={selectedRun} spans={traceSpans} />

      <section className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] divide-x divide-zinc-800">
        {/* Left rail */}
        <aside className="min-h-0 overflow-y-auto bg-zinc-950">
          <div className="border-b border-zinc-800 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Runs
          </div>
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
        <section className="flex min-h-0 flex-col bg-zinc-950">
          <div className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-xs">
            <button
              type="button"
              onClick={() => setView("timeline")}
              className={`rounded px-2.5 py-1 transition ${
                view === "timeline"
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-200"
              }`}
            >
              Timeline
            </button>
            <button
              type="button"
              onClick={() => setView("flamegraph")}
              className={`rounded px-2.5 py-1 transition ${
                view === "flamegraph"
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-200"
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

      </section>

      {/* Pinned charts as a collapsible bottom strip — only when there are
          components to show, so the canvas isn't cluttered when empty. */}
      {state.pinnedCharts.length > 0 && (
        <section className="min-h-0 max-h-[40vh] shrink-0 overflow-y-auto border-t border-zinc-800 bg-zinc-950">
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/40 px-4 py-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Pinned · {state.pinnedCharts.length}
            </span>
            <button
              type="button"
              onClick={() =>
                setState((prev) => ({ ...prev, pinnedCharts: [] }))
              }
              className="text-[10px] text-zinc-500 hover:text-zinc-200"
            >
              clear all
            </button>
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
        </section>
      )}

      <CopilotSidebar
        defaultOpen
        width={380}
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
