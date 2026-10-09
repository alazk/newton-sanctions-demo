# Newton Sanctions Demo

Enter a recipient address. Newton Protocol operators check it against the
**RedStone Sanctions Oracle** on Ethereum mainnet, and an operator quorum signs
the decision on Ethereum Sepolia **before** the transfer would execute. Every
verdict is a real `newt_createTask` with an attestation you can open in the
Newton Explorer, not a simulation.

The policy screens both parties. The page sends a freshly generated random
sender with each check, so in practice only the recipient you choose can cause
a denial.

Live: **https://sanctions-demo.newt.foundation** (Newton team Vercel project
`newton-aml-ofac-policy-engine`). Last audited Oct 2026: see `AUDIT.md`.

---

## How it works

```
page ─▶ /api/evaluate ─▶ newt_createTask ─▶ operators run policy/redstone ─▶ quorum signs
                                                  │
                                                  └─▶ RedStone Sanctions Oracle (Ethereum mainnet)
```

- **PolicyClient** `0x57F4fB0a4A4b34eA51D47BC7c99c960b80A58D18`: our own
  v0.7 client (`policy/SanctionsDemoClient.sol`), owned by `0x8b4bA870…`, the
  wallet behind the Newton API key. Its policy set holds one policy.
- **Policy** `0xd0Ff7aca199AeaCC5F316b029A476Da7684a3877` (`policy/redstone/`,
  entrypoint `newton_redstone.allow`, params `max_list_age_seconds: 691200`).
  Its WASM oracle reads RedStone's contract `0x574Ad490fE8087B580DB227a8Ca7EfB7C19Dc8C4`
  (`areSanctioned`, `getLastUpdateBlockTimestamp`) for payee and payer. RedStone
  says the list is built from 463 official sources via OpenSanctions (OFAC, EU,
  UN, UK and others) and updated weekly.
- **Fails closed.** The policy denies if either party is listed, if the oracle
  could not screen (`screening_unavailable`, `payee_not_screened`), or if the
  list is more than 8 days old.
- **Native transfers only.** The policy screens `intent.to`. For a token
  transfer that is the token contract, so ERC-20 recipients are not screened.

After a verdict, the page explains it with `/api/screen`: which party RedStone
flags and, via an OpenSanctions lookup, which list names them ("OFAC SDN").
That explanation is unsigned and labelled as such; the attestation is the
verdict.

---

## Setup

```bash
npm install
cp .env.local.example .env.local   # fill in, see below
bash dev.sh
```

`dev.sh` frees port 3000, clears `.next`, typechecks (non-blocking), and starts
the server.

### Environment

`.env.local` is gitignored. The site reads:

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEWTON_API_KEY` | yes | Gateway auth. Server-side only. Its account's wallet must **own the PolicyClient on-chain**. |
| `POLICY_CLIENT_REDSTONE` | yes | The one client every check is submitted to. No fallback: unset means the route refuses. |
| `YENTE_URL`, `YENTE_DATASET` | no | OpenSanctions lookup for list names after a denial. Unset: verdicts still work, without list names. |
| `MAINNET_RPC_URL`, `SEPOLIA_RPC_URL` | no | The page's own reads. Keyless public defaults. |
| `NEWTON_GATEWAY_URL` | no | Only for a non-production gateway. |

On Vercel these live under Settings → Environment Variables; changing them
needs a redeploy.

### Routes

| Route | Purpose | Limits |
| --- | --- | --- |
| `/api/evaluate` | Submits the task (submit only). | 6 / min / IP, validated input |
| `/api/screen` | Which party and which list. Unsigned explanation. | 20 / min / IP, exactly the transfer's 1 or 2 addresses |
| `/api/screening-health` | Age of RedStone's list. | Cached 60 s |

The rate limits are in-memory per instance. For real protection add a Vercel
Firewall rate-limit rule on `/api/evaluate` and `/api/screen`.

---

## Operating it

```bash
# Real tasks against a client (read the key, never type it inline)
read -rs "NEWTON_API_KEY?Key: " && export NEWTON_API_KEY
node policy/task-test.mjs 0x57F4fB0a4A4b34eA51D47BC7c99c960b80A58D18 0x1111111111111111111111111111111111111111
node policy/task-test.mjs 0x57F4fB0a4A4b34eA51D47BC7c99c960b80A58D18 0x175d44451403edf28469df03a9280c1197adb92c

# How many checks since launch
node policy/usage.mjs
```

**Changing the policy.** Build and simulate with `newton-cli` in
`policy/redstone/` (see its README), deploy with `newton-cli policy deploy`,
bind it to the throwaway test client `0x6DeD0ACa06D76FEF4ec8254B8f661edbC387cf2A`
first, run `task-test.mjs` against it, and only then `setPolicies` on the live
client. Deploy the site before switching the policy if the page's request shape
changes.

**Fallback.** `node policy/setpolicies-v07.mjs --confirm` (needs
`OWNER_PRIVATE_KEY` from `../deploy/.env`) puts the frozen 119-address denylist
policy `0x95c66b29…` back on the live client. The page copy names RedStone and
would then be wrong, so treat this as an emergency switch.

**Why a custom client.** The 0.7 upgrade (Sept 2026) made the gateway read a
policy *set* (`getPolicies`, interface id `0xf67e14d6`). Older clients
(`0x749753…`, `0xfd0545…`) cannot be migrated and the public newton-contracts
repo lags the deployed protocol, so `SanctionsDemoClient` implements the 0.7
interface from `@newton-xyz/sdk` 1.2.2's `NewtonPolicyClientAbi` (the repo has
1.1.0 installed; 1.2.2 was read from npm).

---

## Deploying the site

```bash
bash deploy.sh "what changed"
```

Refuses if a `.env` file is staged, typechecks, runs the production build,
then commits, pushes, and promotes with `vercel --prod`. The on-chain policy is
managed separately (above).

---

## Design system

`lib/ds.ts` holds the tokens: 8px spacing grid, radii, control heights, type
scale, colour. Verdict fills carry the only meaningful colour; interaction is
ink.

---

## Notes

- Signing happens on **Ethereum Sepolia**, a test network. The sanctions data
  is read from **Ethereum mainnet**.
- History: `STATUS.md` (current state), `AUDIT.md` (Oct 2026 audit).
  `policy/DEPLOY.md`, `policy/NEWTON-ISSUE.md` and `NEWTON-SETUP.md` describe
  the pre-0.7 setup and are kept as history.
