# redstone: RedStone sanctions policy

## Overview

Denies a transfer when the payee or payer is on the RedStone Sanctions Oracle
(Ethereum mainnet `0x574Ad490fE8087B580DB227a8Ca7EfB7C19Dc8C4`), when the oracle
could not screen, or when RedStone's list is older than
`max_list_age_seconds` (default 8 days; only values between 1 hour and 30 days
are honoured).

- `policy.js` (WASM oracle) reads `areSanctioned([to, from])` and
  `getLastUpdateBlockTimestamp()` at one pinned block. **v2:** fixed RPC list
  (not taken from wasm_args), two independent RPCs must answer and agree on the
  chain head within 64 blocks, listed if either says so, age is the older view.
- `policy.rego` binds the screened payee to `input.to` and, if the intent has a
  sender, the screened payer to `input.from`. Native transfers only: for a
  token transfer `input.to` is the token contract.
- wasm_args: `{ "to": "0x…", "from": "0x…" }`, hex-encoded UTF-8 JSON.

Deployed: **v1** is policy `0xd0Ff7aca199AeaCC5F316b029A476Da7684a3877`
(`dist/policy_cids.json` until v2 is deployed). v2 deploy steps: `../../AUDIT.md`.

Fixtures in `configs/`: `wasm_args.json` / `intent.json` (clean),
`*.sanctioned.json` (listed payee), `params.stale.json` (60 s limit, forces
`screening_unavailable`).

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
newton-cli policy build -p ./redstone
```

## Simulate

```bash
# Test full policy (WASM + Rego)
newton-cli policy simulate -p ./redstone

# With custom args
newton-cli policy simulate -p ./redstone --wasm-args ./configs/wasm_args.json --intent-json ./configs/intent.json --policy-params-data ./configs/params.json

# If policy.js calls getSecrets(), use a non-production local fixture
newton-cli policy simulate -p ./redstone --secrets-file /path/outside-the-repo/local-secrets.json
```

`configs/intent.json` uses a hex-encoded UTF-8 `functionSignature` plus
ABI-encoded `data`, matching the gateway `TaskIntent` format. Rego receives the
decoded call as `input.decoded_function_signature` and
`input.decoded_function_arguments`. WASM oracle output is available as
`data.wasm.*` (same namespace as operators and gateway simulate).

`--secrets-file` accepts a plaintext JSON object for this local simulation
only. It is not uploaded or schema-validated. Never commit the file or use
production credentials.

## Deploy

Review the non-secret defaults in `configs/deployment.toml`, then provide
`RPC_URL` and `PRIVATE_KEY` through the process environment. `.env.example`
lists the supported variables; do not commit a populated `.env`.

```bash
newton-cli policy deploy -p ./redstone
```

If the policy uses WASM secrets, keep `secrets_schema.json` at the policy
root. `policy build` copies it into `dist/`, and `policy deploy -p` uploads it
so the policy is deployed with a non-empty `secretsSchemaCid`.

The deploy command automatically reads `configs/deployment.toml`. CLI flags and
environment variables take precedence. Artifact uploads use `API_KEY` and the
Newton gateway selected by `CHAIN_ID`, or `GATEWAY_URL` when overridden.
