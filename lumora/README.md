# Lumora — personal multi-model AI workspace

Lumora is a self-hosted AI assistant platform for Netlify. It is a **unified interface and orchestrator**: it connects to the AI providers you choose (Anthropic, OpenAI, Google Gemini, OpenRouter, Groq, any OpenAI-compatible API, or local Ollama). It routes each request to a suitable model and gives the model real tools, all behind your own authentication. There are no fake responses: if a feature needs an API key, the README and the UI say so.

![modes](https://img.shields.io/badge/modes-Auto%20%C2%B7%208%20built--in%20%C2%B7%20custom-8b7bff) ![providers](https://img.shields.io/badge/providers-Anthropic%20%C2%B7%20OpenAI%20%C2%B7%20Gemini%20%C2%B7%20OpenRouter%20%C2%B7%20Groq%20%C2%B7%20Ollama-2fd4c4)

---

## Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Free vs. paid: what needs which API](#free-vs-paid)
4. [Quick start (local)](#quick-start-local)
5. [Environment variables](#environment-variables)
6. [Authentication & database setup](#authentication--database)
7. [Deploy to Netlify](#deploy-to-netlify)
8. [Security model](#security-model)
9. [Cost control](#cost-control)
10. [Extending Lumora](#extending-lumora)
11. [Troubleshooting](#troubleshooting)
12. [Known limitations](#known-limitations)

---

## Features

| Area | What you get |
|---|---|
| **Chat** | Streaming answers, Markdown, GFM tables and task lists, LaTeX math (KaTeX), syntax highlighting, copy buttons, stop, regenerate, retry, edit-and-resend, continue after cut-off, read-aloud |
| **History** | New chat, search, rename, delete, favorites (pin), archive, projects, export (Markdown / JSON / HTML), share (public link with Supabase, or a standalone HTML file) |
| **Modes** | Auto, General, Coding, Research, Writing, Study, Creative, Analysis, Planner, plus your own custom modes (name, description, instructions, personality, model, tier, temperature, tools) |
| **Smart routing** | AUTO mode picks the mode and the model tier (fast / balanced / powerful). It uses a multilingual heuristic router, with an optional LLM router. It switches to a vision model for images and a long-context model for large inputs. Provider and model fallback. |
| **Model selector** | Auto, Fast, Balanced or Powerful tiers, or any model **loaded live** from each provider's model list (searchable) |
| **Tools** | Web search (Tavily / Brave / SearXNG), page reader, calculator, date & time, weather (Open-Meteo), JSON processing, data analysis, Python/JS code execution (browser sandbox, asks permission), memory. Tool activity is shown live. |
| **Web search UX** | Numbered citations `[1]` linked to sources, a sources panel labelled "retrieved by tools, not written by the AI" |
| **Files** | PDF, DOCX, XLSX, CSV, TXT, Markdown, JSON, code files, images. Files are parsed **in your browser**; only the extracted text (or a resized image) is sent with your message. |
| **Vision** | Images automatically route to a vision-capable model |
| **Coding workspace** | File tree, multi-tab CodeMirror editor, run Python (Pyodide) and JavaScript in a sandbox, AI assistant with **diff view** and Apply, ZIP download, file upload |
| **Agents** | Agent mode: plan, multi-step tool use, verify, report. Each step is a separate request. Risky tools need explicit permission. |
| **Memory** | Optional; view, add, edit, delete, clear. The AI saves facts only when they are useful, and every save shows a toast with Undo. |
| **Personalization** | Custom instructions: name, style, language, technical level, personality, about you, things to avoid |
| **Projects** | Per-project instructions, files (used as context), preferred mode and model, conversations |
| **Voice** | Speech-to-text (Web Speech API, or server Whisper via Groq/OpenAI), text-to-speech (browser voices), hands-free voice conversation |
| **Multilingual** | Replies in whatever language you ask for (e.g. "日本語で答えてください"). Reply-language setting. UI in English, Spanish, French, German, Portuguese, Japanese and Chinese. |
| **Admin panel** | Provider health and latency, model availability, tier mapping, usage, token counts, p50/p95 latency, errors, tool failures, limits. Admins only. |
| **Design** | Original dark/light theme, responsive (phone to desktop), keyboard shortcuts (`⇧⌘O` new chat, `⌘,` settings), reduced-motion support |

---

## Architecture

```
Browser (React + Vite SPA)                         Netlify Functions (Node 22, TypeScript)
┌───────────────────────────────┐   NDJSON stream   ┌─────────────────────────────────────────┐
│ Chat UI · Code workspace      │ ───────────────▶ │ /api/chat   one model step per request    │
│ Agent loop (client-driven)    │ ◀─────────────── │   ├─ auth · rate limit · validation (zod) │
│ Client tools: run_code,       │                   │   ├─ AUTO router → mode + tier            │
│   remember (with permission)  │                   │   ├─ Provider registry → model → fallback │
│ File parsing (pdf.js, mammoth,│                   │   └─ Server tools (search, url, calc, …) │
│   read-excel-file) locally    │                   │ /api/models  live model discovery         │
│ DataStore: IndexedDB or       │                   │ /api/config  public config + session      │
│   Supabase (RLS)              │                   │ /api/auth/*  password-mode sessions       │
└───────────────────────────────┘                   │ /api/admin   diagnostics (admins)         │
                                                    │ /api/transcribe  Whisper fallback         │
                                                    │ Netlify Blobs: rate limits, usage, logs   │
                                                    └─────────────────────────────────────────┘
```

**Pipeline:** `AI Provider → Model → Mode → Tools → Response`

* `server/providers/` contains one adapter per API family behind a single `ProviderAdapter` interface (`listModels`, `stream`):
  * `anthropic.ts` uses the official SDK and replays thinking blocks for the same model.
  * `openaiCompatible.ts` covers OpenAI, OpenRouter, Groq, Ollama, LM Studio, Together, Mistral, DeepSeek and vLLM. It adapts automatically when a model rejects a parameter.
  * `gemini.ts` handles Gemini over REST and SSE, and preserves thought signatures.
  * `registry.ts` builds providers from environment variables, discovers models live, maps tiers by naming conventions (overridable) and orders fallbacks.
* `server/tools/` has one module per tool, `index.ts` is the registry, and `ssrf.ts` hardens URL fetching.
* `shared/` holds code used by both sides: types, mode definitions and the router.
* **Why the browser drives the agent loop:** Netlify functions have execution time limits. Each request makes **one** model call plus its server tools, which keeps it short. The browser then runs client tools (sandboxed code, memory) with your consent and sends the next step. Agents never get access to your computer or accounts.

### Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS 4, Zustand | Fast startup, small and simple, lazy-loaded heavy parts (editor, KaTeX, highlighting, PDF, Supabase) |
| Backend | Netlify Functions v2 (streaming `Response`) | Native to Netlify, keys stay server-side |
| Auth / DB | Supabase (free tier), or single-owner password with IndexedDB | Free, OAuth-ready, row-level security; or zero external services |
| Server state | Netlify Blobs | Built in and free; used for rate limits, usage counters and admin logs |
| Markdown | react-markdown, remark-gfm, remark-math, rehype-katex, rehype-highlight | No raw HTML is rendered, which prevents XSS |
| Sandbox | Web Workers (JS) and Pyodide (Python, WebAssembly) | Code never runs on the server |

---

## Free vs. paid

| Capability | Free option | Paid option |
|---|---|---|
| **AI models** (required: at least one) | **Google Gemini** (free tier in AI Studio), **Groq** (free tier), **OpenRouter `:free` models**, **Ollama** (local, `netlify dev` only unless exposed) | Anthropic, OpenAI, OpenRouter paid models, other OpenAI-compatible APIs |
| Web search | **SearXNG** (self-hosted, open source); Tavily's monthly free credits | Tavily, Brave Search API |
| Weather | **Open-Meteo**: free, no key, non-commercial use | — |
| Calculator, date/time, JSON, data analysis, URL reader | Built in, free | — |
| Code execution | Browser sandbox (Pyodide / JS worker): free | — |
| Speech-to-text | Browser Web Speech API (Chrome, Edge, Safari): free | Whisper via Groq (free tier) or OpenAI (paid) for other browsers |
| Text-to-speech | Browser voices: free | — |
| Auth and database | **Supabase** free tier, or password mode (no DB) | Supabase paid plans |
| Hosting | **Netlify** free tier | Netlify paid plans for higher limits |

Free tiers have rate limits and terms that change; check each provider. Lumora never presents a paid API as free.

---

## Quick start (local)

**Requirements:** Node.js 20 or newer (22 recommended), npm, and at least one AI provider key (Gemini or Groq are free).

```bash
cd lumora                 # this folder
npm install               # 1. install dependencies
cp .env.example .env      # 2. add at least one provider key to .env
npm run dev:vite          # 3. run frontend + API at http://localhost:5173
```

* `npm run dev:vite` uses Vite plus a small built-in plugin (`scripts/netlify-functions-dev.ts`) that runs the functions in-process. It is the simplest option.
* For the most production-like setup, use the Netlify CLI: `npm i -g netlify-cli`, then `netlify dev` (or `npm run dev`). It serves at http://localhost:8888 and uses real Netlify Blobs when the site is linked (`netlify link`).
* With no auth variables set, local development runs **without login** (a yellow banner warns you). Set `APP_PASSWORD` to test the login flow.

Other commands:

```bash
npm run build       # typecheck (client + server) and production build into dist/
npm test            # unit + end-to-end engine tests (mock provider, no keys needed)
npm run typecheck
```

---

## Environment variables

Add them to `.env` locally, and to **Netlify → Site configuration → Environment variables** in production. `.env.example` lists every variable with comments. The most important:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY` | Enable each provider (any subset) |
| `CUSTOM_OPENAI_BASE_URL`, `CUSTOM_OPENAI_API_KEY`, `CUSTOM_OPENAI_NAME`, `CUSTOM_OPENAI_MODELS` | Any OpenAI-compatible API |
| `OLLAMA_BASE_URL` | Local models (e.g. `http://localhost:11434`) |
| `PROVIDER_PRIORITY` | Order for automatic choice and fallback, e.g. `gemini,groq,anthropic` |
| `MODEL_FAST`, `MODEL_BALANCED`, `MODEL_POWERFUL`, `MODEL_VISION`, `MODEL_LONG_CONTEXT` | Pin routing targets (`provider:model`). Otherwise picked from live model lists. |
| `ROUTER_STRATEGY` | `heuristic` (default) or `llm` (the fast model classifies ambiguous requests) |
| `SEARCH_PROVIDER`, `SEARCH_API_KEY`, `SEARXNG_URL` | Web search |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ALLOWED_EMAILS`, `ADMIN_EMAILS`, `SUPABASE_OAUTH_PROVIDERS` | Supabase auth and database |
| `APP_PASSWORD`, `SESSION_SECRET` | Single-owner password mode |
| `MAX_OUTPUT_TOKENS`, `RATE_LIMIT_PER_MINUTE`, `DAILY_REQUEST_LIMIT`, `DAILY_TOKEN_BUDGET`, `MAX_FILE_BYTES`, … | Cost control (see below) |

Only the Supabase URL and anon key ever reach the browser, and those are public by design. Every other secret stays in the functions.

---

## Authentication & database

Lumora picks an auth mode automatically (or force one with `AUTH_MODE`):

| Mode | When | Data storage |
|---|---|---|
| **supabase** | `SUPABASE_URL` and `SUPABASE_ANON_KEY` set | Supabase Postgres with row-level security, synced across devices |
| **password** | `APP_PASSWORD` set | Your browser's IndexedDB (nothing stored server-side) |
| **none** | `netlify dev` / local only, or `AUTH_MODE=none` | IndexedDB. **Never use in public.** |
| **locked** | Production with nothing configured | Every API call is refused, which protects your keys |

### Supabase setup (recommended for multi-device)

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor:** paste and run [`supabase/schema.sql`](supabase/schema.sql). It creates tables for users' settings, conversations, messages, memories, custom modes, projects, file metadata and shared snapshots, all with RLS.
3. **Authentication → URL Configuration:** set the Site URL to your Netlify URL and add it to the Redirect URLs (plus `http://localhost:5173` and `http://localhost:8888` for development).
4. Optional OAuth: enable Google or GitHub under **Authentication → Providers**, then set `SUPABASE_OAUTH_PROVIDERS=google,github`.
5. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY` (from **Project Settings → API**) and **`ALLOWED_EMAILS=you@example.com`** in Netlify. The allow-list stops strangers who sign up from using your API keys. `OPEN_SIGNUPS=true` disables it (not recommended).
6. `ADMIN_EMAILS` controls who sees the admin panel. It defaults to the allow-list.

The database layer is swappable: implement the `DataStore` interface in `src/data/store.ts`.

---

## Deploy to Netlify

1. Push this repository to GitHub, GitLab or Bitbucket.
2. In Netlify: **Add new site → Import an existing project**, then pick the repository.
3. **Base directory: `lumora`** (this app lives in a subfolder; the repository root holds an unrelated game). Netlify reads `lumora/netlify.toml`, which sets the build command (`npm run build`), the publish directory (`dist`), the functions directory and Node 22.
4. **Site configuration → Environment variables:** add your keys (at least one provider and one auth option). Mark secret ones as *secret*.
5. Deploy. Every push redeploys automatically. **Redeploy after changing environment variables** (Deploys → Trigger deploy).

With the CLI instead:

```bash
npm i -g netlify-cli
cd lumora
netlify login
netlify init            # or: netlify link
netlify env:set GOOGLE_AI_API_KEY "..."   # repeat for each variable
netlify deploy --build --prod
```

Netlify Blobs (used for rate limits, usage and logs) needs no setup on Netlify.

---

## Security model

* **Secrets:** API keys live only in Netlify environment variables and are read only inside functions. The client bundle never contains them (`/api/config` exposes only non-secret data).
* **Authentication** is checked on every API call. Supabase tokens are verified with Supabase. Password sessions use HMAC-signed, `HttpOnly`, `Secure`, `SameSite=Strict` cookies, passwords are compared in constant time, and logins are rate-limited per IP.
* **Authorization:** email allow-list, admin list, and row-level security in Postgres.
* **CSRF:** state-changing requests require a custom `x-lumora` header and a same-origin `Origin`. The Supabase bearer token is not sent automatically by the browser.
* **Input validation:** zod schemas, request size limits (Netlify accepts about 6 MB), file size and count limits, image MIME allow-list, and per-field length limits.
* **XSS:** Markdown is rendered without raw HTML and with URL sanitizing; links open with `noopener noreferrer`. There is a strict CSP plus security headers in `netlify.toml`. The CSP allows `unsafe-eval` and `wasm-unsafe-eval` only because the browser code sandbox (Pyodide and the JS worker) needs them.
* **SSRF:** the URL reader blocks private, loopback, link-local and metadata addresses, re-validates every redirect, and limits size and time.
* **Abuse prevention:** per-user rate limit, daily request cap, optional daily token budget, and a limit on agent steps.
* **Code execution** never happens on the server. Code runs in browser workers with network APIs disabled. AI-initiated runs need explicit approval unless you opt in.
* **Privacy:** files are parsed client-side, and the admin log stores metadata only, never message content.

---

## Cost control

| Variable | Default | Effect |
|---|---|---|
| `MAX_OUTPUT_TOKENS` | 8192 | Cap per model response |
| `RATE_LIMIT_PER_MINUTE` | 20 | Model requests per user per minute |
| `DAILY_REQUEST_LIMIT` | 500 | Requests per user per UTC day |
| `DAILY_TOKEN_BUDGET` | 0 (off) | Input plus output tokens per user per day |
| `MAX_FILE_BYTES` / `MAX_FILES_PER_MESSAGE` | 10 MB / 8 | Upload limits |
| `MAX_REQUEST_BYTES` / `MAX_INPUT_CHARS` | 4.5 MB / 600k | Request size limits |
| `MAX_AGENT_STEPS` | 8 | Tool-loop steps in agent mode (5 otherwise) |
| `PROVIDER_FALLBACK` | true | Try another provider or model on failure |
| `PROVIDER_PRIORITY` | — | Put free providers first to minimise spend |

Auto routing sends short, simple questions to the fast tier. The admin panel shows token usage per request.

---

## Extending Lumora

* **Add a provider:** if it is OpenAI-compatible, just set the `CUSTOM_OPENAI_*` variables. For a new API family, implement `ProviderAdapter` in `server/providers/` and register it in `registry.ts`.
* **Add a tool:** create `server/tools/myTool.ts` exporting a `ToolDef` (JSON-schema spec plus a `run` function), register it in `server/tools/index.ts`, and add its name to `ToolName` in `shared/types.ts` and to `ALL_TOOLS` in `shared/modes.ts`. Mark it `risk: 'confirm'` if it needs user permission. Set `client: true` and handle it in `runClientTool` (`src/state/chat.ts`) if it must run in the browser.
* **Add or change a built-in mode:** edit `shared/modes.ts`. Users can also create custom modes in Settings.
* **Change routing:** edit `shared/router.ts` (covered by unit tests), or set `MODEL_*` and `ROUTER_STRATEGY`.

### Agents

Agent mode (Tools → Agent mode) instructs the model to restate the goal, plan, execute with tools, check the results and report, for up to `MAX_AGENT_STEPS` steps. The agent can **only** act through the declared tools. Read-only tools run automatically. Tools marked `confirm` (currently code execution) pause the loop and show an approval card with Run once, Always allow for this chat, or Deny. There is no access to your file system, shell or external accounts.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "No AI provider is configured" | Add at least one provider key to the Netlify environment variables, then **redeploy** |
| API returns 404 locally | You ran plain `vite`. Use `npm run dev:vite` (includes the functions) or `netlify dev` |
| "This deployment has no authentication configured" | Set `APP_PASSWORD` or the Supabase variables, then redeploy |
| Supabase sign-in works but the app says the account isn't on the allow-list | Add the email to `ALLOWED_EMAILS` |
| OAuth redirects to localhost or fails | Fix the Site URL and Redirect URLs in Supabase Auth settings |
| Build fails on Netlify | Check that the Base directory is `lumora` and Node is 20 or newer (`NODE_VERSION` in `netlify.toml`), then run `npm run build` locally to see the error |
| Responses stop mid-way ("interrupted") | The function hit Netlify's execution limit. Click **Continue**, lower `MAX_OUTPUT_TOKENS`, or pick a faster model |
| "The selected model is not available" | The model was retired or renamed. Pick another in the model menu (lists are live) or fix `MODEL_*` overrides |
| Web search toggle is disabled | Set `SEARCH_PROVIDER` and the key (or `SEARXNG_URL`). SearXNG must have the JSON format enabled |
| Python "Run" fails | Pyodide downloads from `cdn.jsdelivr.net` on first use; check your network and ad-blockers. JavaScript runs offline. |
| Microphone button missing | Your browser lacks the Web Speech API. Set `GROQ_API_KEY` or `OPENAI_API_KEY` for the server transcription fallback |
| Ollama works locally but not in production | Netlify cannot reach `localhost`. Expose Ollama at a public HTTPS URL (with auth), or use it only with `netlify dev` |
| Rate-limit or budget messages | Adjust `RATE_LIMIT_PER_MINUTE`, `DAILY_REQUEST_LIMIT` or `DAILY_TOKEN_BUDGET` |
| Function logs | Netlify → Logs → Functions. The admin panel (`/admin`) shows recent errors and tool failures |

---

## Known limitations

* **Execution time:** each AI step must finish within Netlify's function time limit. Long answers may be cut off; Lumora detects this and offers **Continue**.
* **Rate limits** use Netlify Blobs counters. They are accurate enough for personal use, but not strictly atomic under heavy concurrency.
* **Code workspace** files are stored in the browser (IndexedDB) on every auth mode. Use ZIP export or download to move them.
* **Scanned PDFs** (images without a text layer) are not OCR'd. Upload page screenshots instead so a vision model can read them.
* **Legacy formats** (`.doc`, `.xls`, `.pptx`) are not parsed. Convert them to DOCX, XLSX or PDF.
* **Sharing links** need Supabase. In password mode, Share downloads a standalone HTML file instead.
* **The heuristic AUTO router** is fast and free but not perfect. You can always override the mode, or set `ROUTER_STRATEGY=llm`.

## Project structure

```
lumora/
├─ netlify.toml            build, functions, redirects, security headers
├─ netlify/functions/      chat, config, auth, models, admin, transcribe (HTTP entry points)
├─ server/                 server-only code
│  ├─ providers/           anthropic, openaiCompatible, gemini, registry, sse
│  ├─ tools/               webSearch, readUrl, calculator, datetime, weather, jsonTool, dataAnalysis, clientTools, ssrf
│  ├─ chat.ts              the engine (validation → routing → model → tools → stream)
│  ├─ auth.ts env.ts http.ts kv.ts limits.ts logger.ts prompt.ts
├─ shared/                 types, modes, router (used by client + server)
├─ src/                    React app
│  ├─ features/            chat, sidebar, settings, projects, code, admin, share, auth
│  ├─ components/          UI primitives
│  ├─ data/                DataStore (IndexedDB / Supabase)
│  ├─ state/               app + chat stores (agent loop)
│  ├─ lib/                 api, streaming, files, sandbox, voice, export
│  ├─ workers/             python (Pyodide) + js sandboxes
│  └─ i18n/                UI translations
├─ supabase/schema.sql     database schema + RLS
├─ scripts/                Vite dev plugin that runs functions locally
└─ tests/                  vitest: router, tools, providers, auth, end-to-end engine
```
