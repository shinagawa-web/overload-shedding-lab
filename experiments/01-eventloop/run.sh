#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$ROOT"

APP_URL="${APP_URL:-http://localhost:3000}"
CONCURRENCY="${CONCURRENCY:-50}"
DURATION="${DURATION:-30}"
WARMUP="${WARMUP:-10}"
SHED="${SHED:-}"

if [[ -n "$SHED" ]]; then
  SHED_THRESHOLD_MS="${SHED_THRESHOLD_MS:-70}" docker compose --profile base up -d --build
else
  docker compose --profile base up -d --build
fi

sleep 5

SUFFIX="${SHED:+-shed}"
CSV_OUT="experiments/01-eventloop/results${SUFFIX}.csv"

APP_URL="$APP_URL" CONCURRENCY="$CONCURRENCY" DURATION="$DURATION" WARMUP="$WARMUP" \
  CSV_OUT="$CSV_OUT" node loadgen/ramp.js exp01

node analyze/plot.js "$CSV_OUT" > "experiments/01-eventloop/summary${SUFFIX}.md"

docker compose --profile base down

echo "Results: $CSV_OUT"
echo "Summary: experiments/01-eventloop/summary${SUFFIX}.md"
