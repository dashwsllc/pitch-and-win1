import { createClient } from '@supabase/supabase-js';
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

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // Limits token persistence to the current tab. HttpOnly cookies require a
    // server-rendered application or an authentication proxy.
    storage: sessionStorage,
    storageKey: authStorageKey,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

export function clearStoredSupabaseSession() {
  sessionStorage.removeItem(authStorageKey);
  sessionStorage.removeItem(`${authStorageKey}-code-verifier`);
}
