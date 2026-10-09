/**
 * Server-side reads of the RedStone Sanctions Oracle — the same contract the
 * operators' WASM oracle (policy/redstone/policy.js) reads during evaluation.
 *
 * Ethereum mainnet, 0x574Ad490fE8087B580DB227a8Ca7EfB7C19Dc8C4: 463 official
 * lists aggregated by OpenSanctions (OFAC, EU, UN, UK and others), updated
 * weekly, with the time of the last update readable onchain.
 *
 * Used only to EXPLAIN a verdict on the page (which party is listed, how fresh
 * the list is). The signed attestation is the verdict; this is not.
 */
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

export const REDSTONE_SANCTIONS = "0x574Ad490fE8087B580DB227a8Ca7EfB7C19Dc8C4" as const;

/** Same limit as the deployed policy's max_list_age_seconds (8 days). */
export const MAX_LIST_AGE_SECONDS = 691_200;

const ABI = [
  {
    type: "function",
    name: "areSanctioned",
    stateMutability: "view",
    inputs: [{ name: "addrs", type: "address[]" }],
    outputs: [{ type: "bool[]" }],
  },
  {
    type: "function",
    name: "getLastUpdateBlockTimestamp",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

const client = createPublicClient({
  chain: mainnet,
  transport: http(process.env.MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com", { timeout: 10_000 }),
});

/** List age, pinned to one block so "now" and "last update" agree. */
export async function redstoneFreshness() {
  const block = await client.getBlock();
  const last = await client.readContract({
    address: REDSTONE_SANCTIONS,
    abi: ABI,
    functionName: "getLastUpdateBlockTimestamp",
    blockNumber: block.number,
  });
  const ageSeconds = Math.max(0, Number(block.timestamp) - Number(last));
  return {
    blockNumber: block.number,
    lastUpdate: Number(last),
    ageSeconds,
    stale: ageSeconds > MAX_LIST_AGE_SECONDS,
  };
}

export async function redstoneScreen(addresses: `0x${string}`[]) {
  const block = await client.getBlock();
  const [flags, last] = await Promise.all([
    client.readContract({
      address: REDSTONE_SANCTIONS,
      abi: ABI,
      functionName: "areSanctioned",
      args: [addresses],
      blockNumber: block.number,
    }),
    client.readContract({
      address: REDSTONE_SANCTIONS,
      abi: ABI,
      functionName: "getLastUpdateBlockTimestamp",
      blockNumber: block.number,
    }),
  ]);
  const ageSeconds = Math.max(0, Number(block.timestamp) - Number(last));
  return { flags, ageSeconds, stale: ageSeconds > MAX_LIST_AGE_SECONDS };
}
