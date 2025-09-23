import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const { city, specialty, date, q, limit = '20', offset = '0' } = req.query as Record<string, string>;
  const take = Math.min(Math.max(parseInt(limit || '20', 10), 1), 100);
  const skip = Math.max(parseInt(offset || '0', 10), 0);

  try {
    const where: any = {};
    if (specialty) where.specialty = { contains: specialty, mode: 'insensitive' };

    const clinicWhere: any = {};
    if (city) clinicWhere.city = { contains: city, mode: 'insensitive' };

    // Basic availability filter: if date provided, select practitioners with at least one schedule on that weekday
    let schedulesFilter: any = undefined;
    if (date) {
      const d = new Date(date);
      if (!isNaN(d.getTime())) {
        const weekday = d.getDay(); // 0..6
        schedulesFilter = { some: { day_of_week: weekday } };
      }
    }

    const [items, total] = await Promise.all([
      prisma.practitioners_profiles.findMany({
        where: {
          ...where,
          clinic: Object.keys(clinicWhere).length ? { ...clinicWhere } : undefined,
          schedules: schedulesFilter,
        },
        include: {
          clinic: true,
          user: { select: { id: true, first_name: true, last_name: true, email: true, phone: true } },
          schedules: schedulesFilter ? { where: (schedulesFilter as any).some } : false,
        },
        orderBy: { rating: 'desc' },
        take,
        skip,
      }),
      prisma.practitioners_profiles.count({
        where: {
          ...where,
          clinic: Object.keys(clinicWhere).length ? { ...clinicWhere } : undefined,
          schedules: schedulesFilter,
        },
      }),
    ]);

    // Optional simple search across user names
    let filtered = items;
    if (q) {
      const qq = q.toLowerCase();
      filtered = items.filter((p: any) =>
        [p.user?.first_name || '', p.user?.last_name || ''].join(' ').toLowerCase().includes(qq)
      );
    }

    return res.json({ items: filtered, total });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch practitioners' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    const profile = await prisma.practitioners_profiles.findUnique({
      where: { id },
      include: { clinic: true, user: { select: { id: true, first_name: true, last_name: true, email: true, phone: true } }, schedules: true },
    });
    if (!profile) return res.status(404).json({ error: 'Not Found' });
    return res.json(profile);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch practitioner' });
  }
});

export default router;

// GET /v1/practitioners/:id/availability?date=YYYY-MM-DD
router.get('/:id/availability', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const dateStr = (req.query.date as string) || '';
  const slotOverride = req.query.slot_minutes ? Number(req.query.slot_minutes) : undefined;
  const limit = req.query.limit ? Math.min(Number(req.query.limit), 500) : undefined;
  const offset = req.query.offset ? Math.max(Number(req.query.offset), 0) : 0;
  const utcOffset = req.query.utc_offset ? Number(req.query.utc_offset) : 0; // minutes
  if (!id || !dateStr) return res.status(400).json({ error: 'Invalid id or date' });
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid date format' });
  try {
    const profile = await prisma.practitioners_profiles.findUnique({ where: { id }, include: { schedules: true } });
    if (!profile) return res.status(404).json({ error: 'Not Found' });
    const weekday = d.getUTCDay();

    // Get schedules that match the weekday
    const daySchedules = profile.schedules.filter((s: any) => s.day_of_week === weekday);
    if (daySchedules.length === 0) return res.json({ date: dateStr, slots: [] });

    // Fetch reservations for that date
    const startOfDay = new Date(d);
    const endOfDay = new Date(d);
    endOfDay.setUTCHours(23, 59, 59, 999);
    const reservations = await prisma.reservations.findMany({
      where: {
        practitioner_id: BigInt(id),
        status: { in: ['booked', 'confirmed'] as any },
        OR: [{ start_datetime: { lt: endOfDay }, end_datetime: { gt: startOfDay } }],
      },
      select: { start_datetime: true, end_datetime: true },
    });

    let slots: { start: string; end: string }[] = [];
    for (const s of daySchedules) {
      const slotMinutes = slotOverride || s.slot_duration_minutes || 15;
      // Build actual Date for schedule window on that UTC day
      const [sh, sm, ss] = (s.start_time?.toISOString().substring(11, 19) || '00:00:00').split(':').map(Number);
      const [eh, em, es] = (s.end_time?.toISOString().substring(11, 19) || '00:00:00').split(':').map(Number);
      const winStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), sh, sm, ss || 0));
      const winEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), eh, em, es || 0));

      for (let t = new Date(winStart); t < winEnd;) {
        const tEnd = new Date(t.getTime() + slotMinutes * 60 * 1000);
        if (tEnd > winEnd) break;
        // Check overlap with existing reservations
        const overlaps = reservations.some((r) => r.start_datetime < tEnd && r.end_datetime > t);
        if (!overlaps) {
          // Adjust to client-provided UTC offset if given
          const adjStart = new Date(t.getTime() - utcOffset * 60 * 1000).toISOString();
          const adjEnd = new Date(tEnd.getTime() - utcOffset * 60 * 1000).toISOString();
          slots.push({ start: adjStart, end: adjEnd });
        }
        t = tEnd;
      }
    }
    if (offset || limit) {
      slots = slots.slice(offset, limit ? offset + limit : undefined);
    }
    return res.json({ date: dateStr, slots, total: slots.length, offset, limit });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to compute availability' });
  }
});
