#!/usr/bin/env bash
# Runs the repo's own mocked UI verifications against a built dist served on :8080.
# usage: run-suite.sh <distDir> <label>
# Only scripts that mock every *.supabase.co request are included (verify-crm-ui and
# verify-products-ui hit the real backend; qualification-roles/password-reset do not block the
# realtime WebSocket in every context. All four are deliberately excluded).
set -u
DIST="$(cd "$1" && pwd)"; LABEL="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$(cd "$HERE/../.." && pwd)"
OUT="$PROJECT/.verification.local/perf-suite-$LABEL"
rm -rf "$OUT"; mkdir -p "$OUT/.verification.local"

UI=(verify-auth-ui verify-live-sync-ui verify-dashboard-periods verify-sales-management-ui verify-context-daily-ui verify-goals-ranking-ui
    verify-rankings-and-pipeline-ui verify-daily-calls-ui verify-level-ui verify-crm-results-ui verify-crm-importados-ui)
UNIT=(verify-dashboard-sync-unit verify-executive-avatar-unit verify-arena-unit verify-context-daily-unit verify-crm-unit)

( cd "$HERE" && node serve.mjs "$DIST" 8080 > "$OUT/server.log" 2>&1 ) &
SERVER=$!
sleep 2

echo "== $LABEL: UI scripts against $DIST ==" | tee "$OUT/summary.txt"
for s in "${UI[@]}"; do
  f="$PROJECT/scripts/$s.mjs"
  [ -f "$f" ] || { echo "SKIP  $s (missing)" | tee -a "$OUT/summary.txt"; continue; }
  # UI scripts write screenshots relative to cwd, so run them from the scratch dir.
  ( cd "$OUT" && CRM_TEST_ORIGIN=http://127.0.0.1:8080 timeout 240 node "$f" > "$OUT/$s.log" 2>&1 ); code=$?
  if [ $code -eq 0 ]; then echo "PASS  $s" | tee -a "$OUT/summary.txt"; else echo "FAIL($code)  $s :: $(tail -n 3 "$OUT/$s.log" | tr '\n' ' ' | cut -c1-260)" | tee -a "$OUT/summary.txt"; fi
done
kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null

echo "== $LABEL: unit scripts (project root cwd) ==" | tee -a "$OUT/summary.txt"
for s in "${UNIT[@]}"; do
  f="$PROJECT/scripts/$s.mjs"
  [ -f "$f" ] || { echo "SKIP  $s (missing)" | tee -a "$OUT/summary.txt"; continue; }
  ( cd "$PROJECT" && timeout 120 node "$f" > "$OUT/$s.log" 2>&1 ); code=$?
  if [ $code -eq 0 ]; then echo "PASS  $s" | tee -a "$OUT/summary.txt"; else echo "FAIL($code)  $s :: $(tail -n 3 "$OUT/$s.log" | tr '\n' ' ' | cut -c1-260)" | tee -a "$OUT/summary.txt"; fi
done
echo "DONE" | tee -a "$OUT/summary.txt"
