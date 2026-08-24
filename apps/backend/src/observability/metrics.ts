export interface MetricsSnapshot {
  solvesTotal: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  errorsByCode: Record<string, number>;
  spendCreditsTotal: number;
}

function inc(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

/** Kümülatif çalışma-zamanı metrikleri (/metrics ucundan sunulur). */
export class Metrics {
  private solvesTotal = 0;
  private readonly byStatus: Record<string, number> = {};
  private readonly byType: Record<string, number> = {};
  private readonly errorsByCode: Record<string, number> = {};
  private spendCreditsTotal = 0;

  recordSolve(type: string, status: "solved" | "failed", cost: number): void {
    this.solvesTotal += 1;
    inc(this.byStatus, status);
    inc(this.byType, type);
    if (status === "solved") this.spendCreditsTotal += cost;
  }

  recordError(code: string): void {
    inc(this.errorsByCode, code);
  }

  snapshot(): MetricsSnapshot {
    return {
      solvesTotal: this.solvesTotal,
      byStatus: { ...this.byStatus },
      byType: { ...this.byType },
      errorsByCode: { ...this.errorsByCode },
      spendCreditsTotal: this.spendCreditsTotal,
    };
  }
}
