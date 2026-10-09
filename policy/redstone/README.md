# redstone

## Overview

<!-- Describe what this policy enforces -->

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
