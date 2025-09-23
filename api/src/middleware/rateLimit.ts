import { Request, Response, NextFunction } from 'express';

type KeyFn = (req: Request) => string;

interface Bucket {
  hits: number;
  resetAt: number;
}

export function rateLimit({ windowMs, max, keyGenerator }: { windowMs: number; max: number; keyGenerator?: KeyFn }) {
  const store = new Map<string, Bucket>();
  const keyFn: KeyFn = keyGenerator || ((req) => (req.ip || req.headers['x-forwarded-for']?.toString() || 'anon'));

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = keyFn(req);
    const bucket = store.get(key);
    if (!bucket || bucket.resetAt <= now) {
      store.set(key, { hits: 1, resetAt: now + windowMs });
      return next();
    }
    if (bucket.hits < max) {
      bucket.hits += 1;
      return next();
    }
    const retryAfter = Math.max(0, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too Many Requests' });
  };
}
