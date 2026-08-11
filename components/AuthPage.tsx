
import React, { useState } from 'react';
import { Loader2, Lock, Mail, User, Building2, Eye, EyeOff, ShieldCheck, Sparkles } from 'lucide-react';
import { AuthResponse } from '../types';
import { authService } from '../services/auth';

interface Props {
  onAuthenticated: (auth: AuthResponse) => void;
}

type Mode = 'login' | 'register';

const inputClass =
  'w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700 placeholder:text-slate-300 transition-all';

const AuthPage: React.FC<Props> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const validate = (): string | null => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return 'Enter a valid email address.';
    }
    if (password.length < 8) {
      return 'Password must be at least 8 characters.';
    }
    if (mode === 'register') {
      if (name.trim().length < 2) return 'Enter your name.';
      if (businessName.trim().length < 2) return 'Enter your business name.';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const auth = mode === 'register'
        ? await authService.register({ email, password, name, businessName })
        : await authService.login({ email, password });
      onAuthenticated(auth);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans flex flex-col items-center justify-center px-6 py-12 relative overflow-hidden">
      {/* Decorative background */}
      <div className="absolute top-0 right-0 w-[520px] h-[520px] bg-indigo-100/60 rounded-full blur-3xl opacity-40 pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 w-[420px] h-[420px] bg-emerald-100/60 rounded-full blur-3xl opacity-30 pointer-events-none"></div>

      <div className="relative w-full max-w-md">
        {/* Brand */}
        <div className="flex flex-col items-center text-center mb-10">
          <div className="w-16 h-16 bg-indigo-600 rounded-3xl flex items-center justify-center text-white font-black text-2xl shadow-2xl shadow-indigo-200 mb-6 animate-in fade-in zoom-in duration-500">
            T
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">
            <span className="text-gradient">Touchpoint</span> AI
          </h1>
          <p className="text-slate-500 font-medium mt-2 text-sm">
            Conversational infrastructure for physical commerce.
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-[48px] border border-slate-100 shadow-2xl shadow-slate-200/60 p-10 animate-in fade-in slide-in-from-bottom-6 duration-500">
          {/* Toggle */}
          <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2 rounded-2xl mb-8">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${
                mode === 'login' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => switchMode('register')}
              className={`py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${
                mode === 'register' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              Create Workspace
            </button>
          </div>

          <h2 className="text-xl font-bold text-slate-900 mb-1">
            {mode === 'login' ? 'Welcome back' : 'Provision your business'}
          </h2>
          <p className="text-sm text-slate-400 font-medium mb-8">
            {mode === 'login'
              ? 'Access your agents, touchpoints and pipeline.'
              : 'Create your workspace to start training agents.'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Business Name</label>
                  <div className="relative">
                    <Building2 size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300" />
                    <input
                      type="text"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="Acme Ltd"
                      className={`${inputClass} pl-12`}
                      autoComplete="organization"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Your Name</label>
                  <div className="relative">
                    <User size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300" />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Jane Doe"
                      className={`${inputClass} pl-12`}
                      autoComplete="name"
                    />
                  </div>
                </div>
              </>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className={`${inputClass} pl-12`}
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className={`${inputClass} pl-12 pr-12`}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-xs font-bold animate-in fade-in duration-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Sparkles size={16} className="text-indigo-400" />
              )}
              {mode === 'login' ? 'Sign In' : 'Create Workspace'}
            </button>
          </form>
        </div>

        {/* Security note */}
        <div className="flex items-center justify-center gap-2 mt-8 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          <ShieldCheck size={14} className="text-emerald-500" />
          Protected by encrypted authentication
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
