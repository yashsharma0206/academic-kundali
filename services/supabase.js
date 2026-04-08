import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

/** True when both URL and anon key are set at bundle time (EAS env / .env). */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * Lazily `null` when env is missing so the app can still run (e.g. local APK without secrets).
 * Do not throw at import time — that crashes the whole app before any screen renders.
 */
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
