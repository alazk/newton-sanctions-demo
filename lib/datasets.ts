/**
 * OpenSanctions dataset ids → the list name a person would recognise.
 *
 * RedStone's oracle answers listed / not listed only. Which list named a
 * wallet comes from OpenSanctions (RedStone's own upstream), looked up after
 * the verdict by /api/screen. Unknown ids fall back to a tidied version of the
 * id rather than being dropped, so a real match is never hidden.
 */
const LABELS: Record<string, string> = {
  us_ofac_sdn: "OFAC SDN",
  us_ofac_cons: "OFAC Consolidated",
  us_trade_csl: "US Trade CSL",
  eu_fsf: "EU Sanctions",
  eu_sanctions_map: "EU Sanctions",
  un_sc_sanctions: "UN Security Council",
  gb_hmt_sanctions: "UK HM Treasury",
  gb_fcdo_sanctions: "UK FCDO",
  ch_seco_sanctions: "Switzerland SECO",
  ca_dfatd_sema_sanctions: "Canada",
  au_dfat_sanctions: "Australia DFAT",
  jp_mof_sanctions: "Japan MoF",
  fr_tresor_gels_avoir: "France Trésor",
  il_mod_crypto: "Israel NBCTF",
  il_mod_terrorists: "Israel MoD",
  ua_nsdc_sanctions: "Ukraine NSDC",
  nz_russia_sanctions: "New Zealand",
};

/** Collections and non-list datasets: not a designation on their own. */
const IGNORE = new Set(["sanctions", "default", "crypto", "peps", "crime", "debarment", "ann_graph_topics"]);

export function listName(id: string): string | null {
  if (IGNORE.has(id)) return null;
  if (LABELS[id]) return LABELS[id];
  return id
    .split("_")
    .map((w, i) => (i === 0 && w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Unique, readable list names; OFAC first since it's the one most people look for. */
export function listNames(ids: string[]): string[] {
  const out = [...new Set(ids.map(listName).filter((x): x is string => Boolean(x)))];
  return out.sort((a, b) => Number(b.startsWith("OFAC")) - Number(a.startsWith("OFAC")));
}
