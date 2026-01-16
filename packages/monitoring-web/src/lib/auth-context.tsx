'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useCallback,
} from 'react';
import { authApi, User, ApiError } from './api-client';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthContextProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const userData = await authApi.me();
      setUser(userData);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('refresh_token');
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      refreshUser().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [refreshUser]);

  const login = async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    localStorage.setItem('auth_token', result.accessToken);
    localStorage.setItem('refresh_token', result.refreshToken);
    setUser(result.user);
  };

  const register = async (email: string, password: string, name: string) => {
    const result = await authApi.register(email, password, name);
    localStorage.setItem('auth_token', result.accessToken);
    localStorage.setItem('refresh_token', result.refreshToken);
    setUser(result.user);
  };

  const logout = () => {
    authApi.logout().catch(() => {});
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthContextProvider');
  }
  return context;
}

export type { User };
