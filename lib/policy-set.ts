/**
 * Protocol 0.7 wasm_args, derived from the chain rather than assumed.
 *
 * newt_createTask wants one wasm_args entry per policy in the client's set,
 * and the gateway is strict both ways: an entry for a WASM policy must carry
 * the oracle's arguments, and an entry for a pure-Rego policy MUST be "0x"
 * ("wasm_args[0] must be empty for pure-Rego policy …"). Hardcoding either
 * shape breaks the page the moment the client's set changes — which is
 * exactly what happened mid-rollout on Oct 9 2026.
 *
 * So: read the set (getPolicies), check each policy's wasmCid, and build the
 * array to match. Cached briefly; a set change shows up within a minute.
 */
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

const CLIENT_ABI = [
  {
    type: "function",
    name: "getPolicies",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "policy", type: "address" },
          {
            name: "config",
            type: "tuple",
            components: [
              { name: "policyParams", type: "bytes" },
              { name: "expireAfter", type: "uint32" },
            ],
          },
        ],
      },
    ],
  },
] as const;

const POLICY_ABI = [
  { type: "function", name: "getWasmCid", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "wasmCid", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

const chain = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", { timeout: 8_000 }),
});

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; usesWasm: boolean[] }>();

async function usesWasm(policy: `0x${string}`): Promise<boolean> {
  for (const functionName of ["getWasmCid", "wasmCid"] as const) {
    try {
      const cid = await chain.readContract({ address: policy, abi: POLICY_ABI, functionName });
      return typeof cid === "string" && cid.length > 0;
    } catch {
      /* try the other spelling */
    }
  }
  // Unknown: assume it needs args. A pure-Rego policy rejects them loudly,
  // which is a visible error rather than a silent wrong verdict.
  return true;
}

/**
 * The wasm_args array for this client: `args` for every WASM policy, "0x" for
 * every pure-Rego one. Returns null if the set can't be read; the caller then
 * falls back to a single entry.
 */
export async function wasmArgsFor(client: string, args: string): Promise<string[] | null> {
  const key = client.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.usesWasm.map((w) => (w ? args : "0x"));

  try {
    const set = await chain.readContract({
      address: client as `0x${string}`,
      abi: CLIENT_ABI,
      functionName: "getPolicies",
    });
    const flags = await Promise.all(set.map((s) => usesWasm(s.policy)));
    cache.set(key, { at: Date.now(), usesWasm: flags });
    return flags.map((w) => (w ? args : "0x"));
  } catch {
    return null;
  }
}
