import { useState } from 'react';
import { Flame } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage('Check your email for a confirmation link.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#02061a] flex items-center justify-center px-4">
      <div className="bg-slate-800 border border-slate-700/60 rounded-2xl p-8 w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Flame size={16} className="text-white" />
          </div>
          <span className="font-semibold text-slate-50 tracking-tight">ISA & FIRE</span>
        </div>

        <h2 className="text-xl font-semibold text-slate-50 mb-1">
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </h2>
        <p className="text-sm text-slate-500 mb-6">
          {mode === 'signin'
            ? 'Your data syncs automatically across devices.'
            : 'Your data is stored securely in Supabase.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Email</label>
            <input
              type="email"
              required
              autoFocus
              className="w-full border border-slate-700 bg-slate-900 text-slate-100 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-600 transition-colors"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Password</label>
            <input
              type="password"
              required
              minLength={6}
              className="w-full border border-slate-700 bg-slate-900 text-slate-100 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-600 transition-colors"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-xl px-3 py-2">{error}</p>}
          {message && <p className="text-sm text-green-400 bg-green-900/20 border border-green-800/40 rounded-xl px-3 py-2">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="text-sm text-slate-500 text-center mt-6">
          {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
          <button
            className="text-indigo-400 font-medium hover:text-indigo-300 transition-colors"
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setMessage(null); }}
          >
            {mode === 'signin' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
