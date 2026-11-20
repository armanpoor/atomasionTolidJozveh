import { NextFunction, Request, Response } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { getOrCreateUser } from '../db/repository.ts';

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'احراز هویت الزامی است. لطفاً با حساب گوگل وارد شوید.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'توکن احراز هویت نامعتبر است.' });
    return;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.user = decoded;
    await getOrCreateUser(
      decoded.uid,
      decoded.email || `${decoded.uid}@users.local`,
      decoded.name || null,
      decoded.picture || null
    );
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    res.status(401).json({ error: 'نشست کاربری منقضی شده یا نامعتبر است. لطفاً دوباره وارد شوید.' });
  }
};
