#!/usr/bin/env bash
# web/.env.local içindeki sunucu değişkenlerini Vercel projesine (Production + Preview) yükler
# Değerler asla ekrana yazılmaz.
#
#   cd web && bash scripts/vercel-env-sync.sh
#
# İlk çalıştırmada Vercel CLI giriş ister (tarayıcı açılır) ve projeyi bağlar (decmarkt'ı seçin).
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.local"
[[ -f "$ENV_FILE" ]] || { echo "✗ $PWD/$ENV_FILE bulunamadı. Anahtarların olduğu bilgisayarda çalıştırın."; exit 1; }

VARS=(AI_PROVIDER GEMINI_API_KEY AI_MODEL AI_FALLBACK_MODEL PYTH_API_KEY PYTH_HERMES_URL SESSION_SECRET
  PROPOSER_PRIVATE_KEY KEEPER_PRIVATE_KEY
  AGENT_RISK_PRIVATE_KEY AGENT_YIELD_PRIVATE_KEY AGENT_SECURITY_PRIVATE_KEY AGENT_MARKET_PRIVATE_KEY AGENT_HISTORY_PRIVATE_KEY
  BLOB_READ_WRITE_TOKEN)

# KEY=VALUE satırından değeri oku (tırnaklar ve boşluklar temizlenir).
value_of() {
  local line
  line=$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" "$ENV_FILE" | tail -n1 || true)
  line=${line#*=}
  line=$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")
  printf '%s' "$line"
}

VERCEL=${VERCEL:-"npx --yes vercel@latest"}
[[ -f .vercel/project.json ]] || $VERCEL link

added=0
for name in "${VARS[@]}"; do
  val=$(value_of "$name")
  if [[ -z "$val" && "$name" == "SESSION_SECRET" ]]; then
    val=$(openssl rand -hex 32)
    echo "• SESSION_SECRET .env.local'da yok; yeni rastgele bir değer üretildi."
  fi
  if [[ -z "$val" ]]; then
    echo "– $name: .env.local'da boş, atlandı"
    continue
  fi
  for target in production preview; do
    $VERCEL env rm "$name" "$target" --yes >/dev/null 2>&1 || true
    printf '%s' "$val" | $VERCEL env add "$name" "$target" >/dev/null
  done
  echo "✓ $name"
  added=$((added + 1))
done
echo "$added değişken Vercel'e yüklendi (Production + Preview)."

echo "Şimdi Vercel → Deployments → en üstteki deploy → ⋯ → Redeploy yapın; değişkenler ancak yeni deploy ile devreye girer."
