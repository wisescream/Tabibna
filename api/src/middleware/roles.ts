import { Request, Response, NextFunction } from 'express';

type Role = 'patient' | 'practitioner' | 'admin';

export function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.role !== role && user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

export function requireAnyRole(roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.role === 'admin') return next();
    if (!roles.includes(user.role as Role)) return res.status(403).json({ error: 'Forbidden' });
    return next();
  };
}
