/**
 * Tiny structured logger. Emits JSON lines so they are queryable in CloudWatch.
 */
type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVELS: Record<Level, number> = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
const configured = (process.env.LOG_LEVEL ?? 'INFO').toUpperCase() as Level;
const threshold = LEVELS[configured] ?? LEVELS.INFO;

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold) return;
  const line = { level, message, timestamp: new Date().toISOString(), ...context };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('DEBUG', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit('INFO', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit('WARN', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('ERROR', msg, ctx),
};
