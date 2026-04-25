# Flow Deployment

Flow is now arranged for Cloudflare deployment with:

- static assets served by Cloudflare Workers Assets
- a Worker API in `src/index.js`
- PostgreSQL access through a Cloudflare Hyperdrive binding named `HYPERDRIVE`
- frontend state sync that can bootstrap from and persist to the Worker API

## Important Security Note

The Neon connection string was shared in chat while setting this up. Rotate that Neon password/connection string before production use, then update the Hyperdrive origin connection in Cloudflare to the rotated credential.

## Files Added

- `wrangler.jsonc`: Cloudflare Worker config
- `package.json`: Wrangler + `pg`
- `.assetsignore`: prevents non-public files from being uploaded as static assets
- `src/index.js`: Worker API and static-asset entrypoint

## Worker Environment

The Worker expects:

- Hyperdrive binding: `HYPERDRIVE`
- secret: `GEMINI_API_KEY` for `/api/chat`

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Add the Gemini secret for local Wrangler dev:

```bash
wrangler secret put GEMINI_API_KEY
```

3. Start local development:

```bash
npm run dev
```

## Deploy

```bash
npm run deploy
```

## Database Expectations

The Worker is written against these Neon tables:

- `users`
- `budgets`
- `settings`
- `expenses`
- `recurring_expenses`
- `reports`
- `notification_states`
- `report_types`
- `user_report_downloads`
- `user_report_categories`

## Current Sync Coverage

The deployed Worker/frontend path now covers:

- register
- login
- profile updates
- password updates
- settings updates
- budget updates
- expense CRUD
- recurring expense create/delete
- report create/delete
- user reset/delete flows
- chatbot proxying through the Worker

## Notes

- The old Flask app in `app.py` is still present for local legacy/dev use, but Cloudflare deployment uses the Worker in `src/index.js`.
- Hyperdrive is configured in `wrangler.jsonc` with the provided binding id.
- The frontend still keeps a local cache in browser storage, but it now bootstraps from and syncs back to the Worker API.
