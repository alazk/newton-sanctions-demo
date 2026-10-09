package newton_redstone

import future.keywords

# Sanctions screening against the RedStone Sanctions Oracle (Ethereum mainnet,
# 463 official lists via OpenSanctions per RedStone, updated weekly).
# data.wasm is the output of policy.js; data.params.max_list_age_seconds is the
# staleness limit.
#
# Fail closed: anything unreadable denies. Every check is guarded with
# is_string / is_number / is_boolean, because in Regorus lower(null) is a
# fatal error rather than undefined, and a crashed evaluation is no answer.
#
# v2 (audit, Oct 2026):
#   - The payer is bound to the intent like the payee: if the intent has a
#     sender, the oracle must have screened exactly that address.
#   - max_list_age_seconds is only honoured between 1 hour and 30 days, so a
#     params value cannot switch the staleness check off or deny everything.
#   - Native transfers only: input.to is the recipient. For a token transfer
#     input.to is the token contract, so this policy does not screen ERC-20
#     recipients.

default allow := false

w := data.wasm

# 8 days: RedStone updates weekly, plus a day of slack.
default max_age := 691200

max_age := data.params.max_list_age_seconds if {
	is_number(data.params.max_list_age_seconds)
	data.params.max_list_age_seconds >= 3600
	data.params.max_list_age_seconds <= 2592000
}

screening_ok if {
	w.ok == true
	is_number(w.list_age_seconds)
	w.list_age_seconds <= max_age
}

payee_screened if {
	is_string(w.to.address)
	is_string(input.to)
	lower(w.to.address) == lower(input.to)
	is_boolean(w.to.sanctioned)
}

# No sender on the intent: nothing to bind.
payer_screened if not is_string(input.from)

payer_screened if {
	is_string(input.from)
	is_object(w.from)
	is_string(w.from.address)
	lower(w.from.address) == lower(input.from)
	is_boolean(w.from.sanctioned)
}

deny contains "screening_unavailable" if not screening_ok

deny contains "payee_not_screened" if not payee_screened

deny contains "payer_not_screened" if not payer_screened

deny contains "payee_sanctioned" if w.to.sanctioned == true

deny contains "payer_sanctioned" if {
	is_object(w.from)
	w.from.sanctioned == true
}

allow if count(deny) == 0
