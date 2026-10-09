# Audit: Newton Sanctions Demo (Oct 2026)

## 1. Method and deploy state

Three independent reviews (API and verdict logic; policy, oracle, contract and
hosting; claims, docs and freshness) were run against the repo. Every serious
finding was then checked against the code before being fixed. The v2 oracle
was tested offline against mocked RPCs (11 cases: clean, listed payee, listed
payer, a lying RPC, one RPC down, three down, a lagging node, null args, a bad
sender, `rpc_urls` injection). Public GET endpoints were read live. Verdicts,
headers and repo visibility need the live check in section 7, which has to run
from the owner's machine.

**Live before this audit:** client `0x57F4fB0a…`, policy
`0xd0Ff7aca…` (policy/redstone v1), site at sanctions-demo.newt.foundation.

## 2. Claims and freshness

| Claim | Status | Evidence / fix |
| --- | --- | --- |
| Checks are screened against the RedStone Sanctions Oracle on mainnet and signed by a quorum | Verified | policy.js reads `0x574Ad490…`; live tasks Oct 9 (clean allowed, `0x175d…` denied) |
| "463 official lists, updated weekly" | Unverifiable (RedStone's claim) | Now attributed to RedStone in the policy card, intro and OG image |
| Policy screens payee and payer | Verified for v1 payer *flag*; payer was not bound to the intent | Fixed in v2 Rego (`payer_not_screened`) |
| README "the policy does not consult the sender" | False | README rewritten |
| README "How it works": list held in client params | False (that was the fallback) | Rewritten for RedStone |
| STATUS "live is the 119-address denylist" | False | STATUS rewritten |
| `/api/policy-source` "the policy the operators actually run" | False (served the old yente policy) | Route retired (410) |
| Screening step "screened against the list bound to the policy on chain" | Misleading | Now "Operators check RedStone's sanctions list on Ethereum mainnet" |
| Timed ✓ on screening steps 2 and 3 | Overclaim | Only the step we know happened gets ✓; later steps highlight without ✓ |
| Stale banner "a verdict can be confidently wrong" | False under RedStone (policy refuses past 8 days) | Copy now says the policy will refuse until the list updates |
| "The signed result can't be altered" (intro) | Overclaim | Now "Every check links to its signed record on the Newton explorer" |
| "A randomly generated address, which is on no list" | Overclaim | Now "A freshly generated random address with no history" |
| List names ("Listed on OFAC SDN") | Unsigned lookup, not part of the attestation | Labelled "source: OpenSanctions" (owner's choice of wording); README and the route docs state it is unsigned |
| Picker "real sanctioned wallet" | Verified Oct 9 (all 24 pool addresses flagged by RedStone) | Re-check when RedStone updates (see below) |
| Em dashes in user-facing copy | 3 in Wizard, several in API error text | All removed from visible copy |

**Out of date / refresh schedule**

- `lib/sanctioned-pool.ts` (24 addresses, built 2026-08-20) is the only data
  file on the live path. Re-check against `areSanctioned` monthly.
- `lib/ofac-full.ts` (2026-09-05) and `lib/ofac-addresses.ts` (2026-08-13) feed
  only the fallback denylist and scripts.
- `NEWTON-SETUP.md`, `policy/DEPLOY.md`, `policy/NEWTON-ISSUE.md`,
  `CASE-STUDY.md`: now marked historical / pre-0.7.
- `@newton-xyz/sdk` installed is 1.1.0; the client follows 1.2.2's ABI (read
  from npm). Unused at runtime.

## 3. Fixed in code

| # | Sev | Problem | Fix |
| --- | --- | --- | --- |
| 1 | High | A failed screen could show "Non Compliant" with the recipient tagged **Designated** (tag was inferred from the verdict) | "Designated" now only comes from the lookup that found the address listed; a pass is still read off the signed verdict |
| 2 | High | v1 oracle accepted `rpc_urls` from wasm_args: whoever submits a task could choose the RPC the oracle trusts and get a sanctioned wallet signed ALLOWED | v2: fixed RPC list in the WASM (needs deploy, section 4) |
| 3 | High | Payer not bound to the intent: a mismatched or missing sender skipped the payer check | v2 Rego: `payer_not_screened` unless the screened payer equals `input.from` (needs deploy) |
| 4 | Medium | One RPC decided the verdict; a lagging node could hide a stale list | v2: two independent RPCs must answer and agree within 64 blocks; listed if either says so; oldest age wins (needs deploy) |
| 5 | Medium | `/api/evaluate` simulate mode let anyone run their own Rego and oracle on our key, and echoed raw gateway output | Route is submit-only |
| 6 | Medium | Request could steer tasks to other clients (`providerId`), crash on `"constructor"`, or put the yente URL into on-chain wasm_args | Only `redstone` accepted; one client from `POLICY_CLIENT_REDSTONE`; wasm_args built server-side as `{to, from}` |
| 7 | Medium | Silent client fallbacks (`?? POLICY_CLIENT_DENYLIST`, `?? POLICY_CLIENT`) | Removed; unset variable refuses with a fixed message |
| 8 | Medium | A stale-list relabel could tell a visitor "nobody was found" about a listed address | Relabel only when the recipient is not flagged; `/api/screen` returns flags even when stale |
| 9 | Medium | A slow lookup from an earlier check could relabel a later one | Each check has a run id; late answers only land on their own run |
| 10 | Medium | `/api/screen` unthrottled and unbounded (a free mainnet + OpenSanctions proxy) | 20/min/IP, exactly 1 or 2 addresses, 1 KB body |
| 11 | Medium | RPC errors returned to callers could include a keyed RPC URL | All routes log errors server-side and return fixed text |
| 12 | Medium | `/api/history`, `/api/policy-source` dead, stale, unthrottled | Return 410; delete with `git rm` |
| 13 | Low–Med | `/api/evaluate` accepted any `to`/`from`/`value` and any body size | Address and quantity validation, 2 KB body cap |
| 14 | Low | Operator/task error text and parser errors shown verbatim | Fixed sentences; raw detail to the console |
| 15 | Low | Any shape of `operator_errors` other than `[{message}]` was ignored | Any non-empty error of any shape is no decision |
| 16 | Low | Verdict panel showed the live input box, not the screened address | Shows the screened address |
| 17 | Low | Rate limiter wiped every bucket when full | Evicts oldest keys; per-route buckets |
| 18 | Low | `/api/screening-health` hit the RPC on every page load | Cached 60 s per instance |
| 19 | Low | viem default retries made a slow RPC hold a check ~30-40 s; failed reads cached as fact | `retryCount: 1`; guesses never cached |
| 20 | Low | No security headers, `x-powered-by` on | `frame-ancestors 'none'`, nosniff, referrer and permissions policies; banner off |
| 21 | Low | v1 oracle threw on `null` wasm_args; staleness param unbounded | v2: never throws; max age honoured only between 1 h and 30 d |
| 22 | Low | `usage.mjs` printed the key's prefix and missed RedStone set ids | Prefix removed; current set id read from chain |
| 23 | Low | `deploy.sh` named the old domain; README/env docs listed unused vars and missed used ones | Updated; `.env.local.example` rewritten |

## 4. Actions outside the code

**Open**

1. **Owner key exposure: accepted by the owner (Oct 9 2026), not an issue
   for this testnet demo.** For the record: whoever holds `OWNER_PRIVATE_KEY`
   controls what client `0x57F4fB0a…` enforces (`setPolicies`,
   `setPolicyClientOwner`). If the demo is ever reused for anything beyond
   testnet, rotate it first: new wallet, new dashboard API key,
   `setPolicyClientOwner` on both clients, update Vercel.
2. **Deploy policy v2** (fixes 2, 3, 4, 21). From `policy-builder`:
   `newton-cli policy build -p policy/redstone`, simulate the clean,
   sanctioned and stale fixtures, `newton-cli policy deploy -p policy/redstone`,
   `setPolicies` on the test client, `node policy/task-test.mjs` (clean and
   `0x175d…`), then `setPolicies` on the live client. No page change is needed:
   wasm_args stay `{to, from}`.
3. **Vercel Firewall rate limits** on `/api/evaluate` (10/min) and
   `/api/screen` (60/min). The in-code limits are per instance.
4. **Set `POLICY_CLIENT_REDSTONE` on Vercel** before deploying this audit's
   code (the route no longer falls back).
5. **Confirm the 0.7 response shape** (section 7) so the verdict parser can
   require the exact path and status instead of "every `allowed` agrees".

**Done**

- Code fixes 1, 5–20, 22–23 (deploy pending; verify in section 7).

## 5. Known limits

**Need a new policy or client deployment**

- v2 oracle and Rego (fixes 2, 3, 4, 21): written and tested offline, not deployed.
- Native transfers only: ERC-20 recipients are not screened.
- `SanctionsDemoClient.setPolicyClientOwner` has no zero-address check or
  two-step accept; fixing it means a new client.
- Operators read "latest" independently; near a RedStone update or the 8-day
  edge they can disagree, which fails the task (outage, not a wrong verdict).

**Need data or ops work**

- `sanctioned-pool.ts` re-check against RedStone after each weekly update.
- List names depend on the yente service at `YENTE_URL`; its freshness is not
  checked by the page.
- Cost per check: 1 gateway task, every operator running the oracle (2 to 4
  mainnet RPC sources × 3 calls with v2), plus 3 mainnet reads and possibly one
  OpenSanctions lookup for the explanation.

## 6. Chain check

| Check | Result |
| --- | --- |
| `areSanctioned` on the 24 pool addresses | all true (Oct 9, `cast`) |
| RedStone `getLastUpdateBlockTimestamp` | 2026-10-06 10:53:59 UTC, 72 h old (Oct 9) |
| `dist/policy.rego` keccak vs `policyCodeHash` | match (0xa585f495…) |
| Client interface id | 0xf67e14d6 = XOR of the 7 selectors |

## 7. Live check after deploy

Run the command in the hand-off message; record results here.

| Check | Expected | Result |
| --- | --- | --- |
| Clean `0x1111…` | allowed | |
| Sanctioned `0x175d…` | denied | |
| Bad address / `providerId:"yente"` / `mode:"simulate"` | 400 | |
| `/api/screen` with 3 addresses | 400 | |
| `/api/history`, `/api/policy-source` | 410 or 404 | |
| Security headers on `/` | present | |
| Repo public? `.env` in git? keys in history? | no / no / no | |
