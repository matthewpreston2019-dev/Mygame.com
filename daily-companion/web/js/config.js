// =============================================================================
// App configuration.
// These two values are *meant* to be public: the publishable key only allows
// what the database's Row Level Security rules allow (your own rows, once
// signed in). Never put a "service_role" / secret key in this file.
// =============================================================================

export const SUPABASE_URL = 'https://igyygavrabnrmrkxtyni.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_OiqN5GeY9NEoZEDwyTRqzg_8wH7lPJN';

// Edge Functions live under the project URL.
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// Shown in Settings → About. The service worker gets its own build id from
// scripts/build.mjs on every Netlify deploy.
export const APP_VERSION = '2.0.0';
