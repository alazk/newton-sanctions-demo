// RedStone Sanctions Oracle → Newton data oracle.
//
// Reads RedStone's onchain sanctions list on Ethereum mainnet
// (0x574Ad490fE8087B580DB227a8Ca7EfB7C19Dc8C4: 463 official lists via
// OpenSanctions, updated weekly, timestamped) and returns, for the payee and
// payer of the intent, whether each is listed — plus how old the list is, so
// the Rego can refuse to screen against a stale one.
//
// Built by `newton-cli policy build`, which disables WASI stdio/random/clocks/
// http. So: no global fetch, no Date.now — HTTP goes through the Newton host
// import, and "now" is the timestamp of the mainnet block we read at.
//
// Every read is pinned to ONE block number, so the list and its timestamp
// always describe the same state.
//
// Never throws. Any failure returns { ok: false, error } and the policy fails
// closed on `screening_unavailable`.

import { fetch as httpFetch } from "newton:provider/http@0.2.0";

const CONTRACT = "0x574ad490fe8087b580db227a8ca7efb7c19dc8c4";
const SEL_ARE_SANCTIONED = "74f3176a"; // areSanctioned(address[])
const SEL_LAST_UPDATE = "10d365e9"; // getLastUpdateBlockTimestamp()

// Public, keyless mainnet endpoints, tried in order.
const DEFAULT_RPCS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
  "https://cloudflare-eth.com",
];

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
  const at = toHexQty(blockNumber);

  // 2. areSanctioned(address[]) at that block.
  let data = "0x" + SEL_ARE_SANCTIONED + word("20") + word(addrs.length.toString(16));
  for (const a of addrs) data += word(a.slice(2).toLowerCase());
  const out = rpc(url, "eth_call", [{ to: CONTRACT, data }, at]).slice(2);
  const n = parseInt(out.slice(64, 128), 16);
  if (n !== addrs.length) throw new Error(`oracle returned ${n} results for ${addrs.length} addresses`);
  const flags = [];
  for (let i = 0; i < n; i++) {
    const v = out.slice(128 + i * 64, 192 + i * 64);
    if (/^0{64}$/.test(v)) flags.push(false);
    else if (/^0{63}1$/.test(v)) flags.push(true);
    else throw new Error("oracle returned a non-boolean");
  }

  // 3. When the list was last updated, at the same block.
  const lastUpdate = parseInt(rpc(url, "eth_call", [{ to: CONTRACT, data: "0x" + SEL_LAST_UPDATE }, at]), 16);
  if (!lastUpdate) throw new Error("oracle reports no update timestamp");

  return { blockNumber, chainTime, lastUpdate, flags };
}

export function run(wasm_args) {
  let args;
  try {
    args = JSON.parse(wasm_args || "{}");
  } catch {
    return JSON.stringify({ ok: false, error: "wasm_args is not JSON" });
  }

  const to = args.to;
  const from = args.from;
  if (!isAddress(to)) return JSON.stringify({ ok: false, error: "wasm_args.to is not an address" });
  const addrs = isAddress(from) ? [to, from] : [to];

  const rpcs = Array.isArray(args.rpc_urls) && args.rpc_urls.length ? args.rpc_urls : DEFAULT_RPCS;
  const errors = [];
  for (const url of rpcs) {
    try {
      const r = screen(url, addrs);
      return JSON.stringify({
        ok: true,
        source: "redstone-sanctions-oracle",
        contract: CONTRACT,
        chain: "ethereum-mainnet",
        block: r.blockNumber,
        list_updated_at: r.lastUpdate,
        chain_time: r.chainTime,
        list_age_seconds: Math.max(0, r.chainTime - r.lastUpdate),
        to: { address: to, sanctioned: r.flags[0] },
        from: addrs.length > 1 ? { address: from, sanctioned: r.flags[1] } : null,
      });
    } catch (e) {
      errors.push(`${url}: ${e && e.message ? e.message : String(e)}`);
    }
  }
  return JSON.stringify({ ok: false, error: "every RPC failed", details: errors });
}
