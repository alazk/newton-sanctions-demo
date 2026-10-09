# Status: Newton Sanctions Demo

_Last updated: 2026-10-09 (audit). Single source of truth for what is running._

## What is live

**https://sanctions-demo.newt.foundation**: enter a recipient; Newton
operators check it against the RedStone Sanctions Oracle (Ethereum mainnet) and
a quorum signs the decision on Sepolia before the transfer would execute.

```
policy client   0x57F4fB0a4A4b34eA51D47BC7c99c960b80A58D18   SanctionsDemoClient (v0.7), owner 0x8b4bA870…
policy          0xd0Ff7aca199AeaCC5F316b029A476Da7684a3877   policy/redstone v1, WASM on the policy
  policyCodeHash 0xa585f4951918a21baec73a1de9862aa6362d48b5bd9c20d172337bf9a385d57d
  policy cid     bafkreifusthd4yqrmco62rwi5y6ovacbvx5xcvxccyd7tm4codq23o5jg4
  wasm cid       bafkreicdyh43c5vv42iunlojjcsaoqvnbzpswqrgk22c2alqjinf55pkbm
params          {"max_list_age_seconds": 691200}  (8 days), expireAfter 300
oracle source   RedStone 0x574Ad490fE8087B580DB227a8Ca7EfB7C19Dc8C4 (Ethereum mainnet)
test client     0x6DeD0ACa06D76FEF4ec8254B8f661edbC387cf2A   same policy, for trials
```

**Pending:** `policy/redstone/` in the repo now holds **v2** (audit fixes:
fixed RPCs, two-source agreement, payer bound to the intent, bounded max age).
It is not deployed yet; `dist/` still describes v1 until it is. Deploy steps
are in `AUDIT.md`.

## Fallback (not live)

```
policy          0x95c66b29DB62136094DC95e40C33cc524cFe4ba1   frozen 119-address denylist, pure Rego
policy cid      bafkreigvmehmguzwvy3wla2q56jk25jpfog3ecuym5v6cquoeocjodhqri
switch          node policy/setpolicies-v07.mjs --confirm   (page copy would then be wrong)
```

## Known gaps

- **Owner key.** Accepted by the owner as not an issue for this testnet demo
  (Oct 2026). Rotate before any non-testnet reuse; see `AUDIT.md`.
- **Rate limits are per instance.** Add a Vercel Firewall rule for real limits.
- **Native transfers only.** ERC-20 recipients are not screened.
- **List names are an unsigned lookup** (OpenSanctions via `YENTE_URL`), shown
  only to explain a verdict.

## Dead weight (kept until someone says delete)

Pre-0.7 or yente-era files no longer on the live path: `policy/setparams.mjs`,
`bind.mjs`, `check.mjs`, `check.sh`, `newton_yente.rego`, `params.json`,
`gate_test.py`, `simargs.mjs`, `test-simulate.mjs`, `watch-yente.sh`,
`probe-factory.mjs`, `rpc-spy.mjs`; `scripts/emit-rego.mjs`,
`verify-history.mjs`; `generated-policy.rego`; `design/`; most providers and
the rule builder in `lib/catalog.ts`. `/api/history` and `/api/policy-source`
now return 410 and can be deleted.

## History

The site ran a frozen OFAC/multi-regime denylist (Aug–Oct 9 2026) after a live
yente oracle was blocked by Newton's backend not ingesting new CIDs
(`policy/NEWTON-ISSUE.md`). The 0.7 upgrade (late Sept) broke every pre-0.7
client; `SanctionsDemoClient` replaced them. Uploading through Newton's gateway
(newton-cli 0.7.2) fixed ingestion, which made the RedStone oracle possible.
