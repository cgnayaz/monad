#!/usr/bin/env bash
# LOCAL DEVELOPMENT ONLY. Starts anvil (chain id 10143) on :8546, deploys the contracts,
# seeds real rounds and leaves the chain running for UI review.
#   scripts/local-chain.sh start   — then run the app with NEXT_PUBLIC_MONAD_RPC_URL=http://127.0.0.1:8546
#   scripts/local-chain.sh stop    — stops anvil and restores the deployments file
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
PORT=8546
DEPLOYMENTS="$ROOT/web/lib/chain/deployments.10143.json"
STATE_DIR="$ROOT/web/.data"
mkdir -p "$STATE_DIR"

case "${1:-start}" in
  stop)
    [ -f "$STATE_DIR/anvil.pid" ] && kill "$(cat "$STATE_DIR/anvil.pid")" 2>/dev/null || true
    rm -f "$STATE_DIR/anvil.pid"
    (cd "$ROOT" && git checkout -- web/lib/chain/deployments.10143.json)
    rm -rf "$STATE_DIR/payloads"
    echo "stopped; deployments restored"
    ;;
  start)
    rm -rf "$STATE_DIR/payloads"
    anvil --chain-id 10143 --port "$PORT" --silent >/dev/null 2>&1 &
    echo $! > "$STATE_DIR/anvil.pid"
    sleep 1
    addr() { cast wallet address --private-key "$1"; }
    K=(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
       0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
       0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
       0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
       0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
       0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba
       0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e
       0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356)
    (cd "$ROOT/contracts" && DEPLOYER_PRIVATE_KEY=${K[0]} PROPOSER_ADDRESS=$(addr ${K[1]}) GUARDIAN_ADDRESS=$(addr ${K[2]}) \
      AGENT_RISK_ADDRESS=$(addr ${K[3]}) AGENT_YIELD_ADDRESS=$(addr ${K[4]}) AGENT_SECURITY_ADDRESS=$(addr ${K[5]}) \
      AGENT_MARKET_ADDRESS=$(addr ${K[6]}) AGENT_HISTORY_ADDRESS=$(addr ${K[7]}) \
      forge script script/Deploy.s.sol --rpc-url "http://127.0.0.1:$PORT" --broadcast --silent)
    (cd "$ROOT/web" && npx vitest run --config vitest.local.config.mts)
    echo "local chain running on :$PORT (pid $(cat "$STATE_DIR/anvil.pid"))"
    ;;
esac
