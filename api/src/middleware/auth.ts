import { Request, Response, NextFunction } from 'express';
import { verifyJwt } from '../utils/jwt';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = auth.slice(7);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const decoded = verifyJwt(token) as any;
    if (!decoded || !decoded.sub) return res.status(401).json({ error: 'Unauthorized' });
    req.user = { id: Number(decoded.sub), role: decoded.role } as any;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}
