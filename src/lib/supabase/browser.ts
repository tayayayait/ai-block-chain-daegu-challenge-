import { createBrowserClient } from "@supabase/ssr";

export interface BrowserSupabaseConfig {
  url: string;
  publishableKey: string;
}

function readBrowserSupabaseConfig(): BrowserSupabaseConfig {
  const url = import.meta.env["VITE_SUPABASE_URL"];
  const publishableKey = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  const missing = [
    !url ? "VITE_SUPABASE_URL" : null,
    !publishableKey ? "VITE_SUPABASE_PUBLISHABLE_KEY" : null,
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing browser environment: ${missing.join(", ")}`);
  }

  return { url, publishableKey };
}

/** Browser-only publishable client. Never accepts or imports the server secret. */
export function createBrowserSupabaseClient(
  config: BrowserSupabaseConfig = readBrowserSupabaseConfig(),
) {
  return createBrowserClient(config.url, config.publishableKey);
}
