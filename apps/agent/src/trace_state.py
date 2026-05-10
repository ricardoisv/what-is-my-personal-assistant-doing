"""TraceStateMiddleware — declares the trace-insights canvas fields on
the agent's TypedDict state so they survive STATE_SNAPSHOT round-trips.

Without the schema declaration the agent's state would only contain
`messages`, `jump_to`, `structured_response`, `copilotkit`. When the
agent emits STATE_SNAPSHOT to the frontend, the snapshot replaces the
frontend's local agent.state, wiping any keys (`runs`, `selectedRunId`,
`pinnedCharts`, …) the React handlers wrote via `agent.setState`.

By declaring those keys here, LangGraph carries them through state-event
emission so the frontend canvas survives reloads of the run loop.

There is intentionally NO hydration step: trace data lives in the trace
MCP, and the canvas live-tails via SSE. The agent doesn't pre-populate
state on first turn — the user drives by either running Hermes (which
emits spans → canvas updates from SSE) or by asking the analyst to query.
"""

from __future__ import annotations

from typing import Annotated, Any, Optional

from langchain.agents.middleware.types import AgentMiddleware, AgentState
from typing_extensions import NotRequired, TypedDict


class _Header(TypedDict, total=False):
    title: str
    subtitle: str


class _Run(TypedDict, total=False):
    run_id: str
    query: str
    status: str
    started_ns: int
    ended_ns: Optional[int]
    model: Optional[str]


class _PinnedChart(TypedDict, total=False):
    """Component pinned by the analyst into the free-area pane.

    `kind` is "a2ui" for declarative A2UI components, "html" for
    open-ended generative UI (sandboxed iframe), "controlled" for kit-
    rendered components keyed by `name`.
    """
    id: str
    kind: str
    name: NotRequired[str]
    props: NotRequired[dict[str, Any]]
    html: NotRequired[str]


def _replace(_left: Any, right: Any) -> Any:
    """LangGraph reducer that always takes the most recent value."""
    return right


class TraceCanvasState(AgentState):
    """Extended agent state for the trace-insights canvas.

    Each field is `NotRequired` so the agent can boot without all fields
    set; the frontend's mergeState provides defaults on the React side.
    """

    runs: NotRequired[Annotated[list[_Run], _replace]]
    selectedRunId: NotRequired[Annotated[Optional[str], _replace]]
    selectedTraceId: NotRequired[Annotated[Optional[str], _replace]]
    pinnedCharts: NotRequired[Annotated[list[_PinnedChart], _replace]]
    header: NotRequired[Annotated[_Header, _replace]]


class TraceStateMiddleware(AgentMiddleware[TraceCanvasState, Any]):  # type: ignore[type-arg]
    """Contribute the trace-canvas state schema to the LangGraph state.

    LangGraph merges middleware schemas, so inserting this alongside
    CopilotKitMiddleware adds the trace canvas fields. No hydration —
    the canvas is populated reactively from MCP queries + SSE live tail.

    The `state_schema` class attribute MUST be set explicitly. The
    `Generic[StateT, ContextT]` type parameter is a type hint only —
    `AgentMiddleware.state_schema` defaults to `_DefaultAgentState`
    unless the subclass overrides it. Without this line, every
    Command(update={pinnedCharts: ...}) from a tool is silently
    dropped because the schema doesn't declare those fields.
    """

    state_schema = TraceCanvasState
