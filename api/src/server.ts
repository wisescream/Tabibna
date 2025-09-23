import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import helmet from 'helmet';
import dotenv from 'dotenv';
import authRouter from './routes/auth';
import practitionersRouter from './routes/practitioners';
import practitionersMeRouter from './routes/practitioners.me';
import reservationsRouter from './routes/reservations';
import webhooksRouter from './routes/webhooks';
import { rateLimit } from './middleware/rateLimit';
import * as Sentry from '@sentry/node';
import promClient from 'prom-client';

dotenv.config();

export function createServer() {
  const app = express();

  // Sentry init (no-op if DSN missing)
  if (process.env.SENTRY_DSN) {
    Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
    const S: any = Sentry as any;
    if (S?.Handlers?.requestHandler) {
      app.use(S.Handlers.requestHandler());
    }
  }

  app.use(helmet());
  app.use(cors());
  app.set('trust proxy', 1);
  // For webhooks, we need the raw body to compute the HMAC signature
  app.use('/v1/webhooks', express.raw({ type: '*/*', limit: '1mb' }));
  // JSON parser for everything else (skip webhooks so raw body is preserved)
  app.use((req, res, next) => {
    if (req.path.startsWith('/v1/webhooks')) return next();
    return (express.json({ limit: '1mb' }) as any)(req, res, next);
  });
  app.use(pinoHttp({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  }));

  app.get('/health', (_req: Request, res: Response) => res.status(200).send('ok'));
  // Prometheus metrics
  const register = new promClient.Registry();
  promClient.collectDefaultMetrics({ register });
  app.get('/metrics', async (_req: Request, res: Response) => {
    res.set('Content-Type', register.contentType);
    res.send(await register.metrics());
  });

  app.use('/v1/auth', rateLimit({ windowMs: 60_000, max: 20 }), authRouter);
  app.use('/v1/webhooks', webhooksRouter);
  // Mount more specific route first to avoid shadowing by generic /:id route
  app.use('/v1/practitioners/me', practitionersMeRouter);
  app.use('/v1/practitioners', practitionersRouter);
  app.use('/v1/reservations', reservationsRouter);

  // Not Found
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'Not Found', path: req.path });
  });

  // Error handler
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.name === 'ZodError' || err?.issues) {
      return res.status(400).json({ error: 'ValidationError', details: err.issues || err });
    }
    console.error(err);
    return res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}
