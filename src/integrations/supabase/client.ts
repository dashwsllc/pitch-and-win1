import { createClient, type Session } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY');
}

const parsedUrl = new URL(SUPABASE_URL);
if (parsedUrl.protocol !== 'https:' && parsedUrl.hostname !== 'localhost') {
  throw new Error('VITE_SUPABASE_URL must use HTTPS');
}

// Make the storage key explicit so a failed network sign-out can still remove
// the local refresh token. Supabase uses this same key format by default.
const authStorageKey = `sb-${parsedUrl.hostname.split('.')[0]}-auth-token`;

// Recovery emails can be opened in another tab or browser. The implicit flow
// carries the verified session in the URL fragment, without a tab-local PKCE
// verifier. Capture the token before Supabase removes the fragment on startup.
const initialHash = new URLSearchParams(window.location.hash.slice(1));
const initialRecoveryToken = initialHash.get('type') === 'recovery'
  ? initialHash.get('access_token')
  : null;

export const hasRecoveryLink = Boolean(initialRecoveryToken);
const initialQuery = new URLSearchParams(window.location.search);
export const hasRecoveryLinkError = initialHash.has('error') ||
  initialQuery.has('error') || initialQuery.has('code');
export const isRecoverySession = (session: Session | null) =>
  Boolean(initialRecoveryToken && session?.access_token === initialRecoveryToken);

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // Limits token persistence to the current tab. HttpOnly cookies require a
    // server-rendered application or an authentication proxy.
    storage: sessionStorage,
    storageKey: authStorageKey,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
  },
});

export function clearStoredSupabaseSession() {
  sessionStorage.removeItem(authStorageKey);
  sessionStorage.removeItem(`${authStorageKey}-code-verifier`);
}
