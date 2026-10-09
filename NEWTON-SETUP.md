# Newton policy setup — a placeholder runbook

> **Historical (pre-0.7).** Written for protocol 0.5: one policy per client,
> `setPolicyAddress` / `setPolicy`, a single `wasm_args` string and a bytes32
> verdict. Protocol 0.7 uses policy sets (`setPolicies`), a `wasm_args` array
> (one entry per policy) and a boolean `allowed`. For the current setup see
> `README.md`, `policy/redstone/README.md` and `AUDIT.md`.

How to stand up a Newton Protocol policy end to end: write the Rego, deploy it,
bind a PolicyClient, load params, wire an app, and verify a real quorum-signed
task. Every account- or deployment-specific value is a `<PLACEHOLDER>` — fill
them in from your own dashboard and chain.

Written for **Sepolia testnet**. Adjust chain IDs and the gateway URL for other
networks.

---

## Placeholders

Fill these in once and reuse them throughout.

| Placeholder | What it is | Where it comes from |
| --- | --- | --- |
| `<API_KEY>` | Newton gateway API key (`gw_…`) | dashboard.newton.xyz → API Keys |
| `<ACCOUNT_WALLET>` | The wallet behind `<API_KEY>` | shown with the key; it's the on-chain identity the gateway acts as |
| `<OWNER_KEY>` | Private key of `<ACCOUNT_WALLET>` | your key store — **never commit it** |
| `<POLICY_CLIENT>` | PolicyClient contract (tasks submit here) | created in "Create + bind", below |
| `<POLICY_ADDRESS>` | Policy contract (holds the Rego + code hash) | output of `newton-cli policy deploy` |
| `<POLICY_CID>` | IPFS CID of the deployed Rego bundle | output of `newton-cli policy deploy` |
| `<POLICY_ID>` | keccak of policy address + params | returned by `setPolicy` |
| `<ENTRYPOINT>` | Rego package + rule, e.g. `newton_x.allow` | you choose it in the Rego |
| `<GATEWAY_URL>` | Newton gateway RPC | e.g. `https://gateway.testnet.newton.xyz/rpc` |
| `<RPC_URL>` | Sepolia RPC (prefer a dedicated one) | Alchemy / Infura; public endpoints are flaky |
| `<APP_URL>` | Where your app is hosted | your Vercel/host URL |

**The single rule that governs everything:** the gateway only signs tasks for a
PolicyClient whose **on-chain owner equals `<ACCOUNT_WALLET>`** (the account
behind `<API_KEY>`). Key and client must be under the same account, or every
submission returns `401`.

---

## The mental model

Three contracts, one flow:

- **Policy** (`<POLICY_ADDRESS>`) — immutable. Commits the Rego bundle's CID and
  a code hash. Operators fetch the Rego by CID and check the hash before
  running it.
- **PolicyClient** (`<POLICY_CLIENT>`) — owned by `<ACCOUNT_WALLET>`. Points at
  one Policy, and holds the **params** (the data your Rego reads). Tasks are
  submitted against the client.
- **PolicyData** — optional. A WASM oracle the Rego can call at evaluation time
  (for live lookups). Omit it for a params-only policy.

A task submits an *intent* (from/to/value). Operators evaluate the bound Policy
against the client's params, reach quorum, and return a signed
`evaluation_result` — a byte array where a trailing `1` means **allow** and all
zeros means **deny**.

Two policy shapes:

- **Params-only** — the Rego reads `data.params.*` (e.g. a denylist you set via
  `setPolicy`). No oracle, no fetch at evaluation time. Simplest and most
  robust.
- **Oracle-backed** — the Rego reads `data.wasm.*` (or `data.data.*`) from a
  PolicyData WASM component that calls out to a service. More power, more moving
  parts.

---

## 1. Write the Rego (fail-closed)

Newton runs a **Regorus** fork — an OPA *subset*. Write defensively.

```rego
package <PACKAGE>            # e.g. newton_x  ->  <ENTRYPOINT> = newton_x.allow

default allow := false

# Positive assertions, each paired with a negated deny, so anything UNDEFINED
# (missing field, unreachable oracle) fires a deny instead of silently passing.
# Undefined must never read as "clean".

denylist contains lower(a) if {
    some a in data.params.sanctioned_addresses
}

deny contains "payee_on_list" if denylist[lower(input.to)]

# Fail closed on an empty/missing list: no params must NOT mean "allow all".
deny contains "not_configured" if count(denylist) == 0

allow if count(deny) == 0
```

Hard-won Regorus rules:

- **`lower(null)` is a fatal error, not undefined.** It aborts the whole
  evaluation, so a fail-closed rule that was meant to catch a null becomes
  unreachable. Guard with `is_string(x)` before `lower(x)`.
- **Avoid `else` on a complete rule.** Use `default` + a single override
  instead. A policy that fails to *parse* denies everything, which looks
  identical to it working.
- **Invert confidence gates.** Write "too weak" as the positive and `not` it, so
  a confirmed hit with a *missing* score denies rather than being allowed with
  an empty deny set.
- **Only declare WIT imports you use.** For a WASM oracle, a component must
  satisfy *every* declared import at instantiation even if it never calls it —
  an unused `tlsn`/`secrets` import breaks every task the day the runtime stops
  serving it.
- **Test on Regorus specifically:** `newton-cli policy simulate`. OPA and
  rego-cpp are more permissive, so a green test there proves nothing about what
  operators run.

---

## 2. Deploy the Policy

`newton-cli policy deploy` reads a **directory** (the Rego, params schema,
metadata, and `policy.wasm` together — that directory *is* the policy) and pins
the bundle.

```bash
newton-cli policy deploy \
  --directory <POLICY_DIR> \
  --entrypoint <ENTRYPOINT>
# -> prints <POLICY_ADDRESS>, <POLICY_CID>, code hash
```

**Ingestion is the thing that bites.** Operators fetch the Rego from a
"persisted immutable data backend." A CID only works if it has been **ingested**
there.

- Deploy through the **Newton IPFS proxy** (the CLI's default). Do **not** set
  `PINATA_JWT`/`PINATA_GATEWAY` — that diverts uploads to direct Pinata, which
  never ingests. Unset them to use the proxy.
- **Any change to the Rego is a new CID**, which may not ingest. If a known-good
  CID already ingested, treat that Rego as **frozen** and change behavior
  through **params**, not code (see §7).
- Symptom of a non-ingested policy:
  `object <CID> not found in persisted immutable data backend`. Submission
  succeeds; evaluation fails.

---

## 3. Create + bind the PolicyClient

The client must be **owned by `<ACCOUNT_WALLET>`** and **bound** to
`<POLICY_ADDRESS>`.

`initialize()` (eight args, in order) commits the binding on a fresh client:
`_factory, _entrypoint, _policyCid, _schemaCid, _policyData[], _metadataCid,
_owner, _policyCodeHash`. Set `_owner = <ACCOUNT_WALLET>`.

To bind an **existing** client to a (different) policy, call `setPolicyAddress`
— this is a **rebind**, one transaction, signed by the owner:

```bash
set -a; source <ENV_WITH_OWNER_KEY> ; set +a   # exports <OWNER_KEY>
POLICY_CLIENT=<POLICY_CLIENT> node policy/bind.mjs <POLICY_ADDRESS>            # dry run
POLICY_CLIENT=<POLICY_CLIENT> node policy/bind.mjs <POLICY_ADDRESS> --confirm  # send
```

The dry run confirms `signer == client owner` and simulates the call. If those
don't match, the gateway will 401 no matter what else is right.

---

## 4. Set the params

`setPolicy(policyParams, expireAfter)` on the client writes the data your Rego
reads (`data.params.*`) and yields `<POLICY_ID>`. This is a **separate** call
after binding; a fresh policy has no config until it runs.

```bash
node policy/setparams.mjs            # dry run: prints current -> next diff
node policy/setparams.mjs --confirm  # send
```

Notes:

- **Gas:** a large params blob is a large storage write. Writing ~5 KB can cost
  ~0.01+ ETH on Sepolia — keep the signer funded.
- **Skip-if-unchanged:** a good script reads the current params and skips the tx
  when nothing changed. This needs a reliable `<RPC_URL>`; a flaky public RPC
  that can't read current state can make it re-send an identical (reverting)
  write.
- **Always re-test a clean case afterward.** A failed params write can leave the
  list empty → `not_configured` fires → everything denies, which is
  indistinguishable from screening working.

---

## 5. Wire the app

Server reads these; the app submits with `Authorization: Bearer <API_KEY>`.

```
NEWTON_API_KEY=<API_KEY>                 # account must OWN <POLICY_CLIENT>
NEWTON_GATEWAY_URL=<GATEWAY_URL>         # optional; sensible default
POLICY_CLIENT_DENYLIST=<POLICY_CLIENT>   # the client tasks submit against
NEXT_PUBLIC_POLICY_CLIENT=<POLICY_CLIENT># same, for display (baked at build time)
SEPOLIA_RPC_URL=<RPC_URL>                # optional; prefer a dedicated endpoint
```

Setting env vars on the host (e.g. Vercel):

```bash
printf %s '<VALUE>' | npx vercel env add <NAME> production
npx vercel --prod          # NEXT_PUBLIC_* only take effect on a rebuild
```

Gotchas:

- `NEXT_PUBLIC_*` are **baked at build time** — set them *before* the build.
- Env changes need a **redeploy** to take effect; setting them alone does
  nothing to the running deployment.
- If a project already has stale vars, `rm` them first — a paste may refuse to
  overwrite existing keys and silently keep the old values.

---

## 6. Verify with a real task

Submit one known-sanctioned and one known-clean address:

```bash
curl -sS -X POST <APP_URL>/api/evaluate \
  -H 'content-type: application/json' \
  -d '{"mode":"submit","providerId":"local-denylist","to":"<SANCTIONED_ADDR>"}'

curl -sS -X POST <APP_URL>/api/evaluate \
  -H 'content-type: application/json' \
  -d '{"mode":"submit","providerId":"local-denylist","to":"<CLEAN_ADDR>"}'
```

Read `result.status` and `result.task_response.evaluation_result`:

- `status: "success"`, all-zeros → **denied** (expected for the sanctioned one)
- `status: "success"`, trailing `1` → **allowed** (expected for the clean one)
- `error: "Gateway returned 401"` → key/ownership mismatch (§8)
- `error: "… not found in persisted immutable data backend"` → policy CID not
  ingested (§2)

A `signers_count ≥ quorum` and a `bls_aggregation_result` mean it was really
quorum-signed, not simulated.

---

## 7. Updating the list (params-only, no redeploy)

Because the Rego reads `data.params.sanctioned_addresses`, change the list
through `setPolicy` params — **never edit the frozen Rego**:

```bash
# regenerate the list from your source, then:
node policy/setparams.mjs --confirm
```

CID unchanged → still ingested → no ingestion risk. This is the whole reason to
keep the address list in params rather than baked into the Rego.

---

## 8. Troubleshooting: the two failures you'll actually hit

**`401` from the gateway.** Authentication/authorization. In order:

1. Is `<API_KEY>` valid? Test it straight against the gateway — a `422`
   "invalid body" means the key *authenticated* (good); a `401` means the key
   is dead/revoked.
   ```bash
   curl -sS -i -X POST <GATEWAY_URL> \
     -H "authorization: Bearer <API_KEY>" \
     -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"newt_health","params":[]}'
   ```
2. Is the running deployment actually using the current key? (A mangled deploy
   can leave a stale one live.)
3. Does `<ACCOUNT_WALLET>` **own `<POLICY_CLIENT>`** on-chain? If the client was
   re-owned or repurposed, the valid key still can't submit to it.

**`… not found in persisted immutable data backend`.** The policy code isn't on
the operator backend. The client is bound to a policy whose CID never ingested
(a fresh deploy, or a client someone rebound onto a different policy). Fix by
**rebinding to a policy whose CID is ingested** (§3) — not by redeploying, which
mints a new, possibly un-ingestable CID.

---

## 9. Recovery: rebind, don't redeploy

If a working client gets pointed at the wrong policy (e.g. another project
rebinds a shared client), **do not deploy a new policy**. Instead:

1. Find a policy whose CID is already ingested (your last known-good one — it's
   still on-chain even if it's gone from the dashboard).
2. Rebind a client **you own** to it (`setPolicyAddress`, §3).
3. Re-`setPolicy` the params (§4) — a rebind leaves params empty.
4. Point the app's `POLICY_CLIENT_*` at that client and redeploy (§5).
5. Verify (§6).

Prefer a client you **solely control** over any shared one, so it can't be
repurposed out from under you again.

---

## Checklist

- [ ] `<API_KEY>` active, and `<ACCOUNT_WALLET>` owns `<POLICY_CLIENT>`
- [ ] Rego deployed via the **proxy**; `<POLICY_CID>` ingested
- [ ] Client bound to `<POLICY_ADDRESS>` (dry run shows signer == owner)
- [ ] Params set; clean address **allowed**, sanctioned **denied**
- [ ] App env points at `<POLICY_CLIENT>`; redeployed after any change
- [ ] Signer wallet funded for the next params write
