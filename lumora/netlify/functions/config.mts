import type { Config } from '@netlify/functions';
import type { PublicConfig } from '../../shared/types';
import { authMode, sessionInfo } from '../../server/auth';
import { env } from '../../server/env';
import { json } from '../../server/http';
import { providerInfo } from '../../server/providers/registry';

// Public, non-secret configuration for the browser (the Supabase anon key is designed to be public).
export default async (req: Request) => {
  const mode = authMode();
  const session = await sessionInfo(req);
  const cfg: PublicConfig = {
    appName: env.appName,
    authMode: mode,
    ...(mode === 'supabase' && env.supabaseUrl && env.supabaseAnonKey
      ? { supabase: { url: env.supabaseUrl, anonKey: env.supabaseAnonKey, oauthProviders: env.oauthProviders } }
      : {}),
    // Provider names are only revealed to signed-in users.
    providers: session.authenticated ? providerInfo() : [],
    searchProvider: session.authenticated ? env.searchProvider : null,
    transcription: session.authenticated && !!env.transcriptionProvider,
    limits: {
      maxFileBytes: env.maxFileBytes,
      maxRequestBytes: env.maxRequestBytes,
      maxFiles: env.maxFiles,
      maxAgentSteps: env.maxAgentSteps,
    },
    ...(mode === 'none' ? { devWarning: 'Authentication is disabled (AUTH_MODE=none or local development). Do not expose this deployment publicly.' } : {}),
  };
  return json({ config: cfg, session });
};

export const config: Config = { path: '/api/config' };
