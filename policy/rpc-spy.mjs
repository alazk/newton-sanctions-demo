/**
 * Logging JSON-RPC proxy. Forwards everything to a real Sepolia RPC and prints
 * every eth_call (to, 4-byte selector, calldata, result). Used to see which
 * functions newton-cli 0.7 reads from a PolicyClient ("policy set").
 *
 *   node policy/rpc-spy.mjs            # listens on 127.0.0.1:8545
 *   RPC_URL=http://127.0.0.1:8545 newton-cli ...   (in a second terminal)
 *
 * Read-only: it relays requests, it never signs anything.
 */
import http from "node:http";

const UPSTREAM = process.env.UPSTREAM || "https://ethereum-sepolia-rpc.publicnode.com";
const PORT = Number(process.env.PORT || 8545);

function show(req, res) {
  if (req.method === "eth_call") {
    const { to, data = "", input = "" } = req.params?.[0] ?? {};
    const cd = data || input;
    const out = res?.error ? `REVERT ${JSON.stringify(res.error).slice(0, 200)}` : String(res?.result).slice(0, 200);
    console.log(`eth_call ${to} ${cd.slice(0, 10)}  args=${cd.slice(10, 10 + 128)}${cd.length > 138 ? "…" : ""}\n   -> ${out}`);
  } else {
    console.log(req.method);
  }
}

http
  .createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const up = await fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body });
    const text = await up.text();
    try {
      const q = JSON.parse(body);
      const r = JSON.parse(text);
      if (Array.isArray(q)) q.forEach((x) => show(x, (Array.isArray(r) ? r : []).find((y) => y.id === x.id)));
      else show(q, r);
    } catch {}
    res.writeHead(up.status, { "content-type": "application/json" });
    res.end(text);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`rpc-spy on http://127.0.0.1:${PORT} -> ${UPSTREAM}`));
