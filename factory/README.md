# AI Worker Factory

A visual command centre for your AI projects: a 3D world of work areas, a chat to give instructions, and AI workers that run in parallel in the cloud, so they keep going while your laptop is off. Everything runs on free plans.

Everything for the factory lives in this `factory/` folder. Nothing outside it is touched.

---

## How it works

```
 iPhone / PC browser                    Supabase (free)                                 Google (free)
┌────────────────────┐  sign-in  ┌────────────────────────────────────────────┐  ┌──────────────────┐
│ Netlify (free)     │ ───────►  │ Database: projects, tasks, results, skills │  │ Gemini — the AI  │
│ 3D world · chat    │ ◄───────  │ Live updates to every open screen          │  │ Gmail · YouTube  │
│ panels · settings  │   live    │                                            │  └────────▲─────────┘
└────────┬───────────┘           │ "factory" function                         │           │
         │ actions               │   manager → plans each chat message ───────┼───────────┤
         └─────────────────────► │   pool    → starts tasks in parallel       │           │
                                 │   worker  → skills → work → verify ────────┼───────────┘
                                 │ Every 5 min: schedules, retries            │  GitHub: your Obsidian vault
                                 └────────────────────────────────────────────┘  (second brain)
```

1. **You write in the chat.** The manager makes one quick AI call that either answers you directly or splits the request into tasks: one area (cloud), one project and one specialist worker each.
2. **Independent tasks start at the same time**, each in its own server run, up to your parallel limit. A task waits only when it really needs another task's result, and that result is handed to it.
3. **Each worker** picks a matching skill, gathers context (results it depends on, earlier work in the project, your Obsidian notes, your YouTube stats), does the work, and a second quick check verifies it. If the check fails, the worker revises it once.
4. **Results are stored once.** Asking the same thing again within 7 days reuses the earlier result instead of spending AI requests. With Obsidian connected, each result also becomes a note in your vault.
5. **Your screen updates live.** If the connection drops, the factory says **Offline** and shows tasks as "last known". It never pretends something is running.

### Honest limits
- **The AI is Google Gemini's free tier:** a few dozen requests per day (the exact number depends on Google). Each task uses 1–3 requests. When today's allowance runs out, work **pauses** and continues the next day. On the free tier, Google may use what you send to improve its models.
- **Nothing sensitive happens without you.** Workers draft emails and YouTube uploads, then wait under 🔔 **Approvals**. Approved emails are sent from your Gmail. Approved videos upload **as private**, because YouTube keeps uploads from personal apps private until you publish them in YouTube Studio. Other actions (spending money, deleting things) are only marked "ready for you to carry out".
- **Supabase free projects pause after a week with no use.** Opening the factory now and then keeps it awake. If it does pause, press "Restore" in the Supabase dashboard.
- **This is its own app.** It can't plug into the Claude app or use a Claude subscription.

---

## Folder map

```
factory/
├── app/                              The interface (static files, hosted on Netlify)
│   ├── index.html · css/app.css
│   └── js/
│       ├── main.js                   Wires sign-in, data, live updates, world, panels, chat
│       ├── config.js                 Backend address (public by design)
│       ├── api.js                    Reads tables, live channel, sends actions
│       ├── state.js                  The interface's copy of the factory
│       ├── world/                    The 3D world
│       │   ├── scene.js              Camera, controls, clicking, zoom animation
│       │   ├── clouds.js             Cloud shapes, labels, orbiting worker orbs
│       │   ├── links.js              Information-flow lines and particles
│       │   └── backdrop.js           Stars, grid, manager core
│       └── ui/
│           ├── auth.js               Sign-in / choose password
│           ├── chat.js               Chat
│           ├── panel.js              Cloud panel: Projects · Workers · Skills · Tasks
│           ├── drawers.js            Live tasks · Approvals (send email, upload video)
│           ├── settings.js           General · AI · Connections · Schedules · Logs
│           ├── tasks.js              Task rows and result viewer
│           └── modal.js · markdown.js · dom.js
├── supabase/
│   ├── migrations/                   The database, in order
│   │   ├── 001_schema.sql            Tables and security rules (only you can read)
│   │   ├── 002_engine.sql            Parallel task claiming, daily AI allowance, schedules, 5-min job
│   │   ├── 003_seed.sql              The 7 clouds, starter projects, built-in skills, daily briefing
│   │   └── 004_hardening.sql         Advisor fixes
│   └── functions/factory/            The one server function
│       ├── index.ts                  Routes: actions · run a task · tick · Google callback
│       └── lib/
│           ├── api.ts                Every action the interface can take
│           ├── manager.ts            Chat message → plan → tasks (+ reuse)
│           ├── pool.ts               Parallel runs, retries, pausing
│           ├── worker.ts             One task from start to finish
│           ├── verify.ts             Automatic result checking
│           ├── skills.ts             Find, import, validate, create skills
│           ├── approvals.ts          Approve / reject sensitive actions
│           ├── schedules.ts          Daily briefing and recurring jobs
│           ├── ai.ts                 Gemini: model choice, allowance, errors
│           ├── google.ts             Gmail and YouTube
│           ├── obsidian.ts           Your vault via GitHub
│           ├── db.ts                 Database helpers
│           └── logic.ts              Pure logic (tested)
├── scripts/vendor.js                 Copies Three.js + Supabase into app/vendor (build step)
├── test/logic.test.js                npm test
└── netlify.toml                      Netlify build settings
```

---

## Where it runs (all free plans)

| Piece | Service | Address |
|---|---|---|
| Interface | Netlify site `worker-factory-matthew` | https://worker-factory-matthew.netlify.app |
| Database, server, schedules | Supabase project `worker-factory` | https://pjdcwuvrfydjydhqvfhm.supabase.co |
| AI | Google AI Studio (Gemini) | your free key |

### Publishing the interface (one time)
In Netlify: open **worker-factory-matthew** → **Project configuration → Build & deploy → Link repository** → GitHub → `Mygame.com` →
- Branch: `claude/ai-worker-factory` (or `main` once merged)
- Base directory: `factory`
- Build command and publish folder come from `netlify.toml`.

From then on, every push updates the site automatically.

### Updating the server
The server function and database are deployed with the Supabase CLI (`supabase functions deploy factory --no-verify-jwt`, and `supabase db push` for new migrations), or by asking Claude, which deploys them through the Supabase connector.

---

## First run

1. Open the site and choose **"First time? Use your setup code"**. Enter the code Claude gave you and pick a password (8+ characters).
2. **Settings → AI:** create a free key at https://aistudio.google.com/apikey and paste it. The factory chooses the best free Flash models for it automatically.
3. **Settings → Connections → Google** (Gmail & YouTube): follow the five steps shown there (about 10 minutes, free).
4. **Settings → Connections → Obsidian:** follow the steps shown there (free GitHub repo + the free Obsidian Git plugin).
5. **On iPhone:** open the site in Safari → Share → **Add to Home Screen**.

Lost your password? Ask Claude for a new setup code, or run `select public.issue_setup_code();` in the Supabase SQL editor.

---

## Using it

| You want to… | Do this |
|---|---|
| Look around | Drag to rotate, scroll or pinch to zoom, right-drag or two-finger drag to pan |
| Open an area | Click a cloud: the camera flies in and the panel shows Projects, Workers, Skills and Tasks |
| Go back | **← World**, Esc, or double-click empty space |
| Give work | Chat, e.g. *"Research Minecraft server trends, write a YouTube script about my server, and email my supplier about merch prices"* |
| Recurring work | *"Every Monday at 9, scan gaming trends"*, or **Settings → Schedules** |
| Approve emails / uploads | 🔔 **Approvals** |
| Watch your usage | The **"x / 40 AI today"** pill; limits in **Settings → General** |

**Reading the world:** the small orbs circling a cloud are its workers: grey means idle, glowing means working, amber means waiting. Particles along the lines from the central **Manager** speed up while an area is busy. A white pulse back to the manager means a result was collected. A white arc between clouds means one worker is passing its result to another.

**Skills:** before each task the factory checks its saved skills (free, no AI). For recurring kinds of work with no match, it looks in your vault's `Factory/Skills` folder, then writes a small new skill itself, validates it and saves it to the vault too. At most two skills are loaded per task.

---

## Tests

```bash
npm install
npm test        # pure logic: skills, approvals, Gemini schema/model choice, email format, planner
```
Type-check the server with Deno: `deno check --node-modules-dir=none supabase/functions/factory/index.ts`.
