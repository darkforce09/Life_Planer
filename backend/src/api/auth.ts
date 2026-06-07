import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

/**
 * Bearer-token auth middleware.
 *
 * Active only when API_AUTH_TOKEN is set. When unset, auth is disabled so local
 * development works out of the box (a warning is logged once at startup).
 *
 * `/api/health` is always public so the unauthenticated health widget can poll it.
 */
const PUBLIC_PATHS = new Set(['/api/health']);

let warned = false;

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.API_AUTH_TOKEN;

  if (!expected) {
    if (!warned) {
      logger.warn('[AUTH] API_AUTH_TOKEN not set - API authentication is DISABLED.');
      warned = true;
    }
    return next();
  }

  if (PUBLIC_PATHS.has(req.path)) {
    return next();
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (token && token === expected) {
    return next();
  }

  res.status(401).json({ error: 'Unauthorized' });
}
