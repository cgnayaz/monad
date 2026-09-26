# Monad Hackathon Projesi

Sıfırdan, Monad üzerinde MON token kullanan, AI agent destekli web3 uygulaması.
Kullanıcı Türkçe konuşur; cevaplar Türkçe olsun. Tarz: vibe coding — hızlı, çalışan demo öncelikli.

## Hedef
Hackathon sonunda: çalışan canlı demo + GitHub repo + 2-3 dakikalık sunum.
Mükemmel kod değil, **çalışan ve etkileyici demo** önemli. Her 1-2 saatte bir çalışır halde commit at.

## Teknoloji
- **Kontrat:** Solidity + Foundry (`contracts/`)
- **Frontend:** Next.js (App Router) + TypeScript + Tailwind + wagmi + viem + RainbowKit (`web/`)
- **AI agent:** Claude API, tool use (araç çağırma). Sunucu tarafında Next.js API route içinde çalışır (`web/app/api/agent/`)
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
