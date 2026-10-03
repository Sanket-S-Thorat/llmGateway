# LLM Gateway — Local Setup Guide

This walks through running your modified copy of LLM Gateway locally, with the
new **native model sync** job enabled (the daily job that pulls model lists
straight from each provider's own API — no dependency on the paid
llmgateway.co catalog feed).

---

## 1. Prerequisites

| Requirement | Version | Check with |
|---|---|---|
| Node.js | 20+ (22 recommended — see `.nvmrc`) | `node -v` |
| npm | bundled with Node | `npm -v` |
| git | any recent version | `git --version` |

This project is an npm **workspace** (`shared`, `server`, `client`, `cli`), so
one `npm install` at the repo root installs everything.

---

## 2. Unzip / clone the project

If you're starting from the zip you were given:

```bash
unzip llmgateway-modified.zip
cd llmgateway
```

(If you're working from a fresh git clone instead: `git clone # && cd llmgateway`, then re-apply the `native-model-sync` changes.)

---

## 3. Install dependencies

```bash
npm install
```

This installs the server, client (dashboard), CLI, and shared packages in one
pass. Expect ~1–2 minutes.

---

## 4. Configure environment variables

Create a `.env` file in the repo root.

**macOS / Linux (Bash):**
```bash
ENCRYPTION_KEY="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
printf "ENCRYPTION_KEY=%s\nPORT=3001\n" "$ENCRYPTION_KEY" > .env
```

**Windows (PowerShell):**
```powershell
$ENCRYPTION_KEY = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
"ENCRYPTION_KEY=$ENCRYPTION_KEY`nPORT=3001" | Out-File -Encoding utf8 .env
```

`ENCRYPTION_KEY` encrypts your provider API keys at rest in SQLite. It's
technically optional outside production (a dev key auto-generates), but set
it explicitly so your keys survive reinstalls.

### Optional: tune the native model sync job

Add any of these to `.env` if you want non-default behavior (all are optional
— sensible defaults apply if you skip this):

```bash
# How often the independent provider-native sync checks for new models.
# Default: 86400000 (24h). Set to 0 to disable the pass entirely.
NATIVE_MODEL_SYNC_INTERVAL_MS=86400000

# Free-only filter (default: true). Only models NOT explicitly priced above
# zero are added — a model a provider didn't price at all (the norm for a
# dedicated free-tier provider) is still treated as free and included. Set to
# false if you also want paid models pulled in from marketplaces (e.g.
# OpenRouter) that report per-model pricing and mix free with paid.
NATIVE_MODEL_SYNC_FREE_ONLY=true

# (Unrelated, but often tuned alongside it) how often the OPTIONAL,
# llmgateway.co-hosted catalog sync checks for updates. Default: 86400000 (24h).
# Set CATALOG_SYNC_DISABLED=1 to turn that hosted sync off entirely if you only
# want the independent native sync running.
# CATALOG_SYNC_DISABLED=1
```

---

## 5. Start the dev server

```bash
npm run dev
```

This starts:
- the API server on **http://localhost:3001**
- the dashboard (Vite dev server) on **http://localhost:5173**

Both have hot-reload enabled.

---

## 6. First-run setup

1. Open **http://localhost:5173** in your browser.
2. Since this is the first run, you'll be prompted to create the admin
   account directly (no setup code needed on the same machine).
3. Go to the **Keys** page and add at least one provider API key (e.g. Groq,
   Mistral, OpenRouter — pick any free-tier provider you have a key for).
4. Grab your **API key** from the Keys page header — this is what
   your own apps/SDKs will use to talk to `http://localhost:3001/v1`.

---

## 7. Verify the native model sync job is running

The job runs automatically 30 seconds after boot, then on the interval you
configured (24h by default). Watch the server logs:

```
[native-model-sync] polling registered providers directly every 24h (no llmgateway.co dependency)
...
[native-model-sync] checked 2 provider(s): +3 added, 5 already on file, 1 paid (excluded), 0 tombstoned, 0 failed
```

- **`checked N provider(s)`** — only counts providers that (a) support the
  generic `/models` discovery call and (b) have a usable key on file.
- **`+N added`** — new models written to your local `models` table with
  `source = 'user'`, so they're immediately usable and never touched by the
  (separate, optional) catalog sync.
- A provider with no key yet, or without a generic `/models` endpoint (e.g.
  Google Gemini, Cohere native, Cloudflare, AI Horde), is silently skipped —
  this is expected, not an error.

### Trigger it manually (without waiting for the timer)

Useful right after adding a new provider key. From a Node REPL or a small
script in the `server` package:

```ts
import { getDb, initDb } from './src/db/index.js';
import { runNativeModelSync } from './src/services/native-model-sync.js';

initDb();
const result = await runNativeModelSync(getDb());
console.log(result);
```

Or add a temporary admin route / CLI command that calls
`runNativeModelSync(getDb())` if you want a one-click "sync now" button.

---

## 8. Point your apps at it

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3001/v1",
    api_key="llmgateway-your-api-key",
)

resp = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(resp.choices[0].message.content)
```

---

## 9. Running the test suite (optional but recommended)

```bash
cd server
npx tsc --noEmit                 # type-check
npx vitest run                   # full test suite
npx vitest run src/__tests__/services/native-model-sync.test.ts  # just the new job
```

---

## 10. Building for production (optional)

```bash
npm run build   # from repo root — builds server + client
cd server
NODE_ENV=production node dist/index.js
```

In production, `ENCRYPTION_KEY` in `.env` is **required** — the dev
auto-generated key fallback is disabled.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `better-sqlite3` install fails | Run `npm rebuild better-sqlite3` or ensure build tools (Xcode CLI tools / `build-essential`) are installed for your OS. |
| Server logs `[native-model-sync] disabled via NATIVE_MODEL_SYNC_INTERVAL_MS=0` | You (or a stray `.env` value) set the interval to `0`. Remove that line or set it to a positive number. |
| `checked 0 provider(s)` forever | No enabled key with status `healthy`/`unknown` exists for any provider that supports generic `/models` discovery. Add a key on the Keys page and wait for its health check to pass. |
| Port 3001 or 5173 already in use | Set `PORT=<other>` in `.env` for the API server, or stop whatever else is bound to those ports. |
