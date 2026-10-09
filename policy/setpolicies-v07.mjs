/**
 * v0.7: write the denylist into a SanctionsDemoClient via setPolicies([spec]).
 *
 *   node policy/setpolicies-v07.mjs            # dry run (simulates)
 *   node policy/setpolicies-v07.mjs --confirm  # sends
 *
 * Client: POLICY_CLIENT_DENYLIST (process env wins over .env.local).
 * Policy: V7_POLICY or the v0.7 denylist policy below.
 * Signer: OWNER_PRIVATE_KEY (set -a; source ../deploy/.env; set +a).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, toHex } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
function env(file = join(ROOT, ".env.local")) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const E = { ...env(), ...process.env };
const CLIENT = E.POLICY_CLIENT_DENYLIST;
const POLICY = E.V7_POLICY || "0x95c66b29DB62136094DC95e40C33cc524cFe4ba1";
const EXPIRE_AFTER = Number(E.EXPIRE_AFTER || 300);
const KEY = E.OWNER_PRIVATE_KEY;
if (!CLIENT || !KEY) {
  console.error("Need POLICY_CLIENT_DENYLIST and OWNER_PRIVATE_KEY.");
  process.exit(1);
}

const grab = (f) =>
  existsSync(join(ROOT, f))
    ? [...readFileSync(join(ROOT, f), "utf8").matchAll(/"(0x[0-9a-fA-F]{40})"/g)].map((m) => m[1])
    : [];
const seen = new Set();
const addresses = [];
for (const a of [...grab("lib/sanctioned-pool.ts"), ...grab("lib/ofac-addresses.ts"), ...grab("lib/ofac-full.ts")]) {
  if (!seen.has(a.toLowerCase())) (seen.add(a.toLowerCase()), addresses.push(a));
}
if (!addresses.length) {
  console.error("No addresses found — refusing to write an empty denylist.");
  process.exit(1);
}
const policyParams = toHex(new TextEncoder().encode(JSON.stringify({ sanctioned_addresses: addresses })));

const SPEC = {
  type: "tuple[]",
  components: [
    { name: "policy", type: "address" },
    { name: "config", type: "tuple", components: [{ name: "policyParams", type: "bytes" }, { name: "expireAfter", type: "uint32" }] },
  ],
};
const ABI = [
  { type: "function", name: "setPolicies", stateMutability: "nonpayable", inputs: [{ name: "policies", ...SPEC }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "getPolicySetSnapshot", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }, { type: "uint64" }, { ...SPEC, name: "policies" }] },
  { type: "function", name: "getOwner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "supportsInterface", stateMutability: "view", inputs: [{ type: "bytes4" }], outputs: [{ type: "bool" }] },
  { type: "error", name: "OnlyPolicyClientOwner", inputs: [] },
  { type: "error", name: "EmptyPolicySet", inputs: [] },
  { type: "error", name: "ZeroExpireAfter", inputs: [{ type: "uint256" }] },
  { type: "error", name: "InterfaceNotSupported", inputs: [] },
  { type: "error", name: "OnlyPolicyClient", inputs: [] },
];

const rpc = E.SEPOLIA_RPC_URL || E.RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const account = privateKeyToAccount(KEY.startsWith("0x") ? KEY : `0x${KEY}`);
const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });

const [owner, v7] = await Promise.all([
  pub.readContract({ address: CLIENT, abi: ABI, functionName: "getOwner" }),
  pub.readContract({ address: CLIENT, abi: ABI, functionName: "supportsInterface", args: ["0xf67e14d6"] }),
]);
console.log(`client       ${CLIENT}\nv0.7 iface   ${v7}\nowner        ${owner}\nsigner       ${account.address}`);
console.log(`policy       ${POLICY}\naddresses    ${addresses.length}  (${(policyParams.length - 2) / 2} bytes)\nexpireAfter  ${EXPIRE_AFTER}`);
if (owner.toLowerCase() !== account.address.toLowerCase()) {
  console.error("Signer is not the client owner.");
  process.exit(1);
}

const args = [[{ policy: POLICY, config: { policyParams, expireAfter: EXPIRE_AFTER } }]];
try {
  await pub.simulateContract({ account, address: CLIENT, abi: ABI, functionName: "setPolicies", args });
  console.log("simulation   ok");
} catch (e) {
  console.error("simulation   REVERTS:", e.shortMessage || e.message);
  process.exit(1);
}
if (!process.argv.includes("--confirm")) {
  console.log("\nDRY RUN. Re-run with --confirm.");
  process.exit(0);
}
// viem reserves gas × (2 × baseFee + tip) up front, which can exceed a thin
// testnet balance even when the real cost fits. Cap maxFeePerGas at what the
// balance covers, as long as that still clears the current base fee.
const gas = ((await pub.estimateContractGas({ account, address: CLIENT, abi: ABI, functionName: "setPolicies", args })) * 110n) / 100n;
const [block, balance, fees] = await Promise.all([pub.getBlock(), pub.getBalance({ address: account.address }), pub.estimateFeesPerGas()]);
const affordable = (balance * 97n) / 100n / gas;
const maxFeePerGas = fees.maxFeePerGas < affordable ? fees.maxFeePerGas : affordable;
const maxPriorityFeePerGas = fees.maxPriorityFeePerGas < maxFeePerGas - block.baseFeePerGas ? fees.maxPriorityFeePerGas : 1n;
console.log(`gas          ${gas}  baseFee ${Number(block.baseFeePerGas) / 1e9} gwei  maxFee ${Number(maxFeePerGas) / 1e9} gwei`);
if (maxFeePerGas <= block.baseFeePerGas) {
  console.error(`Balance can't cover even the current base fee. Need ~${Number(gas * block.baseFeePerGas * 12n / 10n) / 1e18} ETH; have ${Number(balance) / 1e18}. Faucet or wait for lower gas.`);
  process.exit(1);
}
const hash = await wallet.writeContract({ address: CLIENT, abi: ABI, functionName: "setPolicies", args, gas, maxFeePerGas, maxPriorityFeePerGas });
console.log(`tx           https://sepolia.etherscan.io/tx/${hash}`);
const r = await pub.waitForTransactionReceipt({ hash });
console.log(`status       ${r.status}`);
const [policyId, revision, policies] = await pub.readContract({ address: CLIENT, abi: ABI, functionName: "getPolicySetSnapshot" });
console.log(`policyId     ${policyId}\nrevision     ${revision}\npolicies     ${policies.length}`);
