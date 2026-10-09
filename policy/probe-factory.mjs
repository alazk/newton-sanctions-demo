/**
 * Read-only probe: which Newton policy factory can we actually use on Sepolia?
 *
 *   node policy/probe-factory.mjs
 *
 * Signs nothing. For each candidate factory it reads version(), then simulates
 * computePolicyAddress with the denylist args from deploy/policy_cids.json and
 * decodes the revert reason if it fails. Also prints the TaskManager's
 * minCompatiblePolicyVersion so we know what "new enough" means.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, decodeErrorResult } from "viem";
import { sepolia } from "viem/chains";

const HERE = dirname(fileURLToPath(import.meta.url));
const cids = JSON.parse(readFileSync(join(HERE, "../../deploy/policy_cids.json"), "utf8"));

const RPC = process.env.RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const TASK_MANAGER = "0xecb741f4875770f9a5f060cb30f6c9eb5966ed13";
const OWNER = "0x8b4bA8708239757e84aD26a503500Bc5fC1c1a48";

const CANDIDATES = {
  "0xe37952d9 (docs table)": "0xe37952d9003d399579670e97b4c67b175112d0cd",
  "0xdfd5ac2D (made Lazarus)": "0xdfd5ac2D40fA29985995a2f358f53e64CDFF3B62",
  "0x8dd5984f (Sept 24, CLI bundle)": "0x8dd5984f8f626a2fd1c61872217d1f8269a831da",
};

const ARGS_T = [
  { name: "_entrypoint", type: "string" },
  { name: "_policyCid", type: "string" },
  { name: "_schemaCid", type: "string" },
  { name: "_policyData", type: "address[]" },
  { name: "_metadataCid", type: "string" },
  { name: "_owner", type: "address" },
  { name: "_policyCodeHash", type: "bytes32" },
];

const ABI = [
  { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "computePolicyAddress", stateMutability: "view", inputs: ARGS_T, outputs: [{ type: "address" }] },
  { type: "function", name: "minCompatiblePolicyVersion", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "error", name: "AdminAddressZero", inputs: [] },
  { type: "error", name: "ChainNotSupported", inputs: [] },
  { type: "error", name: "InvalidImplementationAddress", inputs: [] },
  { type: "error", name: "InvalidOwnerAddress", inputs: [] },
  { type: "error", name: "InvalidShortString", inputs: [] },
  { type: "error", name: "NotAdminOrOwner", inputs: [] },
  { type: "error", name: "SecretsSchemaWithoutWasm", inputs: [] },
  { type: "error", name: "StringTooLong", inputs: [{ name: "str", type: "string" }] },
];

const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });

const args = [
  cids.entrypoint, cids.policyCid, cids.schemaCid, cids.policyData ?? [],
  cids.metadataCid, OWNER, cids.policyCodeHash,
];

function reason(e) {
  // Walk the viem error chain for raw revert data and decode it against our ABI.
  let cur = e;
  for (let i = 0; cur && i < 8; i++, cur = cur.cause) {
    const data = cur.data?.data ?? cur.data;
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
      try {
        const d = decodeErrorResult({ abi: ABI, data });
        return `${d.errorName}(${(d.args ?? []).join(", ")})`;
      } catch {
        return `undecoded revert ${data.slice(0, 10)} (${data.length} hex chars)`;
      }
    }
  }
  return e.shortMessage || e.message;
}

const min = await pub
  .readContract({ address: TASK_MANAGER, abi: ABI, functionName: "minCompatiblePolicyVersion" })
  .catch((e) => `unreadable (${reason(e)})`);
console.log(`TaskManager minCompatiblePolicyVersion: ${min}\n`);

for (const [label, addr] of Object.entries(CANDIDATES)) {
  const code = await pub.getBytecode({ address: addr });
  if (!code || code === "0x") {
    console.log(`${label}\n  no contract on Sepolia\n`);
    continue;
  }
  const version = await pub
    .readContract({ address: addr, abi: ABI, functionName: "version" })
    .catch((e) => `unreadable (${reason(e)})`);
  const predicted = await pub
    .readContract({ address: addr, abi: ABI, functionName: "computePolicyAddress", args })
    .then((a) => `ok -> ${a}`)
    .catch((e) => `REVERTS: ${reason(e)}`);
  console.log(`${label}\n  version()             ${version}\n  computePolicyAddress  ${predicted}\n`);
}
