import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { z } from 'zod';
import { requireAnyRole } from '../middleware/roles';

const router = Router();
// Dev-only helper to seed a practitioner for testing
if (process.env.NODE_ENV !== 'production') {
  router.post('/seed-dev-practitioner', async (req: Request, res: Response) => {
    try {
      const user = await prisma.users.create({ data: { email: `dev_pr_${Date.now()}@example.com`, role: 'practitioner' } as any });
      const prof = await prisma.practitioners_profiles.create({ data: { user_id: user.id, specialty: 'General' } });
      return res.status(201).json({ user_id: String(user.id), profile_id: String(prof.id) });
    } catch (e) {
      return res.status(500).json({ error: 'seed failed' });
    }
  });
}

// All routes require auth and practitioner role
router.use(requireAuth);
router.use(requireAnyRole(['practitioner']));

router.get('/reservations', async (req: Request, res: Response) => {
  const { from, to } = req.query as Record<string, string>;
  try {
    // find practitioner profile by user_id
    const profile = await prisma.practitioners_profiles.findFirst({ where: { user_id: BigInt(req.user!.id) } });
    if (!profile) return res.status(403).json({ error: 'Not practitioner' });
    const where: any = { practitioner_id: profile.id };
    if (from) where.start_datetime = { gte: new Date(from) };
    if (to) where.end_datetime = { lte: new Date(to) };
    const items = await prisma.reservations.findMany({ where, orderBy: { start_datetime: 'asc' } });
    return res.json({ items });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch reservations' });
  }
});

const scheduleSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string(), // HH:mm:ss
  end_time: z.string(),
  slot_duration_minutes: z.number().int().min(5).max(240).optional(),
});

router.post('/schedules', async (req: Request, res: Response) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const profile = await prisma.practitioners_profiles.findFirst({ where: { user_id: BigInt(req.user!.id) } });
    if (!profile) return res.status(403).json({ error: 'Not practitioner' });
    const created = await prisma.schedules.create({
      data: {
        practitioner_id: profile.id,
        day_of_week: parsed.data.day_of_week,
        start_time: new Date(`1970-01-01T${parsed.data.start_time}Z`),
        end_time: new Date(`1970-01-01T${parsed.data.end_time}Z`),
        slot_duration_minutes: parsed.data.slot_duration_minutes ?? 15,
      },
    });
    return res.status(201).json(created);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create schedule' });
  }
});

router.put('/schedules/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const parsed = scheduleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const profile = await prisma.practitioners_profiles.findFirst({ where: { user_id: BigInt(req.user!.id) } });
    if (!profile) return res.status(403).json({ error: 'Not practitioner' });
    const existing = await prisma.schedules.findUnique({ where: { id: BigInt(id) } });
    if (!existing || existing.practitioner_id !== profile.id) return res.status(404).json({ error: 'Not found' });
    const data: any = { ...parsed.data };
    if (data.start_time) data.start_time = new Date(`1970-01-01T${data.start_time}Z`);
    if (data.end_time) data.end_time = new Date(`1970-01-01T${data.end_time}Z`);
    const updated = await prisma.schedules.update({ where: { id: existing.id }, data });
    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update schedule' });
  }
});

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const profile = await prisma.practitioners_profiles.findFirst({ where: { user_id: BigInt(req.user!.id) } });
    if (!profile) return res.status(403).json({ error: 'Not practitioner' });
    const [total, cancelled, completed] = await Promise.all([
      prisma.reservations.count({ where: { practitioner_id: profile.id } }),
      prisma.reservations.count({ where: { practitioner_id: profile.id, status: 'cancelled' } }),
      prisma.reservations.count({ where: { practitioner_id: profile.id, status: 'completed' } }),
    ]);
    // naive estimates for MVP
    return res.json({ total, cancelled, completed, no_show_rate: 0, estimated_revenue: 0 });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
