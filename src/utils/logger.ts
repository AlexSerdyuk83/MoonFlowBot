interface LogMeta {
  [key: string]: unknown;
}

function write(level: 'INFO' | 'WARN' | 'ERROR', message: string, meta?: LogMeta): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta ?? {})
  };

  if (level === 'ERROR') {
    console.error(JSON.stringify(payload));
    return;
  }

  console.log(JSON.stringify(payload));
}

export const logger = {
  info: (message: string, meta?: LogMeta) => write('INFO', message, meta),
  warn: (message: string, meta?: LogMeta) => write('WARN', message, meta),
  error: (message: string, meta?: LogMeta) => write('ERROR', message, meta)
};
