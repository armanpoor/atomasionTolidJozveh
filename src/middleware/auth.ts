import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { getOrCreateUser } from '../db/repository.ts';
import { isGuestBearerToken, verifyGuestToken } from '../server/guestSession.ts';

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  isGuest?: boolean;
  firebase?: DecodedIdToken['firebase'];
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'احراز هویت الزامی است. لطفاً با حساب گوگل یا حالت مهمان وارد شوید.',
    });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'توکن احراز هویت نامعتبر است.' });
    return;
  }

  if (isGuestBearerToken(token)) {
    const guest = verifyGuestToken(token);
    if (!guest) {
      res.status(401).json({
        error: 'نشست مهمان منقضی شده یا نامعتبر است. لطفاً دوباره وارد حالت مهمان شوید.',
      });
      return;
    }
    try {
      req.user = {
        uid: guest.uid,
        email: guest.email,
        name: guest.name,
        isGuest: true,
      };
      await getOrCreateUser(guest.uid, guest.email, guest.name, null);
      next();
    } catch (error) {
      console.error('Error syncing guest user:', error);
      res.status(500).json({ error: 'خطا در آماده‌سازی نشست مهمان.' });
    }
    return;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.user = {
      ...decoded,
      isGuest: false,
    };
    await getOrCreateUser(
      decoded.uid,
      decoded.email || `${decoded.uid}@users.local`,
      decoded.name || null,
      decoded.picture || null
    );
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    res.status(401).json({
      error: 'نشست کاربری منقضی شده یا نامعتبر است. لطفاً دوباره وارد شوید.',
    });
  }
};
