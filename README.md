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
apps/backend      Fastify API + Capsolver istemcisi + kredi defteri + auth + limitler +
                  Lemon Squeezy webhook + gözlemlenebilirlik (PostgreSQL / Drizzle)
apps/extension    Manifest V3 Chrome eklentisi (tespit + token enjeksiyonu + popup)
docs/DESIGN.md    Sistem tasarımı ve yol haritası
docs/INSTALL.md   Kurulum, dağıtım ve onboarding rehberi
```

## Geliştirme

```bash
pnpm install         # bağımlılıkları kur
pnpm typecheck       # backend + extension tip kontrolü
pnpm test            # birim/entegrasyon testleri (Vitest; DB için gömülü pglite)
pnpm build:extension # eklentiyi derle -> apps/extension/dist
pnpm --filter @grokbot/backend start        # backend'i çalıştır (env: apps/backend/.env.example)
pnpm --filter @grokbot/backend issue-code <email> [kredi]  # aktivasyon kodu + kurulum promptu üret
```

Backend, Capsolver anahtarını yalnızca ortam değişkeninden okur (`apps/backend/.env.example`).
API anahtarı ve kredi bakiyesi **asla** eklentiye gönderilmez. Yerelde denemek için
harici Postgres gerekmez: `DATABASE_URL` boşsa gömülü (pglite) veritabanı kullanılır
(üretimde gerçek PostgreSQL için `DATABASE_URL` ayarlayın). Adım adım yerel kurulum için
[`docs/INSTALL.md`](docs/INSTALL.md).

## Durum

`docs/DESIGN.md` yol haritasının tamamı uygulandı:
- **M1** Backend güvenlik çekirdeği — cihaz token auth, atomik `reserve→settle/refund`
  kredi defteri, kullanıcı başına hız/eşzamanlılık/günlük limit, global bütçe kesici,
  idempotent `POST /v1/solve`.
- **M2** Lemon Squeezy imza doğrulamalı webhook ile idempotent kredi yükleme + bakiye API.
- **M3** Manifest V3 Chrome eklentisi — reCAPTCHA v2/v3 + Turnstile tespiti, token enjeksiyonu, popup.
- **M4** Onboarding — aktivasyon kodu üretimi, kopyala-yapıştır kurulum promptu, admin uçları, CLI, dağıtım rehberi.
- **M5** Gözlemlenebilirlik — yapılandırılmış log, metrikler + `/metrics`, harcama uyarıları, hata yakalama.
- **M6** Kapsam — backend reCAPTCHA v2/v3, Turnstile, GeeTest, AWS WAF, ImageToText,
  Cloudflare Challenge ve DataDome'u kapsar.
