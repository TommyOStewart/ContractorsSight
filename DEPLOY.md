# Running a test build away from your PC

Two parts move off your PC: the **worker** goes to Railway, and the **app** becomes an Android
install link built by EAS (Expo's build service). Supabase is already hosted.

```
tester's phone ──► Supabase (data, sign-in, photos/audio)
       └────────► worker on Railway ──► OpenRouter (AI)
                                    └─► Supabase database
```

## 1. Worker on Railway (one time, ~10 minutes)

1. Sign in at https://railway.com with GitHub. **New Project → Deploy from GitHub repo →
   TommyOStewart/ContractorsSight.** Railway reads `railway.json` and builds
   `services/worker/Dockerfile`.
2. On the service, open **Variables** and add the same values as your local
   `services/worker/.env` (Railway's **Raw Editor** lets you paste the whole file):
   - `DATABASE_URL`: the Supabase **transaction pooler** string (port 6543) with your password
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`
   - `OPENROUTER_API_KEY`
   - `PLANNER_MODEL`, `PLANNER_EFFORT`, `TRANSCRIBE_MODEL`, `READ_IMAGE_MODEL`, `TIMEZONE`
     (e.g. `America/New_York`)

   Don't set `PORT`; Railway provides it.
3. **Settings → Networking → Generate Domain.** You get something like
   `https://contractorsight-worker-production.up.railway.app`.
4. Check it: open `<that URL>/health` in a browser. It should say `{"ok":true}`.

Railway redeploys automatically when `main` changes in `services/worker`, `packages/shared`
or the lockfile.

**Spending:** every tester's captures use your OpenRouter key. Set a credit limit on the key at
https://openrouter.ai/settings/keys before you hand out the app.

## 2. Android install link with EAS (one time setup, then ~15 minutes per build)

Run these **inside `apps/mobile`** (`cd apps/mobile` first). Run from the repo root, EAS creates a second, empty app config there and the build fails at Prebuild:

```bash
npx eas-cli@latest login
npx eas-cli@latest init
```

`init` links the app to your Expo account and adds the project ID to `app.json`. Commit that change.

Tell the build where your services are. These values ship inside the app and are public by
design (the publishable key only allows what Supabase's row-level security allows):

```bash
npx eas-cli@latest env:set --name EXPO_PUBLIC_SUPABASE_URL --value https://<project-ref>.supabase.co --environment preview --visibility plaintext
npx eas-cli@latest env:set --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value sb_publishable_... --environment preview --visibility plaintext
npx eas-cli@latest env:set --name EXPO_PUBLIC_WORKER_URL --value https://<your-railway-domain> --environment preview --visibility plaintext
```

Build:

```bash
npx eas-cli@latest build --profile preview --platform android
```

The first build asks to create an Android signing key; say yes (EAS stores it). When it
finishes you get a link and a QR code. Send the link to testers. On their phone they open it,
download the APK, and allow "install unknown apps" for their browser when Android asks.

**New version:** merge to `main`, then run the same `build` command again. Testers install the
new APK over the old one.

## 3. Tester accounts

Testers tap **Create an account** in the app, then name their company. Each company only sees
its own data.

Supabase's default emails are limited to a few per hour, and the confirmation link points at
`localhost`. The link still confirms the account even if the page it opens doesn't load. For a
small test group it's simpler to turn confirmation off: Supabase dashboard → **Authentication →
Sign In / Providers → Email → Confirm email** off.

## Notes

- The app ID is `com.contractorsight.app` (in `app.json`). Choose the final one before the first
  Play Store upload; after that it can't change.
- iPhone testers need an Apple Developer account ($99/year) and TestFlight. It's the same
  `build` command with `--platform ios`.
- Your PC setup (`.env` files, `pnpm --filter @contractorsight/worker dev`, Expo Go) keeps
  working for development.
