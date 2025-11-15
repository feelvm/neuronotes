import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Debug logging (always log in production to help diagnose issues)
console.log('[supabase] Environment check:', {
  hasUrl: !!supabaseUrl,
  hasKey: !!supabaseAnonKey,
  urlLength: supabaseUrl?.length || 0,
  keyLength: supabaseAnonKey?.length || 0,
  urlPreview: supabaseUrl ? `${supabaseUrl.substring(0, 20)}...` : 'missing',
  isDev: import.meta.env.DEV,
  allEnvKeys: Object.keys(import.meta.env).filter(k => k.startsWith('VITE_'))
});

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

