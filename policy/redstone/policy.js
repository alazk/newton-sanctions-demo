// RedStone Sanctions Oracle → Newton data oracle (v2, audit Oct 2026).
//
// Reads RedStone's onchain sanctions list on Ethereum mainnet
// (0x574Ad490fE8087B580DB227a8Ca7EfB7C19Dc8C4: 463 official lists via
// OpenSanctions per RedStone, updated weekly, timestamped) and returns, for the
// payee and payer of the intent, whether each is listed, plus how old the list
// is, so the Rego can refuse to screen against a stale one.
//
// v2 changes, each closing an audit finding:
//   - RPC endpoints are FIXED here. v1 accepted `rpc_urls` from wasm_args,
//     which let whoever submits a task pick the RPC the oracle trusts.
//   - Two independent RPCs must answer and agree on the chain head (within
//     MAX_BLOCK_SKEW). An address counts as listed if EITHER says so, and the
//     list age is the larger of the two. One lying or lagging node can no
//     longer clear a sanctioned wallet or hide a stale list.
//   - Never throws, including on `null` or garbage wasm_args.
//
// Built by `newton-cli policy build`, which disables WASI stdio/random/clocks/
// http. So: no global fetch, no Date.now. HTTP goes through the Newton host
// import, and "now" is the timestamp of the mainnet block read.
//
// Any failure returns { ok: false, error } and the policy fails closed on
// `screening_unavailable`.

import { fetch as httpFetch } from "newton:provider/http@0.2.0";

const CONTRACT = "0x574ad490fe8087b580db227a8ca7efb7c19dc8c4";
const SEL_ARE_SANCTIONED = "74f3176a"; // areSanctioned(address[])
const SEL_LAST_UPDATE = "10d365e9"; // getLastUpdateBlockTimestamp()

// Public, keyless mainnet endpoints from independent providers. Fixed on
// purpose: the submitter must not be able to choose them.
const RPCS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
  "https://eth.drpc.org",
  "https://1rpc.io/eth",
];
const NEEDED = 2;
const MAX_BLOCK_SKEW = 64; // ~13 minutes of mainnet blocks

const isAddress = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
const word = (hexNoPrefix) => hexNoPrefix.padStart(64, "0");
const toHexQty = (n) => "0x" + n.toString(16);

function rpc(url, method, params) {
  let res;
  try {
    res = httpFetch({
      url,
      method: "POST",
      headers: [["content-type", "application/json"]],
      body: new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })),
    });
  } catch (e) {
    throw new Error(`http: ${e && e.payload ? e.payload : String(e)}`);
  }
  // Depending on the bindings, a WIT result arrives unwrapped or as {tag, val}.
  if (res && res.tag === "err") throw new Error(`http: ${res.val}`);
  if (res && res.tag === "ok") res = res.val;
  if (!res || res.status !== 200) throw new Error(`rpc status ${res ? res.status : "none"}`);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(res.body)));
  if (json.error) throw new Error(`rpc error: ${json.error.message || JSON.stringify(json.error)}`);
  return json.result;
}

function screen(url, addrs) {
  // 1. Pin a block and take its timestamp as "now".
  const block = rpc(url, "eth_getBlockByNumber", ["latest", false]);
  const blockNumber = parseInt(block.number, 16);
  const chainTime = parseInt(block.timestamp, 16);
  if (!Number.isFinite(blockNumber) || !Number.isFinite(chainTime)) throw new Error("bad block");
  const at = toHexQty(blockNumber);

  // 2. areSanctioned(address[]) at that block.
  let data = "0x" + SEL_ARE_SANCTIONED + word("20") + word(addrs.length.toString(16));
  for (const a of addrs) data += word(a.slice(2).toLowerCase());
  const out = String(rpc(url, "eth_call", [{ to: CONTRACT, data }, at])).slice(2);
  if (out.slice(0, 64) !== word("20")) throw new Error("unexpected return offset");
  const n = parseInt(out.slice(64, 128), 16);
  if (n !== addrs.length || out.length !== 128 + n * 64) throw new Error("unexpected return length");
  const flags = [];
  for (let i = 0; i < n; i++) {
    const v = out.slice(128 + i * 64, 192 + i * 64);
    if (/^0{64}$/.test(v)) flags.push(false);
    else if (/^0{63}1$/.test(v)) flags.push(true);
    else throw new Error("oracle returned a non-boolean");
  }

  // 3. When the list was last updated, at the same block.
  const lastUpdate = parseInt(rpc(url, "eth_call", [{ to: CONTRACT, data: "0x" + SEL_LAST_UPDATE }, at]), 16);
  if (!Number.isFinite(lastUpdate) || lastUpdate <= 0) throw new Error("oracle reports no update timestamp");

  return { blockNumber, chainTime, lastUpdate, flags };
}

function fail(error, details) {
  return JSON.stringify(details ? { ok: false, error, details } : { ok: false, error });
}

export function run(wasm_args) {
  let args;
  try {
    args = JSON.parse(wasm_args || "{}");
  } catch {
    return fail("wasm_args is not JSON");
  }
  if (!args || typeof args !== "object") return fail("wasm_args is not an object");

  const to = args.to;
  const from = args.from;
  if (!isAddress(to)) return fail("wasm_args.to is not an address");
  if (from !== undefined && !isAddress(from)) return fail("wasm_args.from is not an address");
  const addrs = from !== undefined ? [to, from] : [to];

  const answers = [];
  const errors = [];
  for (const url of RPCS) {
    if (answers.length >= NEEDED) break;
    try {
      answers.push(screen(url, addrs));
    } catch (e) {
      errors.push(`${url}: ${e && e.message ? e.message : String(e)}`);
    }
  }
  if (answers.length < NEEDED) return fail(`fewer than ${NEEDED} RPCs answered`, errors);

  const blocks = answers.map((a) => a.blockNumber);
  if (Math.max(...blocks) - Math.min(...blocks) > MAX_BLOCK_SKEW) {
    return fail("RPCs disagree on the chain head", blocks.map(String));
  }

  // Listed if ANY source says listed; age is the OLDEST view of the list.
  const flags = addrs.map((_, i) => answers.some((a) => a.flags[i] === true));
  const ages = answers.map((a) => Math.max(0, a.chainTime - a.lastUpdate));
  const head = answers.reduce((m, a) => (a.blockNumber > m.blockNumber ? a : m));

  return JSON.stringify({
    ok: true,
    version: 2,
    source: "redstone-sanctions-oracle",
    contract: CONTRACT,
    chain: "ethereum-mainnet",
    sources: answers.length,
    block: head.blockNumber,
    list_updated_at: Math.min(...answers.map((a) => a.lastUpdate)),
    chain_time: head.chainTime,
    list_age_seconds: Math.max(...ages),
    to: { address: to, sanctioned: flags[0] },
    from: from !== undefined ? { address: from, sanctioned: flags[1] } : null,
  });
}
