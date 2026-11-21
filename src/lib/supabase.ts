// src/lib/supabase.ts — Supabase client singleton
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('your-project') &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')
);

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});
