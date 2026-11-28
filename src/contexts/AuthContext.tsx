import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  auth,
  ensureUserWorkspaceProfile,
  googleAuthProvider,
  googleWorkspaceAuthProvider,
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
  workspaceAccessToken: string | null;
  hasWorkspaceAccess: boolean;
  signInWithGoogle: () => Promise<void>;
  connectGoogleWorkspace: () => Promise<string | null>;
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
  // Keep server-signed guest session token and Google Workspace OAuth access token strictly in memory
  const guestTokenRef = useRef<string | null>(null);
  const workspaceTokenRef = useRef<string | null>(null);
  const [workspaceAccessToken, setWorkspaceAccessToken] = useState<string | null>(null);

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
        workspaceTokenRef.current = null;
        setWorkspaceAccessToken(null);
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
      workspaceTokenRef.current = null;
      setWorkspaceAccessToken(null);
      guestTokenRef.current = null;
      setGuestUser(null);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setAuthError('پنجره ورود با گوگل بسته شد. لطفاً دوباره تلاش کنید.');
      } else if (code === 'auth/popup-blocked') {
        setAuthError('مرورگر پنجره ورود را مسدود کرد. اجازه باز شدن پنجره (Popup) را فعال کنید و در مرورگر Brave سپر Shields را برای این صفحه خاموش کنید.');
      } else if (code === 'auth/unauthorized-domain') {
        const host = typeof window !== 'undefined' ? window.location.hostname : '';
        setAuthError(
          `دامنه فعلی (${host}) در فهرست Authorized Domains پروژه Firebase مجاز نشده است. لطفاً صفحه را رفرش کنید یا دامنه را در Firebase Authentication اضافه نمایید.`
        );
      } else {
        setAuthError(
          err instanceof Error ? err.message : 'ورود با حساب گوگل با خطا مواجه شد.'
        );
      }
    } finally {
      setSigningIn(false);
    }
  }, []);

  const connectGoogleWorkspace = useCallback(async (): Promise<string | null> => {
    setSigningIn(true);
    setAuthError(null);
    try {
      const result = await signInWithPopup(auth, googleWorkspaceAuthProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const accessToken = credential?.accessToken ?? null;
      if (!accessToken) {
        throw new Error('توکن دسترسی به Google Drive و Sheets دریافت نشد. لطفاً دوباره وارد شوید.');
      }
      workspaceTokenRef.current = accessToken;
      setWorkspaceAccessToken(accessToken);
      guestTokenRef.current = null;
      setGuestUser(null);
      return accessToken;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setAuthError('پنجره اتصال به گوگل بسته شد.');
      } else if (code === 'auth/popup-blocked') {
        setAuthError('مرورگر پنجره اتصال به گوگل را مسدود کرد.');
      } else if (code === 'auth/unauthorized-domain') {
        const host = typeof window !== 'undefined' ? window.location.hostname : '';
        setAuthError(`دامنه فعلی (${host}) در Firebase Authentication مجاز نشده است.`);
      } else {
        setAuthError(
          err instanceof Error ? err.message : 'اتصال به Google Workspace با خطا مواجه شد.'
        );
      }
      return null;
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setAuthError(null);
    workspaceTokenRef.current = null;
    setWorkspaceAccessToken(null);
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
        if (forceRefresh) {
          const res = await fetch('/api/auth/guest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          const data = (await res.json().catch(() => null)) as {
            token?: string;
            uid?: string;
            displayName?: string;
            email?: string;
          } | null;
          if (res.ok && data?.token && data?.uid) {
            guestTokenRef.current = data.token;
            setGuestUser({
              uid: data.uid,
              email: data.email || null,
              displayName: data.displayName || 'کاربر مهمان',
              photoURL: null,
              isGuest: true,
            });
            return data.token;
          }
        }
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
        workspaceAccessToken,
        hasWorkspaceAccess: Boolean(workspaceAccessToken),
        signInWithGoogle,
        connectGoogleWorkspace,
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
