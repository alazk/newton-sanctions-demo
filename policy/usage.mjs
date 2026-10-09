/**
 * How much has the demo been used? Counts real checks from Newton's task index.
 *
 *   node policy/usage.mjs                    # since public launch, Sep 10 (UTC)
 *   node policy/usage.mjs --since 2026-09-20 # from another date (UTC)
 *   node policy/usage.mjs --all              # include pre-launch development
 *   node policy/usage.mjs --include-tests    # keep our own script/curl runs
 *
 * Read-only. Needs NEWTON_API_KEY (taken from the environment, .env.local or
 * ../deploy/.env — never printed).
 *
 * WHAT A "CHECK" IS
 *
 * Every press of "Check this transfer" creates one quorum-signed task. The
 * Explorer API lists tasks per policy, so this walks every policy the demo has
 * ever been bound to and keeps the tasks it finds.
 *
 * WHAT IT CANNOT TELL YOU
 *
 * How many PEOPLE. The demo submits server-side with one API key, and the page
 * puts a fresh random sender on every run, so ten visitors and one visitor
 * pressing ten times look identical on chain. This counts checks, not people.
 *
 * TEST RUNS
 *
 * The page always sends a random `from`. Our scripts and curl tests don't —
 * they fall back to the owner wallet. Tasks whose intent.from is the owner are
 * our own and are excluded unless --include-tests.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://explorer.api.newton.xyz/v1";
const OWNER = "0x8b4ba8708239757e84ad26a503500bc5fc1c1a48";

/** Every policy the demo has been bound to, newest first. */
const POLICIES = {
  "0xd0Ff7aca199AeaCC5F316b029A476Da7684a3877": "RedStone (live since Oct 9)",
  "0x95c66b29DB62136094DC95e40C33cc524cFe4ba1": "denylist v0.7 (Sep 28 – Oct 9)",
  "0x627222E71CCEc59C315c83C095f12458FaB5B221": "denylist (pre-0.7)",
  "0xb06abbf45715CB53231d7Dd8b2AfFaBc76485a30": "yente rev-3",
  "0x990A6E4f57A2561a744EEc169E3fa92Dba098682": "yente rev-2",
  "0xDDD3AC3ceE21a096407E3D9c921908dB1fb743D2": "yente rev-1",
  "0xf5c9D9eddCb85395e4D53db309AE3E915ad3897D": "earlier policy",
  "0x90cdaE01456EF4DaBcf0Bd1aCb409D2094607e5C": "August denylist",
  "0x964f2d2CE6f3ca11F5643175B4792b39DDc43B40": "August bisect",
};

/**
 * Protocol 0.7 tasks carry the client's policy-SET id, and the index may not
 * file them under the policy address. Query by id as well; tasks are deduped.
 * Add a line here whenever setPolicies produces a new policyId.
 */
const POLICY_IDS = {
  "0x34addc4872768487ad553a23a8b7e85e792e9563ba57d7addc983e20ee4caded": "denylist v0.7 (live since Sep 28)",
};

/** Public launch. Checks before this were development. --since / --all override. */
const LAUNCH = "2026-09-10";

// ── args & key ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const sinceArg = argv.includes("--all")
  ? null
  : argv.includes("--since")
    ? argv[argv.indexOf("--since") + 1]
    : LAUNCH;
const SINCE = sinceArg ? new Date(sinceArg + (sinceArg.length === 10 ? "T00:00:00Z" : "")) : null;
const INCLUDE_TESTS = argv.includes("--include-tests");

function fromEnvFile(file, key) {
  if (!existsSync(file)) return undefined;
  const m = readFileSync(file, "utf8").match(new RegExp(`^\\s*${key}\\s*=\\s*["']?([^"'\\n]+)`, "m"));
  return m?.[1].trim();
}
const KEY_SOURCES = [
  ["the pasted key", process.env.NEWTON_API_KEY],
  [".env.local", fromEnvFile(join(ROOT, ".env.local"), "NEWTON_API_KEY")],
  ["deploy/.env", fromEnvFile(join(ROOT, "../deploy/.env"), "NEWTON_API_KEY")],
];
const [KEY_FROM, KEY] = KEY_SOURCES.find(([, v]) => v && v.trim()) ?? [null, null];
if (KEY) process.stderr.write(`using ${KEY_FROM} (${KEY.slice(0, 6)}…, ${KEY.length} chars)\n`);
if (!KEY) {
  console.error("NEWTON_API_KEY not found in env, .env.local or ../deploy/.env");
  process.exit(1);
}

async function get(path, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(API + path, {
      headers: { Authorization: `Bearer ${KEY}`, "X-Protocol-Network": "testnet" },
    });
    if (res.status === 404) return null;
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
      continue;
    }
    const { detail } = await res.json().catch(() => ({ detail: res.statusText }));
    if (res.status === 401) {
      console.error(`\nNewton rejected ${KEY_FROM}: ${detail}.`);
      if (KEY_FROM !== "the pasted key") console.error("Nothing was pasted at the prompt, so it fell back to that file. Run again and paste the key.");
      process.exit(1);
    }
    throw new Error(`Explorer API ${res.status} on ${path}: ${detail}`);
  }
  throw new Error(`Explorer API kept failing on ${path}`);
}

async function allTasks(path) {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await get(`${path}?page=${page}&size=100`);
    if (!r?.results?.length) break;
    out.push(...r.results);
    if (page * r.size >= r.total) break;
  }
  return out;
}

/** Run fn over items with limited concurrency. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]).catch(() => null);
      }
    }),
  );
  return out;
}

/** Strict: exact zero is denied, exact one is allowed, anything else is unread. */
function verdict(t) {
  const er = t.evaluation_result;
  if (t.error || (Array.isArray(t.operator_errors) ? t.operator_errors.length : t.operator_errors)) return "failed";
  if (er == null) return "pending";
  const hex = String(er).replace(/^0x/, "");
  if (/^0*$/.test(hex)) return "denied";
  if (/^0*1$/.test(hex)) return "allowed";
  return "other";
}

// ── collect ───────────────────────────────────────────────────────────────
process.stderr.write("reading tasks");
const byId = new Map();
const sources = [
  ...Object.entries(POLICIES).map(([a, label]) => [`/policy/address/${a}/task`, label]),
  ...Object.entries(POLICY_IDS).map(([id, label]) => [`/policy/id/${id}/task`, label]),
];
for (const [path, label] of sources) {
  const ts = await allTasks(path);
  process.stderr.write(".");
  for (const t of ts) if (!byId.has(t.id)) byId.set(t.id, { ...t, _policy: label });
}
const tasks = [...byId.values()];

let inWindow = tasks.filter((t) => !SINCE || (t.task_created_at && new Date(t.task_created_at) >= SINCE));

// Intent lives on the task detail only — one request per task.
process.stderr.write(` ${inWindow.length} tasks, reading intents`);
const details = await pool(inWindow, 8, (t) => get(`/task/${t.id}`));
process.stderr.write(" done\n\n");
inWindow = inWindow.map((t, i) => ({ ...t, _intent: details[i]?.intent ?? null }));

const isTest = (t) => String(t._intent?.from ?? "").toLowerCase() === OWNER;
const tests = inWindow.filter(isTest);
const checks = INCLUDE_TESTS ? inWindow : inWindow.filter((t) => !isTest(t));

// ── report ────────────────────────────────────────────────────────────────
const count = (arr, key) => arr.reduce((m, x) => ((m[key(x)] = (m[key(x)] ?? 0) + 1), m), {});
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

const byVerdict = count(checks, verdict);
const byDay = count(checks, (t) => (t.task_created_at ?? "unknown").slice(0, 10));
const byPolicy = count(checks, (t) => t._policy);
const recipients = new Set(checks.map((t) => String(t._intent?.to ?? "").toLowerCase()).filter(Boolean));
const dates = checks.map((t) => t.task_created_at).filter(Boolean).sort();

console.log("Newton Sanctions Demo — usage");
console.log("─".repeat(44));
console.log(
  `window          ${SINCE ? SINCE.toISOString().slice(0, 10) : "all time"} → now${sinceArg === LAUNCH ? "  (since launch)" : ""}`,
);
console.log(`checks run      ${checks.length}${INCLUDE_TESTS ? "  (tests included)" : `  (+${tests.length} test runs excluded)`}`);
console.log(`  denied        ${byVerdict.denied ?? 0}`);
console.log(`  allowed       ${byVerdict.allowed ?? 0}`);
if (byVerdict.failed) console.log(`  failed        ${byVerdict.failed}`);
if (byVerdict.pending) console.log(`  pending       ${byVerdict.pending}`);
if (byVerdict.other) console.log(`  unread        ${byVerdict.other}`);
console.log(`recipients      ${recipients.size} distinct addresses checked`);
if (dates.length) console.log(`first / last    ${dates[0].slice(0, 16)}Z  /  ${dates.at(-1).slice(0, 16)}Z`);

console.log("\nby day (UTC)");
const maxDay = Math.max(1, ...Object.values(byDay));
for (const d of Object.keys(byDay).sort()) {
  const bar = "█".repeat(Math.max(1, Math.round((byDay[d] / maxDay) * 30)));
  console.log(`  ${d}  ${padL(byDay[d], 4)}  ${bar}`);
}

console.log("\nby policy");
for (const [p, n] of Object.entries(byPolicy).sort((a, b) => b[1] - a[1])) console.log(`  ${pad(p, 34)} ${padL(n, 4)}`);

/*
 * Where each recipient came from.
 *
 *   "Sanctioned" button  picks from lib/sanctioned-pool.ts.
 *   "Clean" button       generates 20 random bytes, an address that has never
 *                        existed on any chain.
 *   typed by a visitor   anything else: a listed address outside the pool, or
 *                        a wallet with real history (nonce, balance or code) on
 *                        mainnet or Sepolia. A random address has none of those.
 */
const grab = (f) =>
  existsSync(join(ROOT, f))
    ? [...readFileSync(join(ROOT, f), "utf8").matchAll(/"(0x[0-9a-fA-F]{40})"/g)].map((m) => m[1].toLowerCase())
    : [];
const POOL = new Set(grab("lib/sanctioned-pool.ts"));
const LISTED = new Set([...grab("lib/ofac-addresses.ts"), ...grab("lib/ofac-full.ts")]);

const RPCS = {
  mainnet: "https://ethereum-rpc.publicnode.com",
  sepolia: process.env.RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
};
async function activity(addr) {
  for (const url of Object.values(RPCS)) {
    const body = ["eth_getTransactionCount", "eth_getBalance", "eth_getCode"].map((method, id) => ({
      jsonrpc: "2.0",
      id,
      method,
      params: [addr, "latest"],
    }));
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then((x) => x.json())
      .catch(() => null);
    if (!Array.isArray(r)) return null; // unknown, don't guess
    if (r.some((x) => x.result && !/^0x0*$/.test(x.result))) return true;
  }
  return false;
}

const firstSeen = new Map();
for (const t of [...checks].sort((a, b) => String(a.task_created_at).localeCompare(String(b.task_created_at)))) {
  const to = String(t._intent?.to ?? "").toLowerCase();
  if (to && !firstSeen.has(to)) firstSeen.set(to, { at: t.task_created_at, n: 0, v: verdict(t) });
  if (to) firstSeen.get(to).n++;
}
const unknownTo = [...firstSeen.keys()].filter((a) => !POOL.has(a) && !LISTED.has(a));
process.stderr.write(`\nchecking ${unknownTo.length} recipients for on-chain history…`);
const act = await pool(unknownTo, 6, activity);
process.stderr.write(" done\n");
const hasHistory = new Map(unknownTo.map((a, i) => [a, act[i]]));

const kind = (a) =>
  POOL.has(a) ? "pool" : LISTED.has(a) ? "typed-listed" : hasHistory.get(a) === true ? "typed-wallet" : hasHistory.get(a) === false ? "random" : "unknown";
const groups = {};
for (const [a, info] of firstSeen) (groups[kind(a)] ??= []).push([a, info]);
const nChecks = (k) => (groups[k] ?? []).reduce((s, [, i]) => s + i.n, 0);

console.log("\nrecipients — how they were chosen");
console.log(`  "Sanctioned" button          ${padL((groups.pool ?? []).length, 3)} addresses  ${padL(nChecks("pool"), 4)} checks`);
console.log(`  "Clean" button (random)      ${padL((groups.random ?? []).length, 3)} addresses  ${padL(nChecks("random"), 4)} checks`);
console.log(`  typed: real wallet           ${padL((groups["typed-wallet"] ?? []).length, 3)} addresses  ${padL(nChecks("typed-wallet"), 4)} checks`);
console.log(`  typed: listed, not in pool   ${padL((groups["typed-listed"] ?? []).length, 3)} addresses  ${padL(nChecks("typed-listed"), 4)} checks`);
if (groups.unknown) console.log(`  couldn't check (RPC error)   ${padL(groups.unknown.length, 3)} addresses`);

const custom = [...(groups["typed-wallet"] ?? []), ...(groups["typed-listed"] ?? [])];
if (custom.length) {
  console.log("\ncustom wallets checked");
  for (const [a, i] of custom.sort((x, y) => String(x[1].at).localeCompare(String(y[1].at))))
    console.log(`  ${String(i.at).slice(0, 16)}Z  ${a}  ${pad(i.v, 7)}${i.n > 1 ? ` ×${i.n}` : ""}`);
}

console.log(
  "\nCounts checks, not people: every run is signed server-side with a random\n" +
    "sender, so repeat visitors can't be told apart on chain.",
);
