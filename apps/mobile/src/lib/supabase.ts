import type { Database } from '@contractorsight/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

// EXPO_PUBLIC_* values are inlined at build time; they must be read with these exact expressions.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * Settings this build is missing. Locally they come from apps/mobile/.env; on EAS from the build
 * profile's environment (DEPLOY.md). The root layout shows them instead of the app, because
 * throwing here would close an installed app instantly with no explanation.
 */
export const missingConfig = [!url && 'EXPO_PUBLIC_SUPABASE_URL', !publishableKey && 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'].filter(
  (name): name is string => !!name,
);

// The app only ever holds the publishable key. Row-level security decides what a signed-in user can do.
// With settings missing the client gets placeholders and is never used (see missingConfig).
export const supabase = createClient<Database>(url || 'http://missing-config.invalid', publishableKey || 'missing', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh the session only while the app is in the foreground.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
