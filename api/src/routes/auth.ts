import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { hashPassword, verifyPassword } from '../utils/password';
import { signJwt } from '../utils/jwt';
import crypto from 'crypto';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  phone: z.string().min(6).optional(),
  password: z.string().min(6),
  role: z.enum(['patient', 'practitioner', 'admin']).default('patient'),
});

const loginSchema = z.object({
  emailOrPhone: z.string().min(3),
  password: z.string().min(6),
});

router.post('/register', async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, phone, password, role } = parsed.data;
  try {
    const existing = await prisma.users.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already in use' });
    const password_hash = await hashPassword(password);
    const user = await prisma.users.create({ data: { email, phone, password_hash, role } });

    // If practitioner, create empty profile stub
    if (role === 'practitioner') {
      await prisma.practitioners_profiles.create({ data: { user_id: user.id } });
    }

    const token = signJwt({ sub: String(user.id), role: user.role });
    const refreshRaw = crypto.randomBytes(32).toString('hex');
    const refreshHash = crypto.createHash('sha256').update(refreshRaw).digest('hex');
    const expiresAt = new Date(Date.now() + parseDurationMs(process.env.REFRESH_TOKEN_EXPIRES_IN || '30d'));
    await prisma.refresh_tokens.create({ data: { user_id: user.id, token_hash: refreshHash, expires_at: expiresAt } });

    return res.status(201).json(toJSONSafe({ user: sanitizeUser(user), token, refreshToken: refreshRaw }));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to register' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { emailOrPhone, password } = parsed.data;
  try {
    const user = await prisma.users.findFirst({ where: { OR: [{ email: emailOrPhone }, { phone: emailOrPhone }] } });
    if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signJwt({ sub: String(user.id), role: user.role });
    const refreshRaw = crypto.randomBytes(32).toString('hex');
    const refreshHash = crypto.createHash('sha256').update(refreshRaw).digest('hex');
    const expiresAt = new Date(Date.now() + parseDurationMs(process.env.REFRESH_TOKEN_EXPIRES_IN || '30d'));
    await prisma.refresh_tokens.create({ data: { user_id: user.id, token_hash: refreshHash, expires_at: expiresAt } });

    return res.json(toJSONSafe({ user: sanitizeUser(user), token, refreshToken: refreshRaw }));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to login' });
  }
});

router.post('/refresh', async (req: Request, res: Response) => {
  const refreshToken = (req.body?.refreshToken || '').toString();
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
  try {
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const record = await prisma.refresh_tokens.findFirst({ where: { token_hash: hash, revoked: false, expires_at: { gt: new Date() } } });
    if (!record) return res.status(401).json({ error: 'Invalid refresh token' });
    const user = await prisma.users.findUnique({ where: { id: record.user_id } });
    if (!user) return res.status(401).json({ error: 'Invalid refresh token' });

    // rotate
    await prisma.refresh_tokens.update({ where: { id: record.id }, data: { revoked: true } });
    const newRaw = crypto.randomBytes(32).toString('hex');
    const newHash = crypto.createHash('sha256').update(newRaw).digest('hex');
    const expiresAt = new Date(Date.now() + parseDurationMs(process.env.REFRESH_TOKEN_EXPIRES_IN || '30d'));
    await prisma.refresh_tokens.create({ data: { user_id: user.id, token_hash: newHash, expires_at: expiresAt } });

    const token = signJwt({ sub: String(user.id), role: user.role });
    return res.json(toJSONSafe({ token, refreshToken: newRaw }));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to refresh' });
  }
});

router.post('/forgot-password', (_req: Request, res: Response) => {
  // Backwards-compatible stub if not yet configured
  return res.status(200).json({ status: 'ok' });
});

// Issue a reset token (short-lived) and persist hash; in real flow this would be triggered by /forgot-password handler
const requestResetSchema = z.object({ emailOrPhone: z.string().min(3) });
router.post('/request-password-reset', async (req: Request, res: Response) => {
  const parsed = requestResetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { emailOrPhone } = parsed.data;
  try {
    const user = await prisma.users.findFirst({ where: { OR: [{ email: emailOrPhone }, { phone: emailOrPhone }] } });
    if (!user) return res.status(200).json({ status: 'ok' }); // do not reveal existence
    const raw = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    // upsert into reset_tokens
    await prisma.reset_tokens.upsert({
      where: { user_id: user.id },
      update: { token_hash: hash, expires_at: expiresAt, used: false },
      create: { user_id: user.id, token_hash: hash, expires_at: expiresAt },
    });
    // TODO: enqueue email/SMS with raw token link/code
    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create reset token' });
  }
});

const resetSchema = z.object({ token: z.string().min(10), password: z.string().min(6) });
router.post('/reset-password', async (req: Request, res: Response) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { token, password } = parsed.data;
  try {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const record = await prisma.reset_tokens.findFirst({ where: { token_hash: hash, used: false, expires_at: { gt: new Date() } } });
    if (!record) return res.status(400).json({ error: 'Invalid or expired token' });
    const password_hash = await hashPassword(password);
    await prisma.$transaction([
      prisma.users.update({ where: { id: record.user_id }, data: { password_hash } }),
      prisma.reset_tokens.update({ where: { id: record.id }, data: { used: true } }),
      prisma.refresh_tokens.updateMany({ where: { user_id: record.user_id, revoked: false }, data: { revoked: true } }),
    ]);
    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

export default router;

function sanitizeUser(user: any) {
  const { password_hash, ...rest } = user;
  // Coerce BigInt IDs to string for JSON safety
  if (typeof (rest as any).id === 'bigint') {
    (rest as any).id = (rest as any).id.toString();
  }
  return rest;
}

function toJSONSafe(input: any): any {
  if (input === null || input === undefined) return input;
  if (typeof input === 'bigint') return input.toString();
  if (Array.isArray(input)) return input.map(toJSONSafe);
  if (typeof input === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(input)) out[k] = toJSONSafe(v);
    return out;
  }
  return input;
}

function parseDurationMs(input: string): number {
  // supports s,m,h,d
  const m = input.match(/^(\d+)([smhd])$/);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2];
  switch (unit) {
    case 's':
      return n * 1000;
    case 'm':
      return n * 60 * 1000;
    case 'h':
      return n * 60 * 60 * 1000;
    case 'd':
      return n * 24 * 60 * 60 * 1000;
    default:
      return 0;
  }
}
