# Vendored libraries (do not edit)

These are unmodified copies of open-source libraries, stored here so the app
works offline and never depends on a third-party CDN.

| File | Package | Version | License |
|---|---|---|---|
| preact.module.js | preact (dist/preact.module.js) | 10.24.3 | MIT |
| hooks.module.js | preact/hooks (dist/hooks.module.js) — import path changed to `./preact.module.js` | 10.24.3 | MIT |
| htm.module.js | htm (dist/htm.module.js) | 3.1.1 | Apache-2.0 |
| supabase.js | @supabase/supabase-js (dist/umd/supabase.js) | 2.117.2 | MIT |

To update one: `npm pack <package>@<version>`, unpack, and copy the same file over.
