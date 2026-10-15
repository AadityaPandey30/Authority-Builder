import type { NextFunction, Request, Response } from 'express';

import { config } from '../../config';

/**
 * Bearer-token check mirroring the whatsapp-service convention. Uses a constant
 * comparison so a wrong token cannot be discovered by timing.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  const prefix = 'Bearer ';
  const token = header.startsWith(prefix) ? header.slice(prefix.length) : '';

  if (token === '' || !timingSafeEqual(token, config.CATALYGN_ADMIN_SECRET)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
