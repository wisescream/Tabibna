import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requireAnyRole } from '../middleware/roles';

const router = Router();

const createSchema = z.object({
  practitioner_id: z.coerce.number().int().positive(),
  clinic_id: z.coerce.number().int().positive().optional(),
  start_datetime: z.string().datetime(),
  end_datetime: z.string().datetime(),
  patient_notes: z.string().max(2000).optional(),
});

router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { practitioner_id, clinic_id, start_datetime, end_datetime, patient_notes } = parsed.data;
  const start = new Date(start_datetime);
  const end = new Date(end_datetime);
  if (!(start < end)) return res.status(400).json({ error: 'Invalid time range' });

  try {
    const practitioner = await prisma.practitioners_profiles.findUnique({ where: { id: BigInt(practitioner_id) } });
    if (!practitioner) return res.status(404).json({ error: 'Practitioner not found' });

    // Overlap check
    const overlap = await prisma.reservations.findFirst({
      where: {
        practitioner_id: BigInt(practitioner_id),
        status: { in: ['booked', 'confirmed'] as any },
        OR: [
          { start_datetime: { lt: end }, end_datetime: { gt: start } },
        ],
      },
    });
    if (overlap) return res.status(409).json({ error: 'Timeslot not available' });

    const created = await prisma.reservations.create({
      data: {
        patient_id: BigInt(req.user!.id),
        practitioner_id: BigInt(practitioner_id),
        clinic_id: clinic_id ? BigInt(clinic_id) : null,
        start_datetime: start,
        end_datetime: end,
        status: 'booked',
      },
    });

    return res.status(201).json(created);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create reservation' });
  }
});

router.put('/:id/cancel', requireAuth, requireAnyRole(['patient', 'practitioner']), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    const existing = await prisma.reservations.findUnique({ where: { id: BigInt(id) } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    // Allow cancel if requester is patient or practitioner involved
    const isOwner = existing.patient_id === BigInt(req.user!.id);
    // For a stricter rule, fetch practitioner user_id link if needed. Here, allow patient cancel.
    if (!isOwner && req.user!.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    const updated = await prisma.reservations.update({
      where: { id: existing.id },
      data: { status: 'cancelled' },
    });
    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to cancel reservation' });
  }
});

export default router;
// GET /v1/reservations/:id - detail with auth (patient or practitioner)
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    const reservation = await prisma.reservations.findUnique({ where: { id: BigInt(id) } });
    if (!reservation) return res.status(404).json({ error: 'Not found' });
    const userId = BigInt(req.user!.id);
    let allowed = reservation.patient_id === userId;
    if (!allowed) {
      const profile = await prisma.practitioners_profiles.findFirst({ where: { user_id: userId } });
      if (profile && reservation.practitioner_id === profile.id) allowed = true;
    }
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    return res.json(reservation);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch reservation' });
  }
});

// Reschedule reservation
const rescheduleSchema = z.object({
  start_datetime: z.string().datetime(),
  end_datetime: z.string().datetime(),
});

router.put('/:id', requireAuth, requireAnyRole(['patient', 'practitioner']), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const parsed = rescheduleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const start = new Date(parsed.data.start_datetime);
  const end = new Date(parsed.data.end_datetime);
  if (!(start < end)) return res.status(400).json({ error: 'Invalid time range' });
  try {
    const existing = await prisma.reservations.findUnique({ where: { id: BigInt(id) } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const userId = BigInt(req.user!.id);
    // Allow if patient owner, practitioner owner (via profile), or admin
    let allowed = existing.patient_id === userId || req.user!.role === 'admin';
    if (!allowed) {
      const profile = await prisma.practitioners_profiles.findFirst({ where: { user_id: userId } });
      if (profile && existing.practitioner_id === profile.id) allowed = true;
    }
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    // Overlap check for practitioner
    const overlap = await prisma.reservations.findFirst({
      where: {
        id: { not: existing.id },
        practitioner_id: existing.practitioner_id,
        status: { in: ['booked', 'confirmed'] as any },
        OR: [{ start_datetime: { lt: end }, end_datetime: { gt: start } }],
      },
    });
    if (overlap) return res.status(409).json({ error: 'Timeslot not available' });

    const updated = await prisma.reservations.update({
      where: { id: existing.id },
      data: { start_datetime: start, end_datetime: end, status: existing.status },
    });
    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to reschedule reservation' });
  }
});
