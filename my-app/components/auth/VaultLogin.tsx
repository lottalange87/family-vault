'use client';

import { useState, useEffect } from 'react';
import { useVault } from '@/hooks/useVault';

export function VaultLogin() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);

  const { isInitialized, isUnlocked, checkInitialized, unlockVault, initializeVault } =
    useVault();

  useEffect(() => {
    checkInitialized();
  }, [checkInitialized]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const success = await unlockVault(password);
      if (!success) {
        setError('Invalid password');
      }
    } catch {
      setError('Failed to unlock vault');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInitialize = async () => {
    setError('');
    setIsInitializing(true);

    try {
      await initializeVault();
    } catch {
      setError('Failed to initialize vault');
    } finally {
      setIsInitializing(false);
    }
  };

  if (isUnlocked) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0f]/95 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-[#27273a] bg-[#151520] p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-500/20">
            <svg
              className="h-8 w-8 text-indigo-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[#f8fafc]">
            Family Vault
          </h1>
          <p className="mt-2 text-[#94a3b8]">
            {isInitialized
              ? 'Enter your password to unlock'
              : 'Create a new vault to get started'}
          </p>
        </div>

        {!isInitialized ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="text-sm text-amber-200">
                <strong>Important:</strong> This will create a new vault. Make sure to
                remember your password - it cannot be recovered!
              </p>
            </div>
            <button
              onClick={handleInitialize}
              disabled={isInitializing}
              className="w-full rounded-xl bg-indigo-500 px-4 py-3 font-medium text-white transition-colors hover:bg-indigo-600 disabled:opacity-50"
            >
              {isInitializing ? 'Creating...' : 'Create New Vault'}
            </button>
          </div>
        ) : (
          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium text-[#94a3b8]"
              >
                Password
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-[#27273a] bg-[#0a0a0f] px-4 py-3 text-[#f8fafc] placeholder-[#94a3b8]/50 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                placeholder="Enter your password"
                autoFocus
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !password}
              className="w-full rounded-xl bg-indigo-500 px-4 py-3 font-medium text-white transition-colors hover:bg-indigo-600 disabled:opacity-50"
            >
              {isLoading ? 'Unlocking...' : 'Unlock Vault'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
