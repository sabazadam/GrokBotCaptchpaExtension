/**
 * Global bütçe devre kesici: bir yazılım hatası veya kötüye kullanım dalgası
 * Capsolver bütçenizi yakmasın diye kayan pencerede toplam harcamayı sınırlar.
 * Eşik aşılırsa yeni çözümler reddedilir (kesici "açık").
 */
export class BudgetCircuitBreaker {
  private events: Array<{ t: number; cost: number }> = [];

  constructor(
    private readonly windowMs: number,
    private readonly maxSpend: number,
  ) {}

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    let i = 0;
    while (i < this.events.length && (this.events[i]?.t ?? 0) < cutoff) i++;
    if (i > 0) this.events.splice(0, i);
  }

  currentSpend(now: number = Date.now()): number {
    this.prune(now);
    let sum = 0;
    for (const e of this.events) sum += e.cost;
    return sum;
  }

  /** Bu maliyetin harcanmasının eşiği aşıp aşmayacağını kontrol eder. */
  canSpend(cost: number, now: number = Date.now()): boolean {
    return this.currentSpend(now) + cost <= this.maxSpend;
  }

  /** Gerçekleşen harcamayı kaydeder (settle sırasında). */
  record(cost: number, now: number = Date.now()): void {
    if (cost <= 0) return;
    this.events.push({ t: now, cost });
  }

  isOpen(now: number = Date.now()): boolean {
    return this.currentSpend(now) >= this.maxSpend;
  }
}
