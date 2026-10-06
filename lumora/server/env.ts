// Server-side configuration. Everything secret is read here and never sent to the browser.

const read = (name: string): string | undefined => {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : undefined;
};

const num = (name: string, fallback: number): number => {
  const v = read(name);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const list = (name: string): string[] =>
  (read(name) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const env = {
  get appName() {
    return read('APP_NAME') ?? 'Lumora';
  },

  // ---- Providers -------------------------------------------------------------
  get anthropicKey() {
    return read('ANTHROPIC_API_KEY');
  },
  get openaiKey() {
    return read('OPENAI_API_KEY');
  },
  get openaiBaseUrl() {
    return read('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1';
  },
  get geminiKey() {
    return read('GOOGLE_AI_API_KEY') ?? read('GEMINI_API_KEY');
  },
  get openrouterKey() {
    return read('OPENROUTER_API_KEY');
  },
  get groqKey() {
    return read('GROQ_API_KEY');
  },
  get ollamaBaseUrl() {
    return read('OLLAMA_BASE_URL');
  },
  get customBaseUrl() {
    return read('CUSTOM_OPENAI_BASE_URL');
  },
  get customKey() {
    return read('CUSTOM_OPENAI_API_KEY');
  },
  get customName() {
    return read('CUSTOM_OPENAI_NAME') ?? 'Custom';
  },
  get customModels() {
    return list('CUSTOM_OPENAI_MODELS');
  },
  /** Order in which providers are tried for tiers/fallback. */
  get providerPriority() {
    return list('PROVIDER_PRIORITY');
  },
  get tierOverrides() {
    return {
      fast: read('MODEL_FAST'),
      balanced: read('MODEL_BALANCED'),
      powerful: read('MODEL_POWERFUL'),
      vision: read('MODEL_VISION'),
      longContext: read('MODEL_LONG_CONTEXT'),
    };
  },
  get fallbackEnabled() {
    return read('PROVIDER_FALLBACK') !== 'false';
  },
  get routerStrategy(): 'heuristic' | 'llm' {
    return read('ROUTER_STRATEGY') === 'llm' ? 'llm' : 'heuristic';
  },

  // ---- Search ----------------------------------------------------------------
  get searchProvider(): 'tavily' | 'brave' | 'searxng' | null {
    const p = read('SEARCH_PROVIDER')?.toLowerCase();
    if (p === 'tavily' || p === 'brave' || p === 'searxng') return p;
    if (read('SEARXNG_URL')) return 'searxng';
    if (read('TAVILY_API_KEY') || read('SEARCH_API_KEY')) return 'tavily';
    if (read('BRAVE_API_KEY')) return 'brave';
    return null;
  },
  get searchKey() {
    return read('SEARCH_API_KEY') ?? read('TAVILY_API_KEY') ?? read('BRAVE_API_KEY');
  },
  get searxngUrl() {
    return read('SEARXNG_URL');
  },

  // ---- Transcription (optional, for browsers without speech recognition) ----
  get transcriptionProvider(): { baseUrl: string; key: string; model: string } | null {
    const groq = read('GROQ_API_KEY');
    const openai = read('OPENAI_API_KEY');
    if (read('TRANSCRIPTION_PROVIDER') === 'openai' && openai)
      return { baseUrl: this.openaiBaseUrl, key: openai, model: read('TRANSCRIPTION_MODEL') ?? 'whisper-1' };
    if (groq) return { baseUrl: 'https://api.groq.com/openai/v1', key: groq, model: read('TRANSCRIPTION_MODEL') ?? 'whisper-large-v3-turbo' };
    if (openai) return { baseUrl: this.openaiBaseUrl, key: openai, model: read('TRANSCRIPTION_MODEL') ?? 'whisper-1' };
    return null;
  },

  // ---- Auth ------------------------------------------------------------------
  get supabaseUrl() {
    return read('SUPABASE_URL') ?? read('VITE_SUPABASE_URL');
  },
  get supabaseAnonKey() {
    return read('SUPABASE_ANON_KEY') ?? read('VITE_SUPABASE_ANON_KEY');
  },
  get oauthProviders() {
    return list('SUPABASE_OAUTH_PROVIDERS');
  },
  get appPassword() {
    return read('APP_PASSWORD');
  },
  get sessionSecret() {
    return read('SESSION_SECRET');
  },
  get allowedEmails() {
    return list('ALLOWED_EMAILS').map((e) => e.toLowerCase());
  },
  get adminEmails() {
    return list('ADMIN_EMAILS').map((e) => e.toLowerCase());
  },
  /** Netlify sets CONTEXT=dev under `netlify dev`. */
  get isLocalDev() {
    return process.env.CONTEXT === 'dev' || process.env.NETLIFY_DEV === 'true' || process.env.NODE_ENV === 'test';
  },
  get authModeSetting() {
    return read('AUTH_MODE')?.toLowerCase();
  },

  // ---- Limits / cost control --------------------------------------------------
  get maxOutputTokens() {
    return num('MAX_OUTPUT_TOKENS', 8192);
  },
  get maxRequestBytes() {
    return num('MAX_REQUEST_BYTES', 4_500_000);
  },
  get maxFileBytes() {
    return num('MAX_FILE_BYTES', 10_000_000);
  },
  get maxFiles() {
    return num('MAX_FILES_PER_MESSAGE', 8);
  },
  get maxInputChars() {
    return num('MAX_INPUT_CHARS', 600_000);
  },
  get rateLimitPerMinute() {
    return num('RATE_LIMIT_PER_MINUTE', 20);
  },
  get dailyRequestLimit() {
    return num('DAILY_REQUEST_LIMIT', 500);
  },
  get dailyTokenBudget() {
    return num('DAILY_TOKEN_BUDGET', 0);
  },
  get maxAgentSteps() {
    return num('MAX_AGENT_STEPS', 8);
  },
  get requestTimeoutMs() {
    return num('PROVIDER_TIMEOUT_MS', 55_000);
  },
  get allowedOrigins() {
    return list('ALLOWED_ORIGINS');
  },
};

export type Env = typeof env;
