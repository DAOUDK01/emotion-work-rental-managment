import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, ApiError } from './api';
import i18n from './i18n';

export type Role = 'ADMIN' | 'STAFF' | 'ACCOUNTANT';

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  language: 'EN' | 'FI';
  maxDiscountPct: number;
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const applyUser = useCallback((u: SessionUser | null) => {
    setUser(u);
    if (u) void i18n.changeLanguage(u.language === 'FI' ? 'fi' : 'en');
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { user: u } = await api.get<{ user: SessionUser }>('/auth/me');
      applyUser(u);
    } catch {
      applyUser(null);
    } finally {
      setLoading(false);
    }
  }, [applyUser]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { user: u } = await api.post<{ user: SessionUser }>('/auth/login', { email, password });
      applyUser(u);
    },
    [applyUser],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
    applyUser(null);
  }, [applyUser]);

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export function RequireAuth({ roles, children }: { roles?: Role[]; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
