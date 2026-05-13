# Flow

Flow is a smart expense and bill prediction web app for tracking day-to-day spending, managing monthly budgets, reviewing analytics, and generating finance reports. It combines a responsive frontend, persistent user data, recurring expense automation, report downloads, and an AI assistant that helps users understand their money habits.

The project is currently arranged for Cloudflare Workers deployment, with a legacy Flask app still included for local development and reference.

## Features

- User signup, login, profile updates, password updates, and account deletion
- Dashboard with total spending, remaining budget, savings, recent expenses, monthly trend charts, and category summaries
- Transaction management with add, edit, delete, restore, filtering, and history views
- Recurring expense tracking with automatic scheduled expense generation
- Budget settings with alert thresholds, renewal options, and notification preferences
- Analytics page with spending trends, monthly comparison, and category breakdowns
- Report generation with downloadable PDF reports
- Light and dark theme support
- Currency selection, currency conversion, and exchange comparison support
- Flow AI chatbot powered by Gemini for budgeting, spending, and report guidance
- Local browser cache with optional remote sync through the Worker API

## Tech Stack

**Frontend**

- HTML, CSS, JavaScript
- Bootstrap
- Font Awesome
- Chart.js
- Browser `localStorage` and `sessionStorage`

**Backend / Deployment**

- Cloudflare Workers
- Cloudflare Workers Assets
- Cloudflare Hyperdrive
- PostgreSQL / Neon-compatible database
- Gemini API for the chatbot

**Legacy Local Backend**

- Python
- Flask

## Project Structure

```text
Flow/
|-- index.html                  # Landing page
|-- templates/                  # App pages
|   |-- dashboard.html
|   |-- Analytics.html
|   |-- Transactions.html
|   |-- Reports.html
|   |-- Settings.html
|   |-- Profile.html
|   |-- login.html
|   `-- signup.html
|-- css/                        # App styles
|-- js/                         # Frontend data, dashboard, home, and chatbot logic
|-- src/index.js                # Cloudflare Worker API
|-- app.py                      # Legacy Flask server
|-- wrangler.jsonc              # Cloudflare Worker configuration
|-- package.json                # Worker dependencies and scripts
|-- requirements.txt            # Flask dependencies
`-- .github/workflows/deploy.yml
```

## Getting Started

### Prerequisites

- Node.js 22 or newer
- npm
- A Cloudflare account for Worker deployment
- A PostgreSQL database, such as Neon, when using remote sync
- A Gemini API key for the chatbot

### Install Dependencies

```bash
npm install
```

### Run With Cloudflare Wrangler

Start the Worker locally:

```bash
npm run dev
```

Wrangler serves the static frontend and Worker API together. Open the local URL shown in the terminal.

### Optional Flask Development Server

The older Flask server is still available for local-only development:

```bash
pip install -r requirements.txt
python app.py
```

By default, Flask runs at:

```text
http://127.0.0.1:5000
```

## Environment Variables and Secrets

The Cloudflare Worker expects:

```text
GEMINI_API_KEY
HYPERDRIVE
```

Add the Gemini API key as a Wrangler secret:

```bash
wrangler secret put GEMINI_API_KEY
```

For local Hyperdrive development, set:

```text
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
```

Do not commit database connection strings, API keys, `.env` files, or local credentials.

## Database Tables

The Worker API expects these PostgreSQL tables:

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

## Available Scripts

```bash
npm run dev
```

Runs the app locally with Wrangler.

```bash
npm run deploy
```

Deploys the Worker to Cloudflare.

```bash
npm run check:worker
```

Checks `src/index.js` for JavaScript syntax errors.

## Deployment

This project is configured for Cloudflare deployment through `wrangler.jsonc`.

Manual deployment:

```bash
npm run deploy
```

GitHub Actions deployment is also configured in `.github/workflows/deploy.yml`. It deploys on pushes to `main` when app, Worker, or deployment configuration files change.

Required GitHub repository secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

## API Coverage

The Worker currently supports:

- Register and login
- Bootstrap user data
- Profile updates
- Password updates
- Settings updates
- Budget updates
- Expense create, read, update, and delete
- Recurring expense create and delete
- Report create and delete
- User data reset
- Account deletion
- Chatbot proxy requests to Gemini

## Security Notes

- Rotate any database credential that has ever been shared outside a secure secret manager.
- Keep `GEMINI_API_KEY` in Wrangler secrets, not in source code.
- Keep Cloudflare credentials in GitHub Actions secrets.
- Treat the Flask server as a local development path; production deployment uses the Cloudflare Worker.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
