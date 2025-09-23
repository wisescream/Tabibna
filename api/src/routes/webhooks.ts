import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

function verifyHmac(secret: string, rawBody: Buffer | undefined, signature: string | undefined): boolean {
  if (!secret || !signature || !rawBody) return false;
  try {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signature, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function normalizeSigHeader(sig: string): string {
  // Accept formats like "sha256=<hex>" or raw hex
  const s = sig.trim();
  const idx = s.indexOf('=');
  if (idx > -1) {
    return s.slice(idx + 1).trim();
  }
  return s;
}

// Stricter rate limit for webhooks (10 req/min per IP)
router.use(rateLimit({ windowMs: 60_000, max: 10 }));

// Payment webhook (HMAC)
router.post('/payment', async (req: Request, res: Response) => {
  const sigHeader = normalizeSigHeader((req.headers['x-signature'] || req.headers['x-hub-signature'] || req.headers['x-signature-sha256'] || '').toString());
  const secret = process.env.PAYMENT_WEBHOOK_SECRET || '';
  const raw = (req as any).body as Buffer;
  if (!verifyHmac(secret, raw, sigHeader)) return res.status(401).json({ error: 'Invalid signature' });
  // Parse JSON after signature verification
  let parsed: any = {};
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    // keep as empty object if parsing fails
  }
  try {
    await prisma.notifications.create({
      data: {
        user_id: BigInt(0),
        type: 'webhook',
        channel: 'payment',
        payload: parsed as any,
        status: 'received',
      } as any,
    });
  } catch (e) {
    // ignore DB errors in webhook MVP
  }
  return res.json({ ok: true });
});

// SMS provider webhook (delivery status)
router.post('/provider/sms', async (req: Request, res: Response) => {
  const sigHeader = normalizeSigHeader((req.headers['x-signature'] || req.headers['x-hub-signature'] || req.headers['x-signature-sha256'] || '').toString());
  const secret = process.env.SMS_WEBHOOK_SECRET || '';
  const raw = (req as any).body as Buffer;
  if (!verifyHmac(secret, raw, sigHeader)) return res.status(401).json({ error: 'Invalid signature' });
  let parsed: any = {};
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch { }
  try {
    await prisma.notifications.create({
      data: {
        user_id: BigInt(0),
        type: 'webhook',
        channel: 'sms',
        payload: parsed as any,
        status: 'received',
      } as any,
    });
  } catch { }
  return res.json({ ok: true });
});

export default router;
