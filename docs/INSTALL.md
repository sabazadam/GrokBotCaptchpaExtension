# Kurulum ve Dağıtım Rehberi

Bu doküman, Grok Bot CAPTCHA Solver eklentisinin Grok bot makinelerine nasıl
dağıtılacağını ve bir abonenin nasıl etkinleştirileceğini anlatır.

## 0. Yerel hızlı başlangıç (harici Postgres GEREKMEZ)

Yerelde denemek için tek gerçek gereksinim bir **Capsolver API anahtarı** ve **Chrome**.
`DATABASE_URL` boş bırakılırsa backend gömülü (pglite) veritabanı ile çalışır.
PGlite **tek süreçlidir**: sunucu ayaktayken `issue-code` aynı veri dizinini ikinci kez
açmaz; `ADMIN_TOKEN` ile çalışan backend'in `/admin` API'sine gider.

```bash
pnpm install
pnpm build:extension            # -> apps/extension/dist (Chrome'a yüklenecek)

# Backend'i gömülü DB ile başlat (harici Postgres yok)
CAPSOLVER_API_KEY=gercek_capsolver_anahtarin \
ADMIN_TOKEN=uzun-rastgele-bir-deger \
pnpm --filter @grokbot/backend start
# -> http://localhost:3000 (şema açılışta otomatik kurulur)

# Bir cihaz için aktivasyon kodu + kredi üret (kurulum promptunu da yazar).
# ADMIN_TOKEN, çalışan sunucuya gitmek için gereklidir (gömülü DB kilitli olur).
CAPSOLVER_API_KEY=gercek_capsolver_anahtarin \
ADMIN_TOKEN=uzun-rastgele-bir-deger \
pnpm --filter @grokbot/backend issue-code kullanici@ornek.com 100
```

Ardından Chrome'da `chrome://extensions` → "Geliştirici modu" → "Paketlenmemiş öğe yükle"
ile `apps/extension/dist` klasörünü seç; eklenti popup'ında Backend URL'yi
`http://localhost:3000` yap ve üretilen aktivasyon kodunu gir.

> Not: Gömülü DB tek makine/geliştirme içindir. Üretimde `DATABASE_URL` ile gerçek
> PostgreSQL kullanın (aşağıya bakın).

## 1. Backend'i çalıştır (üretim / gerçek Postgres)

Gereken ortam değişkenleri için `apps/backend/.env.example` dosyasına bakın. En az:

```bash
CAPSOLVER_API_KEY=...         # yalnızca backend'de; ASLA eklentiye konmaz
DATABASE_URL=postgres://...   # gerçek PostgreSQL (NODE_ENV=production iken zorunlu)
ADMIN_TOKEN=...               # admin uçlarını korur (aktivasyon kodu üretimi)
PUBLIC_BACKEND_URL=https://api.senin-alan-adin.com
# Opsiyonel fallback sağlayıcılar:
# ANTICAPTCHA_API_KEY=...     # 2. sağlayıcı
# TWOCAPTCHA_API_KEY=...      # 3. sağlayıcı
```

Çalıştır:

```bash
pnpm --filter @grokbot/backend start
```

Şema (tablolar) açılışta otomatik ve idempotent şekilde kurulur.

## 2. Eklentiyi derle

```bash
pnpm build:extension
# Çıktı: apps/extension/dist  (yüklenebilir MV3 eklentisi)
```

## 3. Eklentiyi Grok bot makinelerine dağıt

Makineler senin kontrolünde olduğu için **halka açık Chrome Web Store zorunlu değildir**.
Üç yol vardır (öncelik sırasına göre):

### A) Kurumsal zorunlu kurulum (önerilen)
Google Admin / Chrome politikası `ExtensionInstallForcelist` ile eklentiyi kendi
barındırdığın güncelleme URL'sinden merkezî olarak dağıt. Store incelemesini ve
politika riskini tamamen atlar.
- Eklentiyi paketleyip (`.crx`) bir `update.xml` ile kendi sunucundan yayınla.
- Windows/registry veya Google Workspace politikası ile `ExtensionInstallForcelist`
  girdisine `<extension_id>;<update_url>` ekle.

### B) Geliştirici modunda "paketlenmemiş yükle" (test/az sayıda makine)
1. Chrome'da `chrome://extensions` aç, "Geliştirici modu"nu aç.
2. "Paketlenmemiş öğe yükle" ile `apps/extension/dist` klasörünü seç.

### C) Unlisted (listelenmeyen) Web Store öğesi (alternatif)
Link ile paylaşılan, aramada çıkmayan bir Web Store girdisi. Yine incelemeden geçer;
Ağustos 2026 politikası nedeniyle (AI servis kısıtlamalarını aşma) risk taşır — bu
yüzden A veya B tercih edilir.

## 4. Bir aboneyi etkinleştir (onboarding)

### Yöntem 1: Operatör CLI'si
```bash
pnpm --filter @grokbot/backend issue-code kullanici@ornek.com 1000
```
Bu komut kullanıcıyı hazırlar, 1000 kredi yükler, tek kullanımlık bir aktivasyon kodu
üretir ve **Grok botuna yapıştırılacak talimatı** ekrana yazar.

### Yöntem 2: Admin API'si
```bash
curl -X POST "$PUBLIC_BACKEND_URL/admin/activation-codes" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"email":"kullanici@ornek.com"}'
```
Yanıt `activationCode` ve hazır `installPrompt` içerir. Kredi yüklemek için:
```bash
curl -X POST "$PUBLIC_BACKEND_URL/admin/credits" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"email":"kullanici@ornek.com","credits":1000}'
```

Ödemeler Lemon Squeezy ile otomatikleştirildiğinde, kredi yükleme webhook üzerinden
kendiliğinden yapılır (bkz. `docs/DESIGN.md` M2).

## 5. Botta etkinleştirme

Üretilen kurulum talimatını Grok botuna yapıştır. Bot:
1. Eklentiyi kurar/etkinleştirir,
2. Popup'ta Backend URL + aktivasyon kodunu girer,
3. "Etkinleştir"e basar; kalan kredi görününce hazırdır.

Bundan sonra sayfalardaki CAPTCHA'lar (reCAPTCHA v2/v3, Cloudflare Turnstile) otomatik
çözülür; oturum düşüp yeniden CAPTCHA çıktığında da otomatik devreye girer.
