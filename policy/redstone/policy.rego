package newton_redstone

import future.keywords

# Sanctions screening against the RedStone Sanctions Oracle (Ethereum mainnet,
# 463 official lists via OpenSanctions, updated weekly). data.wasm is the
# output of policy.js; data.params.max_list_age_seconds is the staleness limit.
#
# Fail closed: anything unreadable denies. Every check is guarded with
# is_string / is_number / is_boolean, because in Regorus lower(null) is a
# fatal error rather than undefined, and a crashed evaluation is no answer.

default allow := false

w := data.wasm

# 8 days: RedStone updates weekly, plus a day of slack.
default max_age := 691200

max_age := data.params.max_list_age_seconds if is_number(data.params.max_list_age_seconds)

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

deny contains "screening_unavailable" if not screening_ok

deny contains "payee_not_screened" if not payee_screened

deny contains "payee_sanctioned" if w.to.sanctioned == true

deny contains "payer_sanctioned" if w.from.sanctioned == true

allow if count(deny) == 0
