#!/usr/bin/env bash
# Interleaved A/B: runs A,B,A,B,... so machine drift hits both equally.
# usage: ab-run.sh <distA> <distB> <rounds> <cpu> <outdir> [scenarios] [extra bench args...]
set -u
A="$1"; B="$2"; ROUNDS="$3"; CPU="$4"; OUT="$5"; SC="${6:-boot,idle,scroll,filter,storm}"; shift 6 2>/dev/null || shift $#
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"; rm -f "$OUT"/A-*.json "$OUT"/B-*.json "$OUT/done"
for i in $(seq 1 "$ROUNDS"); do
  node "$HERE/bench.mjs" --dist "$A" --label "A$i" --runs 1 --cpu "$CPU" --scenarios "$SC" --out "$OUT/A-$i.json" "$@" > "$OUT/A-$i.log" 2>&1
  node "$HERE/bench.mjs" --dist "$B" --label "B$i" --runs 1 --cpu "$CPU" --scenarios "$SC" --out "$OUT/B-$i.json" "$@" > "$OUT/B-$i.log" 2>&1
done
node "$HERE/agg-ab.mjs" "$OUT"
echo DONE > "$OUT/done"
