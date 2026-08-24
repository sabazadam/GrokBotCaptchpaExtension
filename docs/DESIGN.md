# Grok Bot CAPTCHA Extension — Sistem Tasarımı

> Durum: Taslak (v0.1) — tartışma ve onay için hazırlandı.
> Bu doküman kod yazılmadan önce mimariyi, güvenlik modelini, kredi/ödeme akışını,
> kurulum deneyimini ve aşamalı yol haritasını netleştirmek için hazırlanmıştır.

---

## 1. Amaç

Grok botlarının (bilgisayarı/tarayıcıyı otomatik kullanan AI ajanları) günlük
otomasyonlarında karşılaştıkları CAPTCHA'ları **otomatik** olarak, insan
müdahalesine gerek kalmadan çözen bir Chrome eklentisi ve onu besleyen güvenli bir
backend geliştirmek.

Temel derdimiz: bot CAPTCHA'ya takıldığında otomasyon durup kullanıcıya bağımlı hale
geliyor. Eklenti bu bağımlılığı kırmalı; CAPTCHA sayfada belirdiğinde (ör. kinguin.net
girişinde veya oturum düştükten sonra yeniden girişte) eklenti onu kendiliğinden
tespit edip çözmeli.

## 2. Kısıtlar ve Kabuller (kullanıcı ile netleştirildi)

- **Kitle:** Başlangıçta yalnızca kendi botlarımız için, **ama mimari en baştan çok
  kiracılı (multi-tenant) SaaS gibi** kurulacak — ileride başkalarına satılabilecek.
- **Dağıtım:** Halka açık Chrome Web Store zorunluluğu yok. Grok botlarına kurulumu
  **kopyala-yapıştır bir talimatla** basitleştireceğiz. Kullanıcı bu talimatı bota
  verecek, bot adımları izleyerek eklentiyi kurup aboneliğini başlatacak.
- **CAPTCHA kaynağı:** Genel web otomasyonu (tek bir site değil). Somut örnek:
  kinguin.net girişindeki CAPTCHA ve oturum düşünce yeniden giriş. Kinguin Cloudflare
  arkasında → öncelik **Cloudflare Turnstile/Challenge + reCAPTCHA + hCaptcha**.
- **Ölçek:** ~100 abone, toplam en az ~1000 istek. Yani başlangıç için **mütevazı
  hacim** — altyapı sade ve ucuz tutulabilir.
- **Ödeme:** **Lemon Squeezy** (merchant of record; KDV/vergi ve chargeback'i üstlenir,
  Türkiye'den satış için uygun).
- **Teknoloji:** Bize bırakıldı — aşağıdaki önerilen yığın.

## 3. En Kritik İlke: Güvenlik backend'de yaşar, eklentide değil

Projenin en kırılgan noktası API anahtarı ve kredi yönetimi. İki demir kural:

1. **Capsolver API anahtarı ASLA eklentiye konmaz.** Chrome eklentileri kullanıcı
   makinesinde düz metindir; anahtar sızarsa tek bir abone değil tüm bütçe yanar.
2. **Kredi bakiyesi, hız limiti ve yetki kararları ASLA eklentide tutulmaz.** İstemci
   tarafı her zaman manipüle edilebilir. Bunların hepsi sunucuda, tek doğru kaynakta
   (single source of truth) tutulur.

Sonuç: **Eklenti ince istemcidir (thin client).** Tüm zekâ backend'dedir; eklenti
sadece CAPTCHA'yı sayfada tespit eder, parametreleri backend'e iletir ve dönen çözümü
sayfaya enjekte eder.

## 4. Yüksek Seviye Mimari

```
                 (kullanıcı cihaz token'ı, HTTPS)          (gizli API anahtarı)
  ┌───────────────────┐        ┌──────────────────────────┐        ┌────────────┐
  │  Chrome Eklentisi │ ─────▶ │        BACKEND API        │ ─────▶ │  Capsolver │
  │  (Grok bot makinesi)       │  - kimlik doğrulama        │        └────────────┘
  │  - CAPTCHA tespiti │ ◀───── │  - kredi rezervasyon/settle│ ◀─────   (token)
  │  - token enjekte   │(çözüm) │  - hız/eşzamanlılık limiti │
  └───────────────────┘        │  - global bütçe kesici     │
                               │  - kullanım logu           │
                               └───────────┬────────────────┘
                                           │
                          ┌────────────────┼───────────────────┐
                          ▼                ▼                   ▼
                   ┌────────────┐   ┌──────────────┐   ┌──────────────────┐
                   │ PostgreSQL │   │ Lemon Squeezy│   │  Dashboard (web) │
                   │ kullanıcı, │   │  webhook →   │   │  hesap, kredi,   │
                   │ kredi defteri  │  kredi yükleme │   │ aktivasyon kodu  │
                   │ solve logları  └──────────────┘   │  + kurulum promptu│
                   └────────────┘                      └──────────────────┘
```

## 5. Güvenlik Mimarisi (kalp)

### 5.1 Anahtar izolasyonu
Eklenti Capsolver'ı hiç görmez; yalnızca bizim API'mizle konuşur. Anahtar backend
ortam değişkeninde/secret manager'da durur. Başlangıçta tek anahtar yeterli; ileride
çoklu anahtar + rotasyon eklenebilir (yol haritası).

### 5.2 Kredi defteri (ledger) — "reserve → settle/refund" deseni
Her çözüm isteği finansal bir işlemdir. Yarış koşulu ve çifte harcama olmaması için:

1. **Rezerve et (atomik):**
   ```sql
   UPDATE credit_accounts
   SET balance = balance - :cost
   WHERE user_id = :uid AND balance >= :cost
   RETURNING balance;
   ```
   Hiç satır dönmezse → `402 Insufficient credits`.
2. **Capsolver'ı çağır** (createTask → getTaskResult poll).
3. **Başarılıysa settle:** solve `solved` işaretlenir, ledger'a `-cost / reason=solve`
   satırı yazılır.
4. **Başarısız/timeout ise refund:** rezerve edilen kredi geri eklenir
   (`balance = balance + :cost`), solve `failed`, ledger'a `+cost / reason=refund`.
   → **Kullanıcı başarısız çözüm için ücretlendirilmez.** (Capsolver bazı türlerde
   başarısızlıkta bile ücret alabilir; bu maliyet bize aittir, kullanıcıya
   yansıtılmaz.)

`credit_ledger` **append-only** (denetlenebilir); `credit_accounts.balance` ise atomik
kontrol için materyalize edilmiş bakiyedir. İkisi mutabık kalır.

### 5.3 Kullanıcı başına izolasyon (bir abone diğerlerini/sistemi çökertemez)
- **Hız limiti:** kullanıcı başına token-bucket (ör. N istek/dakika, yapılandırılabilir).
- **Eşzamanlılık limiti:** aynı anda en fazla K açık çözüm (ör. 5).
- **Günlük tavan:** kullanıcı başına günlük maksimum çözüm.
Bir kullanıcı ne kadar zorlarsa zorlasın yalnızca kendi kotasını tüketir.

### 5.4 Global bütçe kesici (senin Capsolver hesabını korur)
Bir yazılım hatası veya kötüye kullanım dalgası tüm bütçeyi yakmasın diye:
- Kayan pencerede toplam Capsolver harcaması izlenir.
- Eşik aşılırsa yeni çözümler otomatik durur (**circuit breaker**) + alarm.
Bu, "bir kullanıcının aşırı kullanımı tüm sistemimi/bucket'larımı çökertmesin"
endişesinin son güvenlik ağıdır.

### 5.5 Idempotency
Eklenti bağlantı kopunca isteği tekrarlayabilir. Her solve isteği bir
`idempotency_key` taşır; aynı anahtarla gelen tekrar isteği aynı sonucu döner ve
**iki kez ücretlendirmez**.

## 6. Veri Modeli (PostgreSQL, ilk taslak)

- **users** — `id, email, lemonsqueezy_customer_id, status, created_at`
- **devices** — `id, user_id, device_token_hash, label, last_seen_at, revoked_at`
  (koltuk/cihaz bağlama; token yalnızca **hash'lenmiş** saklanır)
- **credit_accounts** — `user_id (PK), balance_credits, updated_at`
- **credit_ledger** — `id, user_id, delta_credits, reason (topup|solve|refund|adjust),
  ref, created_at` (append-only denetim kaydı)
- **solves** — `id, user_id, device_id, captcha_type, website_url, cost_credits,
  capsolver_task_id, status (pending|solved|failed), idempotency_key, created_at,
  resolved_at`
- **activation_codes** — `code_hash, user_id, used_at, device_id, expires_at`
  (tek kullanımlık, cihaza bağlanır)
- **webhook_events** — `id, provider, event_id (unique), payload, processed_at`
  (Lemon Squeezy webhook'larının idempotent işlenmesi)

## 7. Çözüm (Solve) Akışı

```
Eklenti (content script)            Backend                         Capsolver
   │  CAPTCHA tespit                    │                               │
   │  {type, url, sitekey, ...}         │                               │
   │──────── POST /v1/solve ──────────▶│                               │
   │  (Authorization: device token,    │  1. token doğrula → user      │
   │   Idempotency-Key)                │  2. hız/eşzamanlılık/kota      │
   │                                   │  3. maliyeti hesapla (tür bazlı)│
   │                                   │  4. krediyi ATOMİK rezerve et │
   │                                   │  5. global bütçe kesici        │
   │                                   │────── createTask ────────────▶│
   │                                   │◀───── taskId ─────────────────│
   │                                   │──── getTaskResult (poll) ─────▶│
   │                                   │◀───── token/çözüm ────────────│
   │                                   │  6a. başarı → settle + logla  │
   │                                   │  6b. hata   → refund + logla  │
   │◀──────── {token} veya {error} ────│                               │
   │  token'ı sayfaya enjekte et       │                               │
```

Content script, CAPTCHA'nın **her belirişinde** (yeniden giriş, oturum düşmesi dahil)
otomatik tetiklenir; bunun için `MutationObserver` ile sürekli DOM gözlemi yapılır.
Böylece "oturum düşünce elle CAPTCHA çözme" derdi ortadan kalkar.

## 8. Kredi ve Fiyatlandırma Modeli

- Birim: **kredi**. Lemon Squeezy'de **kredi paketleri** satılır (min. 10 USD paket).
- Farklı CAPTCHA türlerinin Capsolver maliyeti farklıdır → **tür bazlı kredi maliyeti
  tablosu** tutulur. (Rakamlar Capsolver'ın **canlı** fiyatlarına göre kalibre
  edilecek; aşağıdakiler yer tutucudur.)

| CAPTCHA türü            | Capsolver maliyeti (kalibre edilecek) | Kredi maliyeti | Not |
|-------------------------|----------------------------------------|----------------|-----|
| reCAPTCHA v2            | TBD                                    | TBD            | Öncelik (kinguin) |
| reCAPTCHA v3 / Enterprise | TBD                                  | TBD            | Öncelik (kinguin) |
| Cloudflare Turnstile    | TBD                                    | TBD            |     |
| GeeTest v3/v4           | TBD                                    | TBD            |     |
| AWS WAF                 | TBD                                    | TBD            |     |
| ImageToText (OCR)       | TBD                                    | TBD            |     |
| Cloudflare Challenge    | TBD                                    | TBD            | Proxy modeli (Faz 2) |

- Kredi→USD kuru, **her türün gerçek maliyetinin üstünde marj** bırakacak şekilde
  belirlenir; başarısız denemeler için tampon eklenir.
- Kâr/maliyet takibi tür bazında yapılır (aksi halde bazı türlerde zarar riski).

## 9. Kimlik Doğrulama ve Cihaz Bağlama

- **Statik "benzersiz kod" yerine hesap + cihaz token'ı.** Statik kodlar paylaşılır/sızar.
- Akış: kullanıcı dashboard'da **tek kullanımlık, cihaza bağlanan aktivasyon kodu**
  üretir → eklentiye girer → backend kodu doğrular, bir `device` kaydı oluşturur ve
  **iptal edilebilir (revocable) cihaz token'ı** döner (yalnızca hash'i saklanır).
- Her istek bu token ile yapılır. Abonelik biterse/cihaz kaldırılırsa token iptal
  edilir. **Koltuk (seat) sınırı** ile bir abonelik = N cihaz.

## 10. Kurulum ve Onboarding (kopyala-yapıştır Grok promptu)

Amaç: kullanıcı tek bir talimat bloğunu bota verip kolayca kursun.

**Dağıtım seçenekleri (makineler bizim kontrolümüzde olduğu için Web Store şart değil):**
- **A) Kurumsal zorunlu kurulum (önerilen — kontrol ettiğimiz makineler için):**
  Chrome `ExtensionInstallForcelist` politikası + kendi barındırdığımız güncelleme
  URL'si (self-hosted `update.xml` + `.crx`). Store incelemesini ve politika riskini
  tamamen atlar. Makine başına tek seferlik bir kurulum scripti gerekir.
- **B) Unlisted (listelenmeyen) Web Store öğesi:** link ile paylaşılır, aramada
  çıkmaz; yine incelemeden geçer (politika riski sürer, aşağıya bakınız).

**Onboarding akışı:**
1. Kullanıcı dashboard'da giriş yapar, kredi paketi satın alır (Lemon Squeezy).
2. Dashboard bir **aktivasyon kodu** ve **bota verilecek hazır talimat bloğu** üretir.
3. Kullanıcı bu talimatı Grok botuna yapıştırır; bot: eklentiyi kurar/etkinleştirir →
   popup'ta aktivasyon kodunu girer → kredi bakiyesi görününce hazırdır.

## 11. CAPTCHA Tespiti ve Desteklenen Türler (Capsolver canlı dokümanına göre)

> **Önemli düzeltme:** Capsolver'ın **güncel resmi dokümanında hCaptcha ve
> FunCaptcha/Arkose artık listelenmiyor** (ilgili sayfalar 404 dönüyor). Bu yüzden
> tasarımda bu ikisine güvenmiyoruz. Aşağıdaki tablo `docs.capsolver.com` üzerinden
> doğrulanmış güncel türleri ve `createTask > task.type` değerlerini içerir.

**Çözüm modelleri:**
- **token (async):** `createTask` → `getTaskResult` polling ile token alınır; eklenti
  token'ı sayfaya enjekte eder. **Tarayıcı eklentisi için ideal model.**
- **recognition (senkron):** `createTask` sonucu doğrudan döner (görsel/OCR).
- **proxy-cookie (async):** proxy zorunlu, sonuç bir cookie (ör. `cf_clearance`).
  Bu model **scraping** içindir; canlı tarayıcı oturumuna uydurmak zordur → Faz 2.

| CAPTCHA türü | `task.type` (proxyless) | Model | Zorunlu parametreler | Çözüm alanı | Eklenti uyumu |
|---|---|---|---|---|---|
| reCAPTCHA v2 (+ Enterprise) | `ReCaptchaV2TaskProxyLess` (`ReCaptchaV2EnterpriseTaskProxyLess`) | token | `websiteURL`, `websiteKey` | `solution.gRecaptchaResponse` | Tam |
| reCAPTCHA v3 (+ Enterprise) | `ReCaptchaV3TaskProxyLess` (`ReCaptchaV3EnterpriseTaskProxyLess`) | token | `websiteURL`, `websiteKey`, `pageAction` | `solution.gRecaptchaResponse` | Tam |
| Cloudflare Turnstile | `AntiTurnstileTaskProxyLess` | token | `websiteURL`, `websiteKey` (ops. `metadata.action`/`cdata`) | `solution.token` | Tam |
| GeeTest v3/v4 | `GeeTestTaskProxyLess` | token | v3: `gt`+`challenge`; v4: `captchaId` (+`websiteURL`) | v3: `validate`/`seccode`; v4: `captcha_output`/`lot_number`/`pass_token` | Uyumlu |
| AWS WAF | `AntiAwsWafTaskProxyLess` | token/cookie | `websiteURL` (ops. `awsKey`/`awsIv`/`awsContext`…) | `solution.cookie` (`aws-waf-token`) | Kısmi (cookie enjeksiyonu) |
| ImageToText (OCR) | `ImageToTextTask` | recognition | `body` (base64 görsel) | `solution.text` | Uyumlu (görsel yakala→gönder) |
| Cloudflare Challenge ("Just a moment") | `AntiCloudflareTask` | proxy-cookie | `websiteURL`, `proxy` (zorunlu) | `solution.cookies.cf_clearance` | **Sınırlı (Faz 2)** |
| MTCaptcha / DataDome / BotDeflector / VisionEngine | destek listesinde var | değişken | dokümandan doğrulanacak | — | Roadmap |

**Eklenti tespiti (content script):** global JS nesneleri (`grecaptcha`, `turnstile`),
iframe `src` desenleri (`google.com/recaptcha`, `challenges.cloudflare.com`) ve DOM
öznitelikleri (`.g-recaptcha[data-sitekey]`, `.cf-turnstile[data-sitekey]`) taranarak
tür + `sitekey` + (v3 için) `action` çıkarılır. `MutationObserver` ile yeniden beliren
CAPTCHA'lar (oturum düşmesi/yeniden giriş) otomatik yakalanır.

**Öncelik sırası (kinguin reCAPTCHA v2/v3 kullanıyor + genel web):**
1. reCAPTCHA v2 / v3
2. Cloudflare Turnstile
3. ImageToText (OCR)
4. GeeTest, AWS WAF
5. Cloudflare Challenge / DataDome (proxy modeli — Faz 2)

## 12. Önerilen Teknoloji Yığını

**Ortak dil: TypeScript** (eklenti + backend aynı dil → paylaşılan tipler, daha az hata).

- **Backend:** Node.js + **Fastify** (sade, hızlı, iyi TS desteği).
- **Veritabanı:** **PostgreSQL** (atomik kredi işlemleri, transaction, satır kilidi).
- **DB katmanı:** **Drizzle** (SQL-first, TS) — finansal ledger'da açık kontrol için.
- **Kimlik/token:** iptal edilebilir opak token'lar (hash'li DB kaydı).
- **Ödeme:** **Lemon Squeezy** + imza doğrulamalı webhook'lar.
- **Eklenti:** Manifest V3 + **WXT** framework (modern MV3 DX) + TypeScript.
- **Dashboard:** hafif bir web (aynı backend + basit bir SPA veya SSR sayfa).
- **Hız/eşzamanlılık limiti:** başlangıçta tek instance için Postgres/in-memory;
  yatay ölçeklenince **Redis (Upstash)** eklenir. (1000 istek için başta gerekmez.)
- **Hosting (mütevazı ölçek, düşük ops):** backend için **Fly.io** veya **Railway**;
  DB için **Neon** yönetilen Postgres; `.crx`/`update.xml` için statik host veya GitHub
  Releases.
- **Gözlemlenebilirlik:** yapılandırılmış log (**pino**), hata takibi (**Sentry**),
  metrikler + harcama sıçramasında alarm.

## 13. Repo Yapısı (monorepo, pnpm workspaces)

```
/apps
  /backend      Fastify API + Lemon Squeezy webhook + Capsolver proxy + dashboard
  /extension    WXT Manifest V3 eklentisi
/packages
  /shared       Ortak TS tipleri (API sözleşmesi, captcha tür enum'ları, hata kodları)
/docs
  DESIGN.md     (bu doküman)
```

## 14. Riskler ve Açık Konular

- **Chrome Web Store politikası (yüksek risk):** 1 Ağustos 2026'da yürürlüğe giren yeni
  politika, "**AI destekli servislerin güvenlik önlemlerini/kullanım kısıtlamalarını
  aşmak için tasarlanmış**" eklentileri açıkça yasaklıyor. Grok otomasyonu için CAPTCHA
  aşan bir eklenti bu tanıma girebilir → halka açık listeleme reddi/kaldırma ve hatta
  geliştirici hesabı feshi riski. **Azaltma:** halka açık store yerine kurumsal
  zorunlu kurulum / self-hosted dağıtım (Bölüm 10-A).
- **Hedef platform ToS'u:** Otomasyon + CAPTCHA aşımı, hedef sitelerin kullanım
  şartlarını ihlal edebilir → son kullanıcı hesap banı riski. (CAPTCHA çözme
  servislerinin kendisi yasal; risk kombinasyonda.)
- **Veri koruma (KVKK/GDPR):** Toplanan her veri "tek amaç için gerekli" olmalı ve
  açıkça bildirilmelidir. Minimum veri (e-posta, kullanım logu) topla, gizlilik metni
  hazırla.
- **Kredi kalibrasyonu:** Tür bazlı maliyet/marj, Capsolver'ın canlı fiyatlarına göre
  ayarlanmalı (Bölüm 8).

## 15. Aşamalı Yol Haritası

- **M0 — Temeller:** monorepo, shared tipler, DB şeması, Capsolver istemci sarmalayıcı,
  config/secrets yönetimi.
- **M1 — Backend çekirdeği (güvenliğin kalbi):** cihaz token auth, kredi defteri
  (atomik reserve/settle/refund), kullanıcı başına hız/eşzamanlılık/kota, global bütçe
  kesici, `POST /v1/solve` proxy, kullanım logu. **Önce bu kurulur ve sağlamlaştırılır.**
- **M2 — Ödeme:** Lemon Squeezy ürünleri + imza doğrulamalı webhook → kredi yükleme,
  idempotent webhook işleme, bakiye API'si.
- **M3 — Eklenti MVP:** WXT MV3, popup (aktivasyon kodu + kredi + aç/kapa), background
  worker, content-script tespiti (reCAPTCHA v2/v3, Cloudflare Turnstile), çözüm
  orkestrasyonu + token enjeksiyonu. **kinguin.net üzerinde test.**
- **M4 — Onboarding/kurulum:** dashboard'da aktivasyon kodu üretimi, kopyala-yapıştır
  Grok bot talimatı, dağıtım (zorunlu kurulum/unlisted).
- **M5 — Gözlemlenebilirlik & sağlamlaştırma:** metrikler, harcama alarmları, Sentry,
  ~1000 istek yük testi, kötüye kullanım senaryoları.
- **M6 — Kapsam genişletme:** GeeTest, AWS WAF, ImageToText (OCR), ardından proxy modeli
  gerektirenler (Cloudflare Challenge, DataDome) ve MTCaptcha/BotDeflector.
