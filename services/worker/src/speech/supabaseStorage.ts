import { createClient } from "@supabase/supabase-js";

/** Downloads from the `captures` bucket with the user's own token, so storage policies decide access. */
export function supabaseAudioDownloader(url: string, publishableKey: string) {
  return async (accessToken: string, storagePath: string): Promise<Uint8Array> => {
    const supabase = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data, error } = await supabase.storage.from("captures").download(storagePath);
    if (error || !data) throw new Error(`Could not download the recording: ${error?.message ?? "not found"}`);
    return new Uint8Array(await data.arrayBuffer());
  };
}
