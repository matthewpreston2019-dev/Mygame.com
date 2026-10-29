# AI Worker Factory

A visual command centre for your AI projects: a 3D world of work areas, a chat to give instructions, and Claude-powered specialist workers that run in parallel on a server, even when your laptop is off.

Everything for the factory lives in this `factory/` folder. Nothing outside it is touched.

---

## Architecture in one minute

```
 iPhone / PC browser                         Cloud server (or your PC)
┌──────────────────────┐   HTTPS + live    ┌──────────────────────────────────────────┐
│ 3D world (Three.js)  │ ◄─── events ───── │ Manager ── plans each chat message        │
│ Chat · Panels        │ ──── requests ──► │   │        (1 cheap Claude call)          │
└──────────────────────┘                   │   ▼                                       │
                                           │ Worker pool ── runs tasks in parallel     │
                                           │   │  (limit: 3, set in Settings)          │
                                           │   ├─ Researcher  ├─ Engineer ├─ Creator   │
                                           │   ├─ Analyst     ├─ Automator├─ Assistant │
                                           │   ▼                                       │
                                           │ Skills → Claude API → Verify → Save       │
                                           │                                           │
                                           │ Scheduler · Approvals · Budget · Logs     │
                                           │ Storage: data/ (JSON + Markdown files)    │
                                           └──────────────────────────────────────────┘
```

1. **You write in the chat.** The **manager** makes one call to an economical model (Haiku) that either answers you directly or splits the request into tasks: one area (cloud), one project, one specialist worker each.
2. **The pool starts every independent task at once**, up to the parallel limit. A task only waits when it genuinely needs another task's result (for example, a business case that needs the research first). That result is then passed to it automatically.
3. **Each worker** checks for a matching skill, does the work (Sonnet by default; Opus only for tasks the manager marks as complex; web search for research), then a cheap **verification** step checks the result against the task. If it fails, the worker revises it once.
4. **Results are saved once**, in a clear place: `data/results/<cloud>/<project>/<task>.md`. Identical requests within 7 days reuse the saved result instead of paying again.
5. **The browser gets live updates** pushed from the server (no polling). If the server is unreachable, the interface says **Offline** and shows tasks as "last known", never as running.

### What is real and what is not

- This is a **dedicated app that uses the Claude API**. It does not plug into, replace, or inherit features from the official Claude app; that isn't possible.
- Workers **cannot send messages, publish, spend money or delete files**. When a task needs one of those, the worker prepares it and it appears under 🔔 **Approvals**. No outbound connectors (email, YouTube, payments) are installed yet, so an approved action is marked *ready for you to carry out*. The app never claims it did it.
- Background work only continues while the **server** is running. Running it on your laptop stops when the laptop sleeps. To keep it going with the laptop off, host it in the cloud (below).

---

## Folder map

```
factory/
├── server/                    Back end (Node.js, no framework)
│   ├── index.js               Start-up: load data, recover work, start scheduler + web server
│   ├── config.js              All settings (from environment variables / .env)
│   ├── core/
│   │   ├── store.js           Persistent storage (data/db.json + result files)
│   │   ├── budget.js          Daily / monthly spending limits
│   │   └── log.js             Task and error log (data/logs/*.jsonl)
│   ├── ai/
│   │   └── claude.js          The only file that calls Claude: model tiers, cost, demo mode
│   ├── factory/
│   │   ├── world.js           The 7 clouds, starter projects and 6 worker types
│   │   ├── manager.js         Chat message → plan → tasks (+ reuse of earlier results)
│   │   ├── pool.js            Parallel execution, limits, dependencies, retries, recovery
│   │   ├── worker.js          One task: skills → work → verify → save → approvals
│   │   ├── verify.js          Automatic result checking
│   │   ├── skills.js          Find, import, validate and create skills
│   │   ├── approvals.js       Sensitive actions wait here for you
│   │   ├── scheduler.js       Daily briefing and recurring jobs
│   │   └── tasks.js           Task records and live updates
│   └── http/
│       ├── server.js          Routing, access token, static files
│       ├── routes.js          Every API endpoint, in one list
│       └── events.js          Live updates to the browser
├── public/                    Front end (plain ES modules, no build step)
│   ├── index.html
│   ├── css/app.css
│   └── js/
│       ├── main.js            Wires everything together
│       ├── api.js             Requests + live connection (auto-reconnect)
│       ├── state.js           The interface's copy of the factory
│       ├── world/             The 3D world
│       │   ├── scene.js       Camera, controls, clicking, zoom animation
│       │   ├── clouds.js      Cloud shapes, labels, orbiting worker orbs
│       │   ├── links.js       Information-flow lines and particles
│       │   └── backdrop.js    Stars, grid, manager core
│       └── ui/
│           ├── chat.js        Chat
│           ├── panel.js       Cloud panel (Projects · Workers · Skills · Tasks)
│           ├── drawers.js     Live tasks and Approvals
│           ├── settings.js    Access, limits, schedules, logs
│           ├── tasks.js       Task rows and result viewer
│           ├── modal.js · markdown.js · dom.js   Small helpers
├── skills/                    Built-in skills (Markdown, ships with the app)
├── test/                      Automated tests (npm test)
├── data/                      Created at runtime: your tasks, results, learned skills, logs
├── Dockerfile · render.yaml   Cloud hosting
└── .env.example               Copy to .env and fill in
```

Dependencies: just two packages, `@anthropic-ai/sdk` (Claude API) and `three` (3D, served by the app itself, so no external CDN is needed).

---

## Run it on your Windows PC

Requires [Node.js 20+](https://nodejs.org).

```powershell
cd factory
npm install
copy .env.example .env      # then open .env and paste your ANTHROPIC_API_KEY
npm start
```

Open <http://localhost:8787>.

- No API key yet? Run `npm run demo` to explore with simulated, clearly labelled output.
- Get an API key at <https://console.anthropic.com> (usage is billed per token, separately from a Claude.ai subscription).

## Run it in the cloud (works with your laptop off, reachable from iPhone)

**Render** (simplest; about $7/month for an always-on instance with a disk):

1. Push this repository to GitHub (already done if you're reading this there).
2. On render.com: **New → Blueprint**, choose the repository and set the blueprint file to `factory/render.yaml`. If your Render account doesn't offer a blueprint path, create a **Web Service** by hand instead: root directory `factory`, build `npm ci --omit=dev`, start `node server/index.js`, add a 1 GB disk at `/var/data`, and set the environment variables listed in `render.yaml`.
3. In the service's **Environment**, paste your `ANTHROPIC_API_KEY`. Copy the generated `FACTORY_TOKEN`.
4. Open the service URL, click **Settings** (⚙), paste the token, then **Save**.

**Anything else with Docker** (Fly.io, Railway, a VPS):
```bash
docker build -t worker-factory .
docker run -d -p 8787:8787 -v factory-data:/data \
  -e ANTHROPIC_API_KEY=sk-ant-... -e FACTORY_TOKEN=<long random string> worker-factory
```
Always put it behind HTTPS (Render, Fly and Railway do this for you).

The server refuses to start on a public address without `FACTORY_TOKEN`, so it can never be left open.

**On iPhone:** open the URL in Safari → Share → **Add to Home Screen**. It opens full-screen like an app.

---

## Using it

| You want to… | Do this |
|---|---|
| Look around | Drag to rotate (also up/down), scroll or pinch to zoom, right-drag or two-finger drag to pan |
| Open an area | Click a cloud. The camera flies in and the panel shows Projects, Workers, Skills and Tasks |
| Go back | **← World**, Esc, or double-click empty space |
| Give work | Type in the chat, e.g. *"Research Minecraft server trends, write a development plan for a server website, and analyse whether selling merch is worth it"* |
| See live progress | The **running** pill (top right), the glowing orbs and flowing particles in the world, or the chips under the manager's reply |
| Read a result | Click a finished task (or its chip). Results show whether they were verified, the model, cost and skills used |
| Recurring work | Ask: *"Every Monday at 9, scan gaming trends"*, or use **Settings → Schedules** |
| Approve actions | 🔔 **Approvals** |
| Control spending | **Settings → Limits**: daily and monthly budget, number of parallel workers |

**Reading the world:** each cloud is an area of work. The small orbs circling it are its workers: grey means idle, glowing means working, amber means waiting. Lines from the central **Manager** carry particles that speed up while an area is busy. A white pulse travelling back to the manager means a result was collected. A white arc between two clouds means one worker is passing its result to another.

---

## How the main parts work

**Parallel workers.** `pool.js` is event-driven: it re-checks only when a task is added or finishes. Independent tasks start immediately; a task with dependencies shows *Waiting for …* and starts the moment its inputs are done. Rate limits and network errors are retried with backoff (up to 3 attempts). On restart, interrupted tasks are queued again automatically.

**Skills.** Small Markdown instruction files (`skills/` built-in, `data/skills/` learned). Before each task:
1. Local skills are matched by keywords. This is free and uses no tokens.
2. Only if the manager flagged the task as recurring and nothing matched: trusted sources are searched (see below), then a small new skill is written by the economical model.
3. Every new skill is validated (size, required fields, no unsafe content, no duplicates) before it's used.
4. At most the two best matches are added to the prompt.

To add a **trusted source**, host an index file over HTTPS and list it in `TRUSTED_SKILL_SOURCES`:
```json
{ "skills": [{ "name": "Steam page copy", "description": "…", "tags": ["steam", "store"], "url": "steam-page-copy.md" }] }
```
Skill files must be on the same host as the index. You can also drop `.md` skills straight into `data/skills/`.

**Cost control.**
- Economical model (Haiku) for planning, verification, briefings and skill writing.
- Sonnet for most work. Opus only when the manager judges a task complex.
- Web search is capped at 3 searches per research task.
- Identical requests reuse earlier results for 7 days (`REUSE_DAYS`).
- Recurring research only reports what changed since the last run.
- Budget limits pause work instead of overspending. Raising the limit resumes it.
- Spend is shown live in the top bar.

**Daily briefing.** Built from the factory's own records (finished results, failures, pending approvals, spend), so it costs one small call. It's on by default at 08:00 server time (`TZ` sets the time zone) and can be changed in Settings.

**Safety and logs.** Approvals as described above; project deletion asks you to confirm; all API routes require the access token when one is set; completed tasks and errors are written to `data/logs/YYYY-MM-DD.jsonl` and shown in **Settings → Logs**.

---

## Tests

```bash
npm test
```
Covers skills, approvals, schedules, budget, the parallel pool (limits, dependencies, failure handling, reuse) and a full chat → plan → workers → verified results run against a local mock of the Claude API. The tests make no real API calls.

## Configuration

See `.env.example`. The essentials are `ANTHROPIC_API_KEY`, `FACTORY_TOKEN`, `DAILY_BUDGET_USD`, `MONTHLY_BUDGET_USD`, `MAX_PARALLEL` and `TZ`. Model IDs can be changed with `MODEL_FAST`, `MODEL_STANDARD` and `MODEL_STRONG`.
