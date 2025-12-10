import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;


// Only create client if environment variables are set
// This allows the app to work without Supabase configured
let supabase: ReturnType<typeof createClient<Database>> | null = null;

if (supabaseUrl && supabaseAnonKey) {
  // Note: Supabase client may create WebSocket connections for auth token refresh,
  // which prevents back/forward cache (bfcache). This is a known limitation.
  // Real-time subscriptions are not used in this app, but WebSocket may still be
  // created for auth purposes. This is acceptable for a SPA that doesn't rely on
  // browser navigation.
  supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
} else {
  // Only show warning in dev mode to avoid console noise in production
  if (import.meta.env.DEV) {
    console.warn('[supabase] Not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable cloud sync.');
    console.warn('[supabase] For production builds, ensure these variables are set at build time.');
  }
}

export { supabase };

export function isSupabaseConfigured(): boolean {
  return supabase !== null;
}

