import assert from "node:assert/strict";
import {
  canAccessArena,
  canAccessTraffic,
  countdown,
  cycleState,
  metricDelta,
  milestone,
  progressPercent,
} from "../src/lib/arena.ts";
import { addPopup } from "../src/lib/arena-popups.ts";

for (const role of ["sdr", "closer", "executive", "super_admin"])
  assert.equal(canAccessArena([role]), true);
for (const role of ["seller", "bdr", "traffic_manager"])
  assert.equal(canAccessArena([role]), false);
assert.equal(canAccessTraffic(["traffic_manager"]), true);
assert.equal(canAccessTraffic(["sdr"]), false);
assert.equal(progressPercent(125, 100), 125, "Excess must remain visible");
assert.equal(progressPercent(25, 50), 50, "An individual target must still end at 100%");
assert.equal(progressPercent(25, 200), 12.5, "The same score must reflect the configured target");
assert.equal(
  progressPercent(-0.2, 100),
  -0.2,
  "A reversal cannot be hidden in the number",
);
assert.equal(progressPercent(0, 0), 0);
const beginning = "2026-09-22T03:00:00Z", deadline = "2026-09-23T03:00:00Z";
assert.equal(cycleState(45, 100, beginning, deadline, Date.parse(beginning) + 43200000), "at_risk");
assert.equal(cycleState(45, 100, beginning, deadline, Date.parse(beginning) + 64800000), "below", "Pace changes with time even without new sales");
assert.equal(cycleState(99, 100, beginning, deadline, Date.parse(deadline)), "failed");
assert.equal(cycleState(101, 100, beginning, deadline, Date.parse(deadline)), "exceeded");
assert.equal(
  metricDelta(20, 0),
  null,
  "No invented percent when denominator is zero",
);
assert.equal(metricDelta(null, 10), null);
assert.equal(metricDelta(5, 10), -50);
assert.equal(
  countdown("2026-09-22T03:00:00Z", Date.parse("2026-09-22T03:00:01Z")),
  "00:00:00",
);
assert.equal(
  countdown("2026-09-23T03:00:00Z", Date.parse("2026-09-22T02:00:00Z")),
  "1d 01:00:00",
);
assert.deepEqual(
  [24.9, 25, 50, 90, 100, 110].map(milestone),
  [0, 25, 50, 90, 100, 101],
);
const popup = (id, priority, receivedAt = 1000) => ({
  id,
  title: id,
  priority,
  receivedAt,
  sound: false,
});
let queue = [];
for (let i = 0; i < 12; i++)
  queue = addPopup(queue, popup(String(i), 1, 1000 + i));
assert.equal(queue.length, 5, "Queue remains bounded");
queue = addPopup(queue, popup("sale", 3, 2000));
assert.equal(queue[0].id, "sale", "Sale takes precedence");
queue = addPopup(queue, popup("sale", 3, 3000));
assert.equal(queue.filter((p) => p.id === "sale").length, 1);
assert.deepEqual(
  addPopup(queue, popup("fresh", 1, 40000)).map((p) => p.id),
  ["fresh"],
  "Expired popups are discarded",
);
console.log(
  "Arena: access, progress, comparisons, countdown, milestones and bounded priority queue passed.",
);
