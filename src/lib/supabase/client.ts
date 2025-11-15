import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Direct access to check what's actually available
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Debug logging (always log in production to help diagnose issues)
console.log('[supabase] ===== ENVIRONMENT DEBUG =====');
console.log('[supabase] Raw URL value:', import.meta.env.VITE_SUPABASE_URL);
console.log('[supabase] Raw Key value:', import.meta.env.VITE_SUPABASE_ANON_KEY ? `${import.meta.env.VITE_SUPABASE_ANON_KEY.substring(0, 20)}...` : 'undefined');
console.log('[supabase] URL type:', typeof supabaseUrl, 'Key type:', typeof supabaseAnonKey);
console.log('[supabase] URL truthy:', !!supabaseUrl, 'Key truthy:', !!supabaseAnonKey);
console.log('[supabase] All VITE_ keys:', Object.keys(import.meta.env).filter(k => k.startsWith('VITE_')));
console.log('[supabase] All env keys (first 20):', Object.keys(import.meta.env).slice(0, 20));
console.log('[supabase] ============================');

// Only create client if environment variables are set
// This allows the app to work without Supabase configured
let supabase: ReturnType<typeof createClient<Database>> | null = null;

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
  if (import.meta.env.DEV) {
    console.log('[supabase] Client initialized successfully');
  }
} else {
  console.warn('[supabase] Not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable cloud sync.');
  console.warn('[supabase] URL present:', !!supabaseUrl, 'Key present:', !!supabaseAnonKey);
}

export { supabase };

export function isSupabaseConfigured(): boolean {
  return supabase !== null;
}

