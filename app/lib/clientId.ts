'use client';

import { useEffect, useState } from 'react';

const KEY = 'inad_client_id';
let memoryId: string | null = null;

// crypto.randomUUID requires a secure context; fall back for http contexts
// (e.g. accessing the dev server via a LAN IP or non-localhost hostname).
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Returns the guest clientId stored in localStorage, creating one on first call.
// Safe to call from client components only — returns null during SSR.
export function getClientId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const id = localStorage.getItem(KEY) || memoryId || generateUUID();
    memoryId = id;
    localStorage.setItem(KEY, id);
    return id;
  } catch { return memoryId ??= generateUUID(); }
}

export function clearClientId(): void {
  if (typeof window === 'undefined') return;
  memoryId = null;
  try { localStorage.removeItem(KEY); } catch { /* Storage can be disabled. */ }
}

// React hook: returns the clientId after hydration (null during SSR).
export function useClientId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    setId(getClientId());
  }, []);
  return id;
}
