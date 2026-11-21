import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
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

export interface AppSessionUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  isGuest: boolean;
}

interface AuthContextValue {
  user: AppSessionUser | null;
  isGuest: boolean;
  loading: boolean;
  signingIn: boolean;
  enteringGuest: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  enterGuestMode: () => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function mapFirebaseUser(fbUser: User): AppSessionUser {
  return {
    uid: fbUser.uid,
    email: fbUser.email,
    displayName: fbUser.displayName,
    photoURL: fbUser.photoURL,
    isGuest: false,
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [guestUser, setGuestUser] = useState<AppSessionUser | null>(null);
  // Keep server-signed guest session token strictly in memory (never in localStorage/sessionStorage)
  const guestTokenRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [enteringGuest, setEnteringGuest] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const autoGuestAttemptedRef = useRef(false);

  const enterGuestMode = useCallback(async () => {
    setEnteringGuest(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (await res.json().catch(() => null)) as {
        token?: string;
        uid?: string;
        displayName?: string;
        email?: string;
        error?: string;
      } | null;

      if (!res.ok || !data?.token || !data?.uid) {
        throw new Error(data?.error || 'ایجاد نشست مهمان با خطا مواجه شد.');
      }

      guestTokenRef.current = data.token;
      setGuestUser({
        uid: data.uid,
        email: data.email || null,
        displayName: data.displayName || 'کاربر مهمان',
        photoURL: null,
        isGuest: true,
      });
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'ورود به حالت مهمان با خطا مواجه شد.'
      );
    } finally {
      setEnteringGuest(false);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setFirebaseUser(nextUser);
      if (nextUser) {
        guestTokenRef.current = null;
        setGuestUser(null);
        setLoading(false);
        try {
          await ensureUserWorkspaceProfile({
            uid: nextUser.uid,
            email: nextUser.email || '',
            displayName: nextUser.displayName || nextUser.email || 'کاربر استودیو',
          });
        } catch (err) {
          console.error('Failed to sync user workspace profile:', err);
        }
      } else {
        setLoading(false);
        // Optional ?guest=1 or ?autostart=1 support for direct guest entry
        if (!autoGuestAttemptedRef.current && typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          if (params.get('guest') === '1' || params.get('autostart') === '1') {
            autoGuestAttemptedRef.current = true;
            void enterGuestMode();
          }
        }
      }
    });
    return () => unsub();
  }, [enterGuestMode]);

  const signInWithGoogle = useCallback(async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
      guestTokenRef.current = null;
      setGuestUser(null);
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
    if (guestTokenRef.current || guestUser) {
      guestTokenRef.current = null;
      setGuestUser(null);
    }
    if (auth.currentUser) {
      await firebaseSignOut(auth);
    }
  }, [guestUser]);

  const getIdToken = useCallback(
    async (forceRefresh = false): Promise<string> => {
      const current = auth.currentUser;
      if (current) {
        return current.getIdToken(forceRefresh);
      }
      if (guestTokenRef.current) {
        return guestTokenRef.current;
      }
      throw new Error('لطفاً ابتدا با حساب گوگل یا حالت مهمان وارد شوید.');
    },
    []
  );

  const user: AppSessionUser | null = firebaseUser
    ? mapFirebaseUser(firebaseUser)
    : guestUser;
  const isGuest = Boolean(!firebaseUser && guestUser);

  return (
    <AuthContext.Provider
      value={{
        user,
        isGuest,
        loading,
        signingIn,
        enteringGuest,
        authError,
        signInWithGoogle,
        enterGuestMode,
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
