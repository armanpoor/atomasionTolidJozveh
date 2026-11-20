import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  auth,
  ensureUserWorkspaceProfile,
  googleAuthProvider,
} from '../lib/firebase';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signingIn: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setLoading(false);
      if (nextUser) {
        try {
          await ensureUserWorkspaceProfile({
            uid: nextUser.uid,
            email: nextUser.email || '',
            displayName: nextUser.displayName || nextUser.email || 'کاربر استودیو',
          });
        } catch (err) {
          console.error('Failed to sync user workspace profile:', err);
        }
      }
    });
    return () => unsub();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user') {
        setAuthError('پنجره ورود با گوگل بسته شد. لطفاً دوباره تلاش کنید.');
      } else if (code === 'auth/popup-blocked') {
        setAuthError('مرورگر پنجره ورود را مسدود کرد. اجازه باز شدن پنجره (Popup) را فعال کنید.');
      } else {
        setAuthError(
          err instanceof Error ? err.message : 'ورود با حساب گوگل با خطا مواجه شد.'
        );
      }
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setAuthError(null);
    await firebaseSignOut(auth);
  }, []);

  const getIdToken = useCallback(
    async (forceRefresh = false): Promise<string> => {
      const current = auth.currentUser;
      if (!current) {
        throw new Error('لطفاً ابتدا با حساب گوگل وارد شوید.');
      }
      return current.getIdToken(forceRefresh);
    },
    []
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signingIn,
        authError,
        signInWithGoogle,
        signOut,
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
