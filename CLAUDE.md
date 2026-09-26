# DecMarkt — AI decisions with on-chain accountability

Jev (karar yapısı) → DecMarkt (hesap verebilirlik: bond, eşik, ödül/ceza) → Monad (yürütme ve settlement).
Tasarım belgeleri kökte: ARCHITECTURE, JEV_INTEGRATION, DATA_MODEL, CONTRACT_SPEC, SECURITY_MODEL, DESIGN_SYSTEM, DEMO_FLOW, DEPLOYMENT (.md). Kod yazmadan önce ilgili belgeyi oku; belgeyle çelişen değişikliği belgeye de işle.
Kurallar: veri uydurma yok (hash, blok, bakiye, sonuç hep zincirden), AI calldata/anahtar yok, sadece sınırlı fork'lar.
Kullanıcı Türkçe konuşur; cevaplar Türkçe olsun. Tarz: vibe coding — hızlı, çalışan demo öncelikli.

## Hedef
Hackathon sonunda: çalışan canlı demo + GitHub repo + 2-3 dakikalık sunum.
Mükemmel kod değil, **çalışan ve etkileyici demo** önemli. Her 1-2 saatte bir çalışır halde commit at.

## Teknoloji
- **Kontrat:** Solidity + Foundry (`contracts/`)
- **Frontend:** Next.js (App Router) + TypeScript + Tailwind + wagmi + viem (`web/`, cüzdan için injected connector; RainbowKit yok)
- **AI:** sunucu tarafı provider soyutlaması (`web/lib/ai/`), 5 bağımsız analist; pipeline `web/lib/engine/`, API `web/app/api/decisions/` (NDJSON akışı + `/[id]/advance`); uçtan uca test `web/scripts/integration.sh` (anvil)
- **Kalite:** `cd web && npm run check` (typegen+tsc, eslint, vitest, build) — commit öncesi yeşil olmalı
- **Oracle:** Pyth (Hermes API anahtarı gerekli: `PYTH_API_KEY`) (Monad testnet `0x2880aB155794e7179c9eE2e38200202908C17B43`, ETH/USD — anahtar yalnızca ETH/USD'ye yetkili)
- Agent kodu yazarken önce `claude-api` skill'ini yükle; model adlarını ezberden yazma.

## Monad bilgileri (etkinlikte doğrula!)
- Testnet: chain id `10143`, RPC `https://testnet-rpc.monad.xyz`, sembol `MON`
- Explorer: `https://testnet.monadexplorer.com`
- Faucet: `https://faucet.monad.xyz`
- EVM uyumlu: Ethereum araçları (Foundry, viem, wagmi) doğrudan çalışır.
- Hackathon organizatörü farklı RPC / chain / sponsor aracı verirse onları kullan.

## Güvenlik kuralları
- Özel anahtarlar SADECE `.env` / `.env.local` içinde; bu dosyalar `.gitignore`'da. Asla commit'leme.
- Sadece testnet cüzdanı kullan, içinde gerçek para olmasın.
- Kullanıcı adına işlem yapan agent: işlemi **hazırlar**, kullanıcı cüzdanında **onaylar**. Otonom agent'a ayrı, az bakiyeli bir cüzdan ver ve harcama limiti koy.

## Agent ekibi (`.claude/agents/`)
- `kontrat-muhendisi` — Solidity kontratları, Foundry testleri, Monad'a deploy
- `frontend-gelistirici` — Next.js arayüz, cüzdan bağlantısı, kontrat entegrasyonu
- `ai-agent-muhendisi` — Claude tool-use agent'ı, araçlar, agent döngüsü
- `guvenlik-denetcisi` — kontrat ve agent güvenlik incelemesi (salt okunur)
- `sunum-hazirlayici` — README, demo senaryosu, pitch metni
