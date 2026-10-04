import { createClient } from "@supabase/supabase-js";
import type { VerifyUser } from "./http/app";

/** Verifies access tokens with Supabase Auth. Needs only the publishable key. */
export function supabaseVerifyUser(url: string, publishableKey: string): VerifyUser {
  const supabase = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return async (accessToken) => {
    const { data, error } = await supabase.auth.getUser(accessToken);
    return error || !data.user ? null : data.user.id;
  };
}
