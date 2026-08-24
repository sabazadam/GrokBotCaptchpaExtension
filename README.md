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

## Kurulum ve Çalıştırma

**Önkoşullar:** Node 22+, [pnpm](https://pnpm.io), Google Chrome ve bir **Capsolver API
anahtarı**. Yerelde denemek için harici veritabanı gerekmez (gömülü pglite kullanılır).

### Hızlı başlangıç

```bash
pnpm install
pnpm build:extension            # -> apps/extension/dist (Chrome'a yüklenecek)

# 1) Backend'i başlat (gömülü DB; harici Postgres yok)
CAPSOLVER_API_KEY=capsolver_anahtarin ADMIN_TOKEN=uzun-rastgele-bir-deger \
  pnpm --filter @grokbot/backend start        # -> http://localhost:3000

# 2) Bir cihaz için aktivasyon kodu + kredi üret (kurulum promptunu da yazar)
CAPSOLVER_API_KEY=capsolver_anahtarin \
  pnpm --filter @grokbot/backend issue-code sen@ornek.com 100
```

3. Chrome'da `chrome://extensions` → sağ üstten **Geliştirici modu** → **Paketlenmemiş öğe
   yükle** → `apps/extension/dist` klasörünü seç.
4. Araç çubuğundaki eklenti simgesine tıkla → **Backend URL** = `http://localhost:3000`,
   **Aktivasyon kodu**'nu yapıştır → **Etkinleştir**. Kalan kredi görünür.
5. reCAPTCHA v2/v3 veya Turnstile içeren bir sayfaya git → otomatik çözülür.

### Mac Mini (ana sunucu) + MacBook (istemci) senaryosu

Backend'i Mac Mini'de çalıştırıp MacBook'un Chrome eklentisinden bağlanmak için:

1. **Mac Mini'de** backend'i başlat (yukarıdaki 1. adım). Sunucu `0.0.0.0` dinler, yani
   yerel ağdan erişilebilir. macOS "gelen bağlantılara izin ver" derse **izin ver**.
2. Mac Mini'nin yerel ağ IP'sini öğren: `ipconfig getifaddr en0` (ör. `192.168.1.42`).
3. **Mac Mini'de** o cihaz için aktivasyon kodu üret (2. adım).
4. **MacBook'ta** eklentiyi yükle (3. adım) ve popup'ta **Backend URL**'yi Mac Mini'nin
   IP'siyle gir: `http://192.168.1.42:3000`. Aktivasyon kodunu gir → Etkinleştir.
5. İki cihaz **aynı yerel ağda** olmalı. Ağ dışından (internet üzerinden) bağlanacaksan
   port yönlendirme/tünel + tercihen HTTPS gerekir.

Sunucuyu sürekli açık tutmak için `tmux`, `pm2` veya bir `launchd` servisi kullanabilirsin.
Üretim/çok makineli dağıtım (gerçek PostgreSQL, kurumsal zorunlu kurulum, ödeme webhook'u)
için: [`docs/INSTALL.md`](docs/INSTALL.md).

### Çözüm süresi hakkında

Çözüm süresi neredeyse tamamen **CAPTCHA sağlayıcısının** işidir, bu backend'in veya ağın
değil. reCAPTCHA **v2** görsel bulmaca olduğundan en yavaş türdür (tipik olarak ~15–70 sn);
reCAPTCHA **v3** ve **Turnstile** genelde birkaç saniyede biter. Backend yalnızca sonucu
poll eder (varsayılan 2 sn aralık, `CAPSOLVER_POLL_INTERVAL_MS` ile ayarlanabilir) ve en
fazla bir poll aralığı kadar ek gecikme ekler.

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
