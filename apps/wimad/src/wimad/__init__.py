"""wimad — What Is My Assistant Doing.

Public surface: decorators, span context manager, configure().
"""

from .context import configure, span, current_run_id
from .decorators import workflow, task, tool, agent

__all__ = [
    "configure",
    "span",
    "current_run_id",
    "workflow",
    "task",
    "tool",
    "agent",
]
