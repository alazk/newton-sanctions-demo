#!/usr/bin/env bash
# Live checks for AUDIT.md section 7. Read-only except for two real tasks
# (one clean, one sanctioned) on the live client. Prints no secrets.
#
#   bash scripts/audit-live.sh
set -u
SITE=https://sanctions-demo.newt.foundation
post() { curl -sS -o /tmp/al.json -w '%{http_code}' -X POST "$SITE$1" -H 'content-type: application/json' -d "$2"; }

echo "== Verdicts"
for a in 0x1111111111111111111111111111111111111111 0x175d44451403edf28469df03a9280c1197adb92c; do
  code=$(post /api/evaluate "{\"mode\":\"submit\",\"providerId\":\"redstone\",\"to\":\"$a\"}")
  echo "  $a  http=$code  $(grep -oE '"allowed":(true|false)|"error":"[^"]{0,120}' /tmp/al.json | head -1)"
  [ "$a" = 0x175d44451403edf28469df03a9280c1197adb92c ] && cp /tmp/al.json /tmp/al-deny.json
done

echo "== Response shape (paths holding allowed/status/error; values only if short)"
node -e '
const j=require("/tmp/al-deny.json"); const out=[];
(function w(x,p){ if(x&&typeof x==="object") for(const [k,v] of Object.entries(x)) {
  const q=p+"."+k; if(/allowed|status|error|deny|reason/i.test(k)) out.push(q+" = "+(typeof v==="object"?JSON.stringify(v).slice(0,80):String(v).slice(0,80)));
  w(v,q);} })(j,"$"); console.log(out.slice(0,25).join("\n")||"  (none)");'

echo "== Input validation (expect 400)"
echo "  bad address      $(post /api/evaluate '{"to":"0xabc"}')"
echo "  providerId yente $(post /api/evaluate '{"providerId":"yente","to":"0x1111111111111111111111111111111111111111"}')"
echo "  mode simulate    $(post /api/evaluate '{"mode":"simulate","rego":"x","to":"0x1111111111111111111111111111111111111111"}')"
echo "  screen 3 addrs   $(post /api/screen '{"addresses":["0x1111111111111111111111111111111111111111","0x2222222222222222222222222222222222222222","0x3333333333333333333333333333333333333333"]}')"

echo "== Retired routes (expect 404 or 410)"
for p in /api/history /api/policy-source; do echo "  $p $(curl -s -o /dev/null -w '%{http_code}' $SITE$p)"; done

echo "== Health"
echo "  $(curl -sS $SITE/api/screening-health)"

echo "== Headers on /"
curl -sI $SITE | grep -iE '^(content-security-policy|x-frame-options|x-content-type-options|referrer-policy|x-powered-by)' | sed 's/^/  /'

echo "== Repo"
url=$(git remote get-url origin 2>/dev/null); echo "  remote: $url"
slug=$(echo "$url" | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')
br=$(git rev-parse --abbrev-ref HEAD)
echo "  anonymous raw README: $(curl -s -o /dev/null -w '%{http_code}' https://raw.githubusercontent.com/$slug/$br/README.md)  (200 = PUBLIC)"
echo "  env files tracked: $(git ls-files | grep -E '(^|/)\.env' | grep -vE '\.example$' | tr '\n' ' ')(none = good)"
echo "  commits ever containing key-like assignments: $(git log --all --oneline -G 'PRIVATE_KEY=0x[0-9a-fA-F]{8}|NEWTON_API_KEY=gw_|PINATA_JWT=eyJ' | wc -l | tr -d ' ')  (0 = good)"
echo "  live commit: $(git log --oneline -1)"
