#!/usr/bin/env bash
# Fork test of the deployed contracts against the real Pyth on Monad Testnet, using real signed
# Hermes updates (needs PYTH_API_KEY in web/.env.local). Nothing is broadcast.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
set -a; . "$ROOT/web/.env.local"; . "$ROOT/contracts/.env"; set +a
FEED=$(cd "$ROOT/web" && node -e "const s=require('fs').readFileSync('lib/config/public.ts','utf8');console.log(s.match(/feedId: \"(0x[0-9a-f]{64})\"/)[1])")
T=$(( $(date +%s) - 180 ))
get() { curl -sf -m 15 -H "Authorization: Bearer $PYTH_API_KEY" "$PYTH_HERMES_URL/v2/updates/price/$1?ids%5B%5D=$FEED&encoding=hex&parsed=true"; }
field() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d['binary']['data'][0] if '$1'=='data' else d['parsed'][0]['price']['publish_time'])"; }
S=$(get $T); PT=$(echo "$S" | field time)
E=$(get $((PT + 60)))
L=$(get $((PT + 75)))
export PYTH_T=$PT U_START=0x$(echo "$S" | field data) U_END=0x$(echo "$E" | field data) U_LATER=0x$(echo "$L" | field data) MONAD_RPC=https://testnet-rpc.monad.xyz
echo "start publish $PT, end publish $(echo "$E" | field time), later publish $(echo "$L" | field time)"
cd "$ROOT/contracts" && "$HOME/.foundry/bin/forge" test --match-contract RealPythForkTest --fork-url "$MONAD_RPC" -vv
