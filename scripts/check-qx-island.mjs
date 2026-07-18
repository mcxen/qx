/**
 * Pure unit checks for QxIsland session priority / render mode / plugin caps.
 * No DOM — run with: node scripts/check-qx-island.mjs
 *
 * Mirrors logic in src/island/session/* so refactors stay honest.
 * Keep in sync with docs/qx-island-architecture.md §4.3 / §3.6 / §5.2.
 */

const PRIORITY_RANK = {
  task: 0,
  error: 1,
  toast: 2,
  location: 3,
  home: 4,
};

function stickyBoost(session) {
  if (!session.sticky) return 0;
  if (session.priority === "task" || session.priority === "error") return 1;
  return 0;
}

function compareSessions(a, b) {
  const rankA = PRIORITY_RANK[a.priority];
  const rankB = PRIORITY_RANK[b.priority];
  if (rankA !== rankB) return rankA - rankB;
  const stickyA = stickyBoost(a);
  const stickyB = stickyBoost(b);
  if (stickyA !== stickyB) return stickyB - stickyA;
  if (a.rankEpoch !== b.rankEpoch) return b.rankEpoch - a.rankEpoch;
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function resolveDockedWinner(sessions) {
  return resolveRotatingWinner(sessions, 0);
}

function resolveRotatingWinner(sessions, rotationIndex) {
  if (sessions.length === 0) return null;
  const ordered = [...sessions].sort(compareSessions);
  const best = ordered[0];
  if (best.priority !== "location") return best.id;
  const standing = ordered.filter((session) => session.priority === "location");
  return standing[Math.abs(Math.trunc(rotationIndex)) % standing.length]?.id ?? best.id;
}

function resolveDockedRenderMode({ exception, winnerId }) {
  if (exception) return "exception";
  if (winnerId) return "store";
  return "empty";
}

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("ok:", msg);
  }
}

// --- priority bands ---
{
  const sessions = [
    { id: "home", priority: "home", sticky: false, rankEpoch: 9, createdAt: 9 },
    { id: "toast", priority: "toast", sticky: false, rankEpoch: 8, createdAt: 8 },
    { id: "task", priority: "task", sticky: false, rankEpoch: 1, createdAt: 1 },
  ];
  assert(resolveDockedWinner(sessions) === "task", "task beats toast and home");
}

// --- standing module/plugin sessions rotate, important events preempt ---
{
  const standing = [
    { id: "calendar", priority: "location", sticky: true, rankEpoch: 1, createdAt: 1 },
    { id: "pomodoro", priority: "location", sticky: true, rankEpoch: 2, createdAt: 2 },
  ];
  assert(resolveRotatingWinner(standing, 0) === "pomodoro", "rotation starts with current standing session");
  assert(resolveRotatingWinner(standing, 1) === "calendar", "rotation fairly advances to next session");
  const important = [
    ...standing,
    { id: "download", priority: "task", sticky: true, rankEpoch: 1, createdAt: 3 },
  ];
  assert(resolveRotatingWinner(important, 1) === "download", "important task preempts standing rotation");
}

// --- sticky within task band ---
{
  const sessions = [
    { id: "search", priority: "task", sticky: false, rankEpoch: 5, createdAt: 5 },
    { id: "compress", priority: "task", sticky: true, rankEpoch: 2, createdAt: 2 },
  ];
  assert(resolveDockedWinner(sessions) === "compress", "sticky task wins over non-sticky");
}

// --- rankEpoch within band (progress must not steal via contentUpdatedAt) ---
{
  const sessions = [
    { id: "a", priority: "task", sticky: false, rankEpoch: 1, createdAt: 1 },
    { id: "b", priority: "task", sticky: false, rankEpoch: 3, createdAt: 0 },
  ];
  assert(resolveDockedWinner(sessions) === "b", "higher rankEpoch wins within band");
}

// --- render mode exception ---
assert(
  resolveDockedRenderMode({ exception: true, winnerId: "task-1" }) === "exception",
  "exception suppresses store winner",
);
assert(
  resolveDockedRenderMode({ exception: false, winnerId: "task-1" }) === "store",
  "store mode when winner present",
);
assert(
  resolveDockedRenderMode({ exception: false, winnerId: null }) === "empty",
  "empty when no winner",
);

// --- plugin priority policy (table) ---
function pluginAccepts(priority) {
  return priority === "toast";
}
assert(pluginAccepts("toast"), "plugin toast allowed");
assert(!pluginAccepts("task"), "plugin task rejected");
assert(!pluginAccepts("error"), "plugin error priority rejected (use tone danger)");
assert(!pluginAccepts("home"), "plugin home rejected");

// `plugin-display` is a separate permission-gated host contract. The host fixes
// its priority/placement so a plugin cannot impersonate a task or own chrome.
function normalizePluginDisplay(session) {
  return {
    ...session,
    source: "plugin-display",
    priority: "location",
    placement: "docked-or-float",
    sticky: true,
  };
}
{
  const display = normalizePluginDisplay({ priority: "task", placement: "floating" });
  assert(display.priority === "location", "plugin display cannot claim task priority");
  assert(display.placement === "docked-or-float", "plugin display uses host placement policy");
  assert(display.sticky === true, "plugin display remains available as standing data");
}

// --- generation CAS sketch ---
{
  let gen = 0;
  const show = () => {
    gen += 1;
    return gen;
  };
  const update = (expected) => {
    if (expected !== gen) return false;
    gen += 1;
    return true;
  };
  const g1 = show();
  assert(update(g1) === true, "CAS update matches generation");
  assert(update(g1) === false, "stale generation dropped");
}

if (failures > 0) {
  console.error(`\n${failures} island check(s) failed`);
  process.exit(1);
}
console.log("\nall island checks passed");
