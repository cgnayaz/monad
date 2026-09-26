# Hackathon Hazırlık Listesi

## Bu akşam yapılacaklar
- [x] Node.js v24.21 kuruldu (nvm)
- [x] Foundry 1.8.3 kuruldu, Monad testnet RPC bağlantısı test edildi
- [x] MetaMask'a Monad testnet eklendi
- [ ] Faucet'ten test MON al: https://faucet.monad.xyz
- [ ] Anthropic API anahtarı al: https://console.anthropic.com (biraz kredi yükle)
- [ ] GitHub hesabın hazır olsun (teslim için repo lazım)
- [ ] Vercel hesabı aç (demoyu internete koymak için, ücretsiz)

## Yarın ilk 30 dakika
1. Kuralları ve sponsor ödüllerini oku (Monad özel ödülü, AI kategorisi var mı?)
2. Fikri seç (aşağıdaki listeden veya temaya göre)
3. Claude'a: "Projeyi kur" → Foundry + Next.js iskeleti kurulur
4. Ajan ekibine işi dağıt:
   - kontrat-muhendisi → kontrat
   - frontend-gelistirici → arayüz (paralel)
   - ai-agent-muhendisi → agent (paralel)

## Zaman planı (24 saatlik hackathon varsayımı)
| Süre | İş |
|---|---|
| 0-1 sa | Fikir + iskelet |
| 1-6 sa | Kontrat + agent + arayüz (paralel) |
| 6-10 sa | Birleştirme, uçtan uca ilk çalışan demo → **commit + deploy** |
| 10-16 sa | "Vay" özelliği, görsel cila |
| 16-18 sa | guvenlik-denetcisi incelemesi, hata düzeltme |
| Son 3 sa | **Yeni özellik yok.** README, demo videosu, pitch (sunum-hazirlayici) |

## Fikir havuzu (MON + AI agent)
1. **Sohbetle cüzdan:** "Ali'ye 5 MON gönder", "bakiyem ne" → agent işlemi hazırlar, sen onaylarsın. En kolay, en güvenli demo.
2. **AI bahis/tahmin hakemi:** Kullanıcılar MON yatırır, agent sonucu değerlendirip kazananlara dağıtır.
3. **Görev ödül agent'ı:** Topluluk görevleri (tweet, katkı) — agent kontrol eder, MON ödülü otomatik gönderir.
4. **Otonom hazine yöneticisi:** Grup kasası (kontrat), agent harcama önerir, üyeler oylar, onaylanınca işlem yapılır.
5. **Çoklu agent pazarı:** Agent'lar birbirine MON ile hizmet satar (ör. araştırma agent'ı → özet agent'ı), ödemeler zincirde.
