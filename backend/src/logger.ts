import pino from 'pino';

function levelFromEnv(): string {
  return process.env.LOG_LEVEL || 'info';
}

export const logger = pino({
  level: levelFromEnv(),
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
});
