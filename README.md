# GrokBotCaptchpaExtension

Grok botlarının otomasyonlarında karşılaştıkları CAPTCHA'ları, güvenli bir backend
üzerinden Capsolver ile otomatik çözen çok kiracılı (multi-tenant) bir Chrome
eklentisi projesi.

- Kredi bazlı fiyatlandırma (Lemon Squeezy), kullanıcı başına izolasyon ve API anahtarı
  güvenliği tasarımın merkezinde.
- Ayrıntılı mimari, güvenlik modeli ve yol haritası için: [`docs/DESIGN.md`](docs/DESIGN.md)

## Depo yapısı (monorepo, pnpm workspaces)

```
packages/shared   Ortak TS tipleri: CAPTCHA kayıt tablosu, API sözleşmesi, hata kodları
apps/backend      Capsolver istemcisi (createTask/getTaskResult) + solve servisi
docs/DESIGN.md    Sistem tasarımı ve yol haritası
```

## Geliştirme

```bash
pnpm install        # bağımlılıkları kur
pnpm typecheck      # tüm workspace'i tip kontrolünden geçir
pnpm test           # birim testleri (Vitest)
```

Backend, Capsolver anahtarını yalnızca ortam değişkeninden okur (`apps/backend/.env.example`).
API anahtarı ve kredi bakiyesi **asla** eklentiye gönderilmez.

## Durum

Kuruluş aşaması: paylaşılan CAPTCHA kayıt tablosu ve Capsolver çözüm çekirdeği hazır.
Sıradaki adım, `docs/DESIGN.md` yol haritasındaki **M1 — backend güvenlik çekirdeği**
(cihaz token auth + kredi defteri + limitler + `/v1/solve` uç noktası).
