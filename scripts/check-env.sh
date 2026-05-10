#!/usr/bin/env bash
# scripts/check-env.sh — pre-flight wired into `predev` (npm convention).
#
# Validates that everything `npm run dev` needs is in place:
#   1. Docker daemon up.
#   2. npx is available.
#   3. apps/agent/.env exists and has GEMINI_API_KEY set to a non-stub value.
#
# Notion checks were removed when the kit pivoted to trace observability —
# the Analyst now reads from the wimad trace MCP, not Notion. Add a check
# here if you wire a different external integration in.
#
# Collects every problem into a numbered list rather than bailing on the
# first failure, so problems can be fixed in one pass.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PROBLEMS=()

# ---------- 1. Docker daemon -------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  PROBLEMS+=("Docker isn't installed. Install Docker Desktop and re-try.")
elif ! docker info >/dev/null 2>&1; then
  PROBLEMS+=("Docker isn't running. Start Docker Desktop and re-try.")
fi

# ---------- 2. npx -----------------------------------------------------------
if ! command -v npx >/dev/null 2>&1; then
  PROBLEMS+=("npx is not on PATH. Install Node.js 20+ (npm bundles npx).")
fi

# ---------- 3. agent/.env vars -----------------------------------------------
AGENT_ENV="$REPO_ROOT/apps/agent/.env"
if [[ ! -f "$AGENT_ENV" ]]; then
  PROBLEMS+=("apps/agent/.env is missing. Run: cp apps/agent/.env.example apps/agent/.env, then fill in the keys.")
else
  read_var() {
    local key="$1"
    grep -E "^[[:space:]]*${key}=" "$AGENT_ENV" | tail -n1 | sed -E "s/^[[:space:]]*${key}=//; s/^[\"']//; s/[\"'][[:space:]]*$//; s/[[:space:]]+$//"
  }
  is_stub() {
    local v="$1"
    [[ -z "$v" ]] && return 0
    case "$v" in
      stub*|"<paste"*|"<set"*|"replace-with-"*) return 0 ;;
    esac
    return 1
  }
  val="$(read_var "GEMINI_API_KEY" || true)"
  if is_stub "$val"; then
    PROBLEMS+=("GEMINI_API_KEY is unset (or a stub) in apps/agent/.env. Get a key at https://aistudio.google.com -> Get API key.")
  fi
fi

# ---------- Report -----------------------------------------------------------
if [[ ${#PROBLEMS[@]} -gt 0 ]]; then
  echo ""
  echo "Pre-flight check found ${#PROBLEMS[@]} problem(s):"
  echo ""
  i=1
  for p in "${PROBLEMS[@]}"; do
    first_line="${p%%$'\n'*}"
    rest="${p#*$'\n'}"
    echo "  $i. $first_line"
    if [[ "$rest" != "$p" ]]; then
      while IFS= read -r line; do
        echo "     $line"
      done <<<"$rest"
    fi
    i=$((i+1))
  done
  echo ""
  echo "Fix these and re-run \`npm run dev\`."
  exit 1
fi

exit 0
