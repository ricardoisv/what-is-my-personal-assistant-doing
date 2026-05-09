import type { AgentState } from "./types";

export const initialState: AgentState = {
  runs: [],
  selectedRunId: null,
  selectedTraceId: null,
  pinnedCharts: [],
  header: {
    title: "Trace Insights",
    subtitle: "What is my assistant doing?",
  },
};

export function mergeAgentState(raw: unknown): AgentState {
  const partial =
    raw && typeof raw === "object" ? (raw as Partial<AgentState>) : {};
  return {
    ...initialState,
    ...partial,
    header: { ...initialState.header, ...(partial.header ?? {}) },
    runs: partial.runs ?? initialState.runs,
    pinnedCharts: partial.pinnedCharts ?? initialState.pinnedCharts,
  };
}
