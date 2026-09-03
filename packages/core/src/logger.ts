export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  child(bindings: Record<string, unknown>): Logger;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/**
 * Structured JSON to stderr. stdout is reserved: agents speak protocol on it and
 * the CLI writes machine-readable results to it, so nothing else may touch it.
 */
export function createLogger(
  level: LogLevel = (process.env.BELLWETHER_LOG_LEVEL as LogLevel) ?? 'info',
  bindings: Record<string, unknown> = {},
): Logger {
  const emit = (lvl: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (ORDER[lvl] < ORDER[level]) return;
    const line = { ts: new Date().toISOString(), level: lvl, msg: message, ...bindings, ...fields };
    process.stderr.write(`${JSON.stringify(line)}\n`);
  };
  return {
    child: (extra) => createLogger(level, { ...bindings, ...extra }),
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}
