# Running Kuber locally

Three things need to be running at the same time for the app to work properly
and for enrichment to keep itself going in the background. Each one goes in
its **own terminal window**, left open.

## 1. Start the app

```
npm run dev
```

Leave this running. The app is now live at `http://localhost:3000`.

## 2. Start ngrok (only if you need to open the app from another device, e.g. your friend's browser)

```
ngrok http 3000
```

This prints a URL like `https://xxxx-xx-xx-xx-xx.ngrok-free.app` — that's the
link you or your friend open in a browser.

**Important:** the free ngrok URL changes every time you restart ngrok. When
that happens:
1. Copy the new `https://....ngrok-free.app` URL ngrok prints.
2. Open `.env.local`, replace the value of `NEXT_PUBLIC_APP_URL` with it.
3. Stop and restart `npm run dev` (terminal 1) so it picks up the change.

If you're only using the app yourself on this same machine, you can skip
ngrok entirely and just use `http://localhost:3000` — steps 2/3 above aren't
needed in that case.

## 3. Start the enrichment watchdog

```
npm run watchdog
```

This is what keeps lead enrichment (finding emails, scraping company
websites) running reliably in the background — without it, if the
enrichment process ever silently stops (it has, more than once), nothing
brings it back until this script or a new import nudges it again. Leave it
running the whole time you're using the app. It's safe to leave running for
hours — it does nothing when there's no work waiting.

## Stopping everything

`Ctrl+C` in each of the three terminals.

## Quick health check

If you want to confirm enrichment is actually alive, watch the `npm run
watchdog` terminal — every 15 minutes it logs a line like:

```
[timestamp] watchdog -> 200 { triggered: true }
```

Every 3 hours it also logs an `auto-retry` line. If either of these ever
shows a repeated error instead of a 200, that's the signal something's
actually wrong — otherwise the pipeline is healthy even if it looks quiet.

## First-time setup (only needed once, skip if already done)

```
npm install
```

Requires `.env.local` to already be filled in (Supabase keys, Apollo key,
Firecrawl key, `INTERNAL_SECRET`, etc.) — ask whoever set up the project if
it's missing.
