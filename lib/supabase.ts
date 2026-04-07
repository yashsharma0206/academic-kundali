import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

function getSupabaseConfig(): { url: string; anonKey: string } {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in the project root .env file, then restart the Expo dev server (env vars are inlined at bundle time).'
    );
  }
  return { url: supabaseUrl, anonKey: supabaseAnonKey };
}

const { url, anonKey } = getSupabaseConfig();

export const supabase: SupabaseClient = createClient(url, anonKey);
