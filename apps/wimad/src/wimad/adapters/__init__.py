"""wimad framework adapters — instrument third-party agents we don't own.

`wimad.adapters.hermes.install()` monkey-patches NousResearch's hermes-agent
dispatch points so spans flow through the same pipeline as decorated code.
"""
