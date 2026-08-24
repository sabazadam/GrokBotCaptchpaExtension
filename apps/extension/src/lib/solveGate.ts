/**
 * Content script'in aynı CAPTCHA için eşzamanlı / sık yeniden denemesini keser.
 * Başarısız çözümden sonra kısa cooldown, operatör sağlayıcı bakiyesinin
 * MutationObserver döngüsüyle yakılmasını önler.
 */
export class SolveGate {
  private readonly inFlight = new Set<string>();
  private readonly solved = new Set<string>();
  private readonly cooldownUntil = new Map<string, number>();

  constructor(private readonly cooldownMs: number) {}

  tryBegin(key: string, now = Date.now()): boolean {
    if (this.solved.has(key) || this.inFlight.has(key)) return false;
    if ((this.cooldownUntil.get(key) ?? 0) > now) return false;
    this.inFlight.add(key);
    return true;
  }

  markSolved(key: string): void {
    this.inFlight.delete(key);
    this.solved.add(key);
    this.cooldownUntil.delete(key);
  }

  markFailed(key: string, now = Date.now()): void {
    this.inFlight.delete(key);
    this.cooldownUntil.set(key, now + this.cooldownMs);
  }
}
