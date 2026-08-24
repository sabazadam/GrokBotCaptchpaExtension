export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  base?: Record<string, unknown>;
  sink?: (line: string) => void;
}

/** Basit, bağımsız JSON satır logger'ı (yapılandırılmış log). */
export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const min = ORDER[level];
  const base = options.base ?? {};
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));

  const emit = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (ORDER[lvl] < min) return;
    sink(
      JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...base, ...(fields ?? {}) }),
    );
  };

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (fields) => createLogger({ level, base: { ...base, ...fields }, sink }),
  };
}

/** Hiçbir şey yazmayan logger (testler için). */
export function silentLogger(): Logger {
  return createLogger({ level: "error", sink: () => {} });
}
