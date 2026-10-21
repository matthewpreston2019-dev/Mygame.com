# Daily Companion 2.0

Your personal coach + companion — an installable app (PWA) for iPhone that plans
your afternoons around school, texts you at the right moments (even when the app
is closed), tracks quests, steps, food, workouts, study and sleep, and tells you
honestly how your day and week went.

- **Live app:** https://daily-companion-coach.netlify.app
- **Install page:** https://daily-companion-coach.netlify.app/download
- **Backend:** Supabase project `daily-companion` (Frankfurt, free plan)
- **Hosting:** Netlify project `daily-companion-coach` (free plan)

---

## 1. Finish setup (from your iPhone, ~5 minutes)

Most of it is already done: the database, security rules, server functions and
the every-minute scheduler are live on Supabase, and the Netlify project exists.
Two things are left that only you can do.

### Step 1 — Connect Netlify to GitHub (once)

1. Open **app.netlify.com** in Safari and sign in.
2. Open the project **daily-companion-coach**.
3. Go to **Project configuration → Build & deploy → Continuous deployment →
   Link repository** (on a fresh project there's also a big *"Link to Git"* button).
4. Choose **GitHub** → repository **matthewpreston2019-dev/Mygame.com**.
5. Fill in exactly:

   | Setting | Value |
   |---|---|
   | Branch to deploy | `main` (after you merge this work) — or `claude/daily-companion-2-pwa-9r9gnq` to use it right away |
   | Base directory | `daily-companion` |
   | Build command | `node scripts/build.mjs` (pre-filled from `netlify.toml`) |
   | Publish directory | `daily-companion/dist` |

6. Tap **Deploy**. After ~30 seconds the app is live at
   https://daily-companion-coach.netlify.app. Every later push to that branch
   redeploys automatically, and the app shows **"A new version is ready → Update"**.

No environment variables are needed: the app only uses the public Supabase URL
and *publishable* key (in `web/js/config.js`), which are safe to be public —
the database's Row Level Security only lets a signed-in user see their own rows.

### Step 2 — Create your account and install

1. Open **https://daily-companion-coach.netlify.app** in **Safari**.
2. Tap **Create account**, enter your email and a password (8+ characters).
   Your iPhone offers to save it in Passwords — say yes.
3. **Save the recovery code** it shows (Notes, Passwords, or a screenshot). It's
   the only way to reset a forgotten password, and it's shown once.
   *(After this, the app is locked to your account — nobody else can sign up.)*
4. Install: tap **Share** → **Add to Home Screen** → **Add**.
5. Open **Companion** from your Home Screen and sign in once.
6. Go through the short setup (language, your body & 69 kg goal, your week).
7. Tap **Turn on notifications** → **Allow**. In **Profile → Notifications**
   tap **Send test** — you should get a notification within seconds.

Notifications on iPhone need iOS 16.4+ and only work in the Home Screen app, not
in a Safari tab.

### Step 3 (optional) — Steps from Apple Health

In the app: **Profile → Steps from Apple Health**. It shows your personal URL and
secret token with copy buttons, plus the exact Shortcut steps:

1. **Shortcuts** app → **+** → name it "Send steps".
2. Add **Find Health Samples** → Type **Steps**, filter **Start Date is Today**.
3. Add **Calculate Statistics** → **Sum**.
4. Add **Get Contents of URL** → paste the URL → Method **POST** →
   Header `x-steps-token` = your token → Request Body **JSON** → field `steps`
   (Number) = **Statistics**.
5. Tap ▶︎ once and allow Health access (you'll see `"ok": true`).
6. **Automation** tab → **+** → **Time of Day** 20:45, Daily, **Run Immediately**
   → pick "Send steps". Optionally another at 23:45 for the final count.

If the number is higher than the Health app shows, iPhone and Apple Watch are
both counting: add the filter **Source is …** in step 2 and pick one.

---

## 2. What's in the app

| Tab | What you get |
|---|---|
| **Today** | Greeting, level/XP and streak, rings for study, steps, kcal, protein, today's plan as a timeline with "now", quests (tap to tick; auto-quests complete from your data), sleep log in the morning, check-in in the evening, tomorrow's plan after 17:00 |
| **Coach** | Chat feed of everything the coach sent; answer the 21:00 check-in right in the chat (the coach replies); ask "What's my plan?" / "How am I doing today?"; **Reports**: today + weekly (study hours, gym x/3, kcal & protein averages, steps vs goal, sleep score, streak) with an honest verdict |
| **Track** | **Food** (meals, favorites, recent, 14-day history) · **Workout** (Upper/Lower templates, last session shown as targets, PRs, rest timer) · **Steps** (manual + Apple Health, weekly chart) · **Study** (timer that survives closing the app, manual entry, weekly chart) · **Sleep** (bed/wake log, weekly consistency score) · **Weight** (trend toward 69 kg) |
| **Calendar** | Day and week view of school, study, gym, exams and your events; add/edit events; exams automatically adapt the plan; export to `.ics` (Apple/Google Calendar) |
| **Profile** | Level & streaks; schedule, targets, quests, workout templates, notifications (per type), steps shortcut, language (6 incl. Arabic right-to-left), dark/light/auto theme, sync status, password, recovery code, data export, sign out |

### How your days are planned (all editable in Profile → Schedule)

- **Short days (Mon/Wed/Fri)**, free 14:30: relax 60 min → gym (Upper/Lower/Upper)
  75 min → shower & food 45 min → study 2 h.
- **Long days (Tue/Thu)**, free 17:00: relax → ~45 min light review. No gym.
- **Free days (weekend)**: a flexible study block (11:00) and a **catch-up gym
  session** if you're behind on the week.
- Evening: **21:00** check-in · **21:30** daily summary · **22:00** wind-down ·
  **22:30** lights out.
- If school ends late, the plan **trims itself honestly** so you're done by
  check-in (shorter break → shorter study → gym moved to the next gym day).

### Tomorrow planner

Tap the day badge on Today, **Plan** on the tomorrow card, or any day in the
Calendar. Mark an **exam** (subject + time), a different day type (short / long /
free / rest), a later school end, or skip gym/study. Effects: the day before an
exam becomes exam prep (60 min even on a long day), the exam day gets lighter
study and a morning message, and every coach message adapts.

### Coach messages (push notifications)

| When | Message |
|---|---|
| When school ends | After-school plan |
| 30 min before gym | Split + last session's top set to beat |
| Study start / end | Start nudge / "log it" |
| ~20:00–20:15 | Missed-goal nudge — only if something is actually missing |
| 21:00 | Check-in: "Did you study? Did you train?" (answer in the app) |
| 21:30 | Honest daily summary |
| 22:00 | Wind-down |
| Sunday 19:00 | Weekly report |
| 07:00 on exam days | Short exam-morning message |

Each can be switched off in **Profile → Notifications** (they still appear in the
Coach chat). A message is never sent twice, and if the scheduler is briefly late
it still sends within 90 minutes.

---

## 3. How it works

```
iPhone (Home Screen app)                      Supabase (free)
┌──────────────────────────────┐   sync    ┌───────────────────────────────────┐
│ web/  (static files, Netlify)│ ────────▶ │ Postgres + Row Level Security     │
│  • Preact UI, 6 languages    │ ◀──────── │ Auth (email + password)           │
│  • IndexedDB cache + outbox  │           │ Edge Functions:                   │
│    → works fully offline     │           │   account · push · steps ·        │
│  • service worker (offline,  │ ◀──push── │   coach-tick                      │
│    notifications)            │           │ pg_cron: coach-tick every minute  │
└──────────────────────────────┘           └───────────────────────────────────┘
          ▲ Web Push via Apple's push service (VAPID, end-to-end encrypted)
```

- **Offline-first:** everything you log is saved on the phone first and queued;
  it uploads in order when you're online (app start, every minute, when the
  connection returns). Nothing is lost if you clear Safari — your data lives in
  Supabase and downloads again when you sign in.
- **Time zone:** all planning uses Europe/Berlin wall-clock time (daylight saving
  handled), on the phone and on the server.
- **Same logic everywhere:** `web/js/shared/` (planner, stats, coach texts) runs
  in the app *and* on the server, so the push messages always match the app.

### Folder map

```
daily-companion/
├── netlify.toml            Netlify build + security headers
├── scripts/build.mjs       "build": copies web/ → dist/, stamps the service worker
├── scripts/sync-shared.mjs copies web/js/shared → supabase/functions/_shared/app
├── scripts/render-icons.mjs regenerates PNG icons + iPhone splash screens
├── web/
│   ├── index.html, download.html, manifest.webmanifest, sw.js
│   ├── css/app.css         all styles (dark/light, RTL-safe)
│   ├── icons/              icon.svg + generated PNGs
│   ├── vendor/             Preact, htm, supabase-js (unmodified copies)
│   └── js/
│       ├── config.js       Supabase URL + publishable key
│       ├── main.js, app.js boot + root (auth → onboarding → tabs)
│       ├── lib/            store (offline sync), push, i18n, ui, quests, …
│       ├── shared/         planner, stats, coach (also used by the server)
│       ├── i18n/           en, es, de, ru, zh, ar
│       ├── components/     icons, rings, charts, sheets
│       └── screens/        today, coach, track/*, calendar, profile, settings/*
├── supabase/
│   ├── migrations/         0001 schema+RLS · 0002 locks · 0003 scheduler
│   └── functions/          account · push · steps · coach-tick · _shared
└── tests/                  unit, i18n, web-push crypto, browser end-to-end
```

---

## 4. Changing things yourself

- **Texts:** UI text is in `web/js/i18n/<lang>.js`; coach messages are in
  `web/js/shared/coach-text.js`. Edit on GitHub (pencil icon) → commit → Netlify
  redeploys in ~30 s.
- **Defaults** (schedule, targets): `web/js/shared/defaults.js` — or just change
  them in the app.
- **Anything in `web/js/shared/`** is also used by the server. After editing it,
  run `node scripts/sync-shared.mjs` and redeploy the Edge Functions (or ask
  Claude: "sync shared code and redeploy the coach-tick function").
- **Database changes:** add a new numbered file in `supabase/migrations/` and
  apply it in the Supabase dashboard → SQL Editor.

### Checks (on a computer or in Claude Code)

```bash
cd daily-companion
npm test                                   # unit tests + translation check
node tests/check-i18n.mjs --strict         # every language has every key
node scripts/build.mjs && NODE_PATH=$(npm root -g) node tests/e2e/run.mjs   # full browser run
```

No `npm install` is needed — the app has zero dependencies to install.

---

## 5. Troubleshooting

| Problem | Fix |
|---|---|
| No notifications | Must be opened from the Home Screen icon (not Safari). Profile → Notifications → Send test. If "Blocked": iPhone Settings → Notifications → Companion → Allow. |
| "Offline" banner | Everything still works; changes sync when you're back online. Profile → Sync shows what's waiting. |
| Forgot password | Sign-in screen → Forgot password → enter email + recovery code + new password. |
| Lost recovery code | While signed in: Profile → New recovery code. |
| Steps not arriving | Profile → Steps from Apple Health shows the last received value. Re-copy the token; run the Shortcut manually to see the error message. |
| App looks old after a change | Close and reopen it — it shows "A new version is ready → Update". |
| Supabase project paused | Free projects pause after ~1 week with no activity. The every-minute scheduler and daily use keep it active; if it ever pauses, open supabase.com → project → **Restore**. |

## 6. Honest limitations

- iPhone notifications can't have Yes/No buttons (Apple doesn't support action
  buttons for web apps) — tapping the 21:00 check-in opens the chat where you
  answer with one tap.
- Steps come from Apple Health only through the Shortcut (web apps can't read
  Health directly). Two automations (20:45 and 23:45) keep it close to real time.
- Exact push timing depends on Apple's push service; messages normally arrive
  within seconds of their minute.
