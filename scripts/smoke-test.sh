#!/usr/bin/env bash
# Smoke test: starts the dev server, curls every route, asserts 200s.
# Usage: bash scripts/smoke-test.sh

set -euo pipefail

PORT=4322
BASE="http://localhost:$PORT"

echo "Starting dev server on port $PORT..."
npx astro dev --port $PORT &
SERVER_PID=$!

cleanup() {
  echo "Stopping dev server (PID $SERVER_PID)..."
  kill $SERVER_PID 2>/dev/null || true
  wait $SERVER_PID 2>/dev/null || true
}
trap cleanup EXIT

# Wait for server to be ready
echo "Waiting for server..."
for i in $(seq 1 30); do
  if curl -s -o /dev/null "$BASE/" 2>/dev/null; then
    echo "Server ready."
    break
  fi
  sleep 1
done

PASS=0
FAIL=0

check() {
  local url="$1"
  local expected="${2:-200}"
  local host="${3:-}"
  local extra_args=""
  if [ -n "$host" ]; then
    extra_args="-H Host:$host"
  fi
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' $extra_args "$url")
  if [ "$status" = "$expected" ]; then
    echo "  PASS $url (${host:-localhost}) -> $status"
    PASS=$((PASS + 1))
  else
    echo "  FAIL $url (${host:-localhost}) -> $status (expected $expected)"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "=== Route checks ==="
check "$BASE/"
check "$BASE/sessions"
check "$BASE/matches"
check "$BASE/rooms"
check "$BASE/history"
check "$BASE/feed.xml"
check "$BASE/api/status.json"

echo ""
echo "=== Scope-locked checks ==="
check "$BASE/" 200 "status.sessions.gg"
check "$BASE/matches" 404 "status.sessions.gg"
check "$BASE/" 200 "status.monkeylabs.gg"
check "$BASE/sessions" 200 "status.monkeylabs.gg"

echo ""
echo "=== Subscribe endpoint ==="
SUB_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Content-Type: application/json" -d '{"email":"test@example.com"}' "$BASE/api/subscribe")
if [ "$SUB_STATUS" = "200" ]; then
  echo "  PASS POST /api/subscribe -> $SUB_STATUS"
  PASS=$((PASS + 1))
else
  echo "  FAIL POST /api/subscribe -> $SUB_STATUS"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
echo "All smoke tests passed."
