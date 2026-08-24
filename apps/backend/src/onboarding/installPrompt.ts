export interface InstallPromptOptions {
  activationCode: string;
  backendUrl: string;
  /** Eklentinin kurulum/indirme adresi (Web Store linki, kurumsal politika notu vб.). */
  extensionUrl?: string;
}

/**
 * Grok botuna kopyala-yapıştır verilecek, doğal dilde kurulum + etkinleştirme talimatı.
 * Kullanıcı bu bloğu bota verir; bot adımları izleyerek eklentiyi kurup aboneliğini başlatır.
 */
export function buildInstallPrompt(opts: InstallPromptOptions): string {
  const extensionStep = opts.extensionUrl
    ? `1. Chrome'da eklentiyi kur: ${opts.extensionUrl}
   (Kurumsal zorunlu kurulum kullanılıyorsa eklenti zaten yüklüdür; bu adımı atla.)`
    : `1. "Grok Bot CAPTCHA Solver" eklentisinin bu bilgisayarda kurulu olduğundan emin ol
   (kurumsal zorunlu kurulum ile önceden dağıtılmış olmalı).`;

  return `Grok Bot CAPTCHA Solver kurulum ve etkinleştirme talimatı:

${extensionStep}
2. Chrome araç çubuğundaki "Grok CAPTCHA Çözücü" simgesine tıkla.
3. "Backend URL" alanına şunu yaz: ${opts.backendUrl}
4. "Aktivasyon kodu" alanına şu kodu yaz: ${opts.activationCode}
5. "Etkinleştir" düğmesine bas. "Cihaz etkinleştirildi" mesajını ve kalan krediyi görmelisin.
6. Bu andan itibaren sayfalardaki CAPTCHA'lar otomatik çözülecek. Kredi bittiğinde çözme durur ve yeni kredi yüklenene kadar beklenir.

Not: Aktivasyon kodu tek kullanımlıktır ve yalnızca bu cihaza bağlanır. Kodu başka biriyle paylaşma.`;
}
