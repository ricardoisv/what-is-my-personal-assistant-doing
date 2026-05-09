"""Entry point for the `hermes-traced` console script.

Patches must run BEFORE Hermes's modules import. We do install() first,
then defer to hermes_cli.main().
"""

from __future__ import annotations

import sys


def main() -> int:
    from .hermes import install
    install()

    try:
        from hermes_cli.main import main as hermes_main  # type: ignore[import-not-found]
    except Exception as e:  # noqa: BLE001
        print(
            "hermes-traced: could not import hermes_cli.main — is hermes-agent installed?\n"
            f"  underlying error: {e}\n"
            "  install: curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash",
            file=sys.stderr,
        )
        return 1

    hermes_main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
