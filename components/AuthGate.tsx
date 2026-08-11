
import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Business, AuthResponse } from '../types';
import { authService, getToken, clearToken, setToken } from '../services/auth';
import AuthPage from './AuthPage';

interface AuthContextValue {
  user: User;
  business: Business;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthGate>');
  }
  return ctx;
};

type AuthState =
  | { status: 'checking' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: User; business: Business };

const SplashScreen: React.FC = () => (
  <div className="min-h-screen bg-slate-50 font-sans flex flex-col items-center justify-center gap-6">
    <div className="w-16 h-16 bg-indigo-600 rounded-3xl flex items-center justify-center text-white font-black text-2xl shadow-2xl shadow-indigo-200 animate-pulse">
      T
    </div>
    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] animate-pulse">
      Establishing session
    </p>
  </div>
);

/**
 * AuthGate is the boundary between the public auth surface (AuthPage) and the
 * authenticated workspace. It validates any stored token against the server on
 * boot, gates the workspace behind a successful session, and exposes the signed
 * in user + business through useAuth().
 */
const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      if (!getToken()) {
        setState({ status: 'signed-out' });
        return;
      }
      try {
        const { user, business } = await authService.me();
        if (!cancelled) setState({ status: 'signed-in', user, business });
      } catch (err) {
        clearToken();
        if (!cancelled) setState({ status: 'signed-out' });
      }
    };
    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAuthenticated = (auth: AuthResponse) => {
    setToken(auth.token);
    setState({ status: 'signed-in', user: auth.user, business: auth.business });
  };

  const logout = async () => {
    await authService.logout();
    setState({ status: 'signed-out' });
  };

  if (state.status === 'checking') {
    return <SplashScreen />;
  }

  if (state.status === 'signed-out') {
    return <AuthPage onAuthenticated={handleAuthenticated} />;
  }

  return (
    <AuthContext.Provider value={{ user: state.user, business: state.business, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthGate;
