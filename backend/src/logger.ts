import pino from 'pino';
import { privateImageContext, privateImageLogFields } from './user-import/media/privacy';

function levelFromEnv(): string {
  return process.env.LOG_LEVEL || 'info';
}

export const logger = pino({
  hooks: { logMethod(args, method) {
    if (privateImageContext.getStore()) {
      const fields=typeof args[0]==='object' && args[0]!==null ? privateImageLogFields(args[0] as Record<string,unknown>) : {};
      method.call(this,fields,'private_image.event');
    } else method.apply(this,args);
  } },
  level: levelFromEnv(),
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
});
