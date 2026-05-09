"""LangChain tools the Analyst Deep Agent uses to query the trace store.

Each tool is a thin wrapper over `trace_mcp.call_trace_tool(...)`. The MCP
server returns JSON; we pass it through to the model verbatim so the
agent can reason about the structure.

Why not load MCP tools dynamically into LangChain? Two reasons:
1. The kit's existing pattern (see the previous notion_tools.py) hand-
   writes one Python @tool per MCP tool — keeps the description in our
   code, lets us shape the docstring for the LLM, and avoids the
   surprise of MCP-server schema drift breaking the agent.
2. Hand-written tools can return Command(update=) for state mutations
   when needed (we don't here, but the option is open if later phases
   want the agent to drive `selectedRunId`, `pinnedCharts`, etc.).
"""

from __future__ import annotations

import json
import uuid
from typing import Annotated, Any, Dict, List, Optional

from dotenv import load_dotenv
from langchain_core.messages import ToolMessage
from langchain_core.tools import tool, InjectedToolCallId
from langgraph.prebuilt import InjectedState
from langgraph.types import Command

from .trace_mcp import call_trace_tool

load_dotenv()


# --- read tools (call MCP, pass through) ---------------------------------

@tool
def list_runs(
    limit: Annotated[int, "Max runs to return, most recent first."] = 50,
    status: Annotated[
        Optional[str],
        "Optional status filter: 'running', 'done', or 'failed'.",
    ] = None,
) -> str:
    """List Hermes (or wimad-decorated) runs, most recent first.

    Returns JSON `{ "runs": [...] }`. Each run has: run_id, query,
    status, started_ns, ended_ns, model. Use this as the first tool when
    the user asks 'what was the last run' / 'show me runs' / 'any
    failures recently'.
    """
    args: Dict[str, Any] = {"limit": limit}
    if status:
        args["status"] = status
    return json.dumps(call_trace_tool("list_runs", args))


@tool
def get_run(run_id: Annotated[str, "Run id from list_runs."]) -> str:
    """Fetch one run with its workflow span summary.

    Returns JSON `{run, workflow, span_count}`. For the full span tree
    use get_trace_tree with the workflow span's trace_id.
    """
    return json.dumps(call_trace_tool("get_run", {"run_id": run_id}))


@tool
def query_spans(
    run_id: Annotated[Optional[str], "Filter by run."] = None,
    trace_id: Annotated[Optional[str], "Filter by trace."] = None,
    name_prefix: Annotated[
        Optional[str],
        "Match span name prefix, e.g. 'hermes.tool.' for all tool calls.",
    ] = None,
    service_name: Annotated[Optional[str], "Filter by service."] = None,
    status_code: Annotated[Optional[str], "'ok' or 'error'."] = None,
    limit: Annotated[int, "Max spans to return."] = 200,
) -> str:
    """Query individual spans by run / trace / name prefix / status.

    Returns JSON `{spans: [...]}`. Each span has trace_id, span_id,
    parent_span_id, name, service_name, kind, start_ns, end_ns,
    duration_ns, status_code, attributes, events.
    """
    args: Dict[str, Any] = {"limit": limit}
    for k, v in {
        "run_id": run_id,
        "trace_id": trace_id,
        "name_prefix": name_prefix,
        "service_name": service_name,
        "status_code": status_code,
    }.items():
        if v is not None:
            args[k] = v
    return json.dumps(call_trace_tool("query_spans", args))


@tool
def get_trace_tree(trace_id: Annotated[str, "trace_id from a span."]) -> str:
    """Fetch every span on one trace, plus its root.

    Returns JSON `{trace_id, root, spans}`. The caller can rebuild the
    parent/child tree from each span's parent_span_id.
    """
    return json.dumps(call_trace_tool("get_trace_tree", {"trace_id": trace_id}))


@tool
def aggregate(
    metric: Annotated[str, "'duration' or 'count'."] = "duration",
    group_by: Annotated[
        str,
        "'name', 'service_name', 'run_id', or 'status_code'.",
    ] = "name",
    run_id: Annotated[Optional[str], "Limit to one run."] = None,
    service_name: Annotated[Optional[str], "Limit to one service."] = None,
) -> str:
    """Aggregate span durations by name / service / run / status.

    Returns JSON `{aggregates: [{group_key, count, total_ns, p50_ns,
    p95_ns, max_ns}]}` sorted by total_ns desc. Use this to answer
    'which tool dominates wall time' / 'where did the run spend its
    time' questions.
    """
    args: Dict[str, Any] = {"metric": metric, "group_by": group_by}
    for k, v in {"run_id": run_id, "service_name": service_name}.items():
        if v is not None:
            args[k] = v
    return json.dumps(call_trace_tool("aggregate", args))


@tool
def compare_runs(
    run_a: Annotated[str, "Earlier run_id (baseline)."],
    run_b: Annotated[str, "Later run_id."],
) -> str:
    """Diff two runs by per-span-name aggregates.

    Returns JSON `{run_a, run_b, comparison}`. Each comparison row has
    `{group_key, a, b, delta_total_ns}` where delta is run_b - run_a.
    Sorted by absolute delta. Useful for 'why was today's run slower
    than yesterday's' questions.
    """
    return json.dumps(
        call_trace_tool("compare_runs", {"run_a": run_a, "run_b": run_b})
    )


# --- canvas-side helpers (mutate canvas state) ---------------------------

@tool
def select_run(
    run_id: Annotated[str, "Run id to focus in the canvas TraceDetail panel."],
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Open a run in the canvas TraceDetail panel.

    Drives the right-hand pane on the canvas. Use whenever you want the
    user's eye on a specific run (e.g. after answering a slowness
    question, focus the slow run).
    """
    return Command(
        update={
            "selectedRunId": run_id,
            "messages": [
                ToolMessage(
                    content=f"Focused run {run_id} in the TraceDetail panel.",
                    tool_call_id=tool_call_id,
                )
            ],
        }
    )


@tool
def select_trace(
    trace_id: Annotated[str, "Trace id to focus."],
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Open a trace in the canvas Flamegraph/Timeline panel."""
    return Command(
        update={
            "selectedTraceId": trace_id,
            "messages": [
                ToolMessage(
                    content=f"Focused trace {trace_id}.",
                    tool_call_id=tool_call_id,
                )
            ],
        }
    )


@tool
def pin_chart(
    kind: Annotated[
        str,
        "Component flavor: 'controlled' (kit-rendered named component), "
        "'a2ui' (declarative chart), or 'html' (open-ended generative UI).",
    ],
    name: Annotated[
        Optional[str],
        "Component name when kind='controlled' or 'a2ui'.",
    ] = None,
    props: Annotated[
        Optional[Dict[str, Any]],
        "Props for the controlled / a2ui component.",
    ] = None,
    html: Annotated[
        Optional[str],
        "Sandboxed HTML for kind='html'.",
    ] = None,
    state: Annotated[Dict[str, Any], InjectedState] = None,
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Pin a generative-UI component into the canvas free area.

    The canvas paints whatever you pin. Use 'controlled' when one of the
    canvas's known components fits, 'a2ui' when an A2UI chart fits, and
    'html' as the fallback when neither does.
    """
    chart_id = uuid.uuid4().hex[:8]
    chart: Dict[str, Any] = {"id": chart_id, "kind": kind}
    if name:
        chart["name"] = name
    if props:
        chart["props"] = props
    if html:
        chart["html"] = html

    current: List[Dict[str, Any]] = list((state or {}).get("pinnedCharts", []) or [])
    new_pinned = current + [chart]

    return Command(
        update={
            "pinnedCharts": new_pinned,
            "messages": [
                ToolMessage(
                    content=f"Pinned {kind} component (id={chart_id}).",
                    tool_call_id=tool_call_id,
                )
            ],
        }
    )


@tool
def clear_pinned() -> str:
    """Remove all pinned charts from the canvas free area."""
    return "Pinned-charts cleared."


# --- loader --------------------------------------------------------------

def load_trace_tools() -> List[Any]:
    """Backend tools for the Analyst Deep Agent."""
    tools: List[Any] = [
        list_runs,
        get_run,
        query_spans,
        get_trace_tree,
        aggregate,
        compare_runs,
        select_run,
        select_trace,
        pin_chart,
        clear_pinned,
    ]
    print(f"[analyst] backend tools loaded: {len(tools)}")
    return tools
