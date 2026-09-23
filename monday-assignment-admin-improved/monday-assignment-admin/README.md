# monday Assignment Administration

An Administration View for monday.com. Search for a person, see every task they're assigned to on the boards you can access, and hand each task to one or more new people. Other assignees and teams on each task are kept.

## Using it

1. Choose a person and select **Find assignments**.
2. Give each task its new people in the **New people** column (as many as you need, × to remove). For lots of tasks, tick them, add people in the box above the table, and select **Add to selected**.
3. Leave **Remove [person] from these tasks** ticked to hand work over, or untick it to add helpers while keeping them on.
4. Select **Apply changes**. Tasks that fail stay listed with their new people so you can try again. It runs as the signed-in admin through the monday SDK, so no API token is ever in the page.

## Repository layout

```
.github/workflows/deploy.yml      ← must be at the top of the repo
monday-assignment-admin/
  src/                            ← the app (React)
  monday-code-server/             ← only used for the "server" fallback
  vite.config.js, package.json …
```

## One-time setup

1. Developer Centre → your app → **Build → Features**: an **Administration view** (Enterprise feature).
2. **OAuth & Permissions**: `boards:read`, `boards:write`, `users:read`. Install the draft version on your account.
3. GitHub → **Settings → Secrets and variables → Actions**
   - Secret `MONDAY_TOKEN`: your developer token, nothing else in it.
   - Variable `MONDAY_REGION` (only needed for the server fallback, e.g. `eu`).
4. The app version ID (`18198232`) is set at the top of the workflow. Change it there when you make a new draft version.

## Deploying

Pushing to `main` builds, tests and deploys to monday's CDN (client-side). In the Administration View's **Feature deployment**, choose client-side code.

If the CDN upload fails, open **Actions → Deploy to monday code → Run workflow**, pick **server**, and run it. When that succeeds, set the feature's deployment to **Server-side code** (leave the subroute empty). Either way, each run saves the built page under the run's **Artifacts**.

## Try it locally

```bash
cd monday-assignment-admin
npm install
npm run check   # unit tests
npm run build
```

## Limits

- monday has no single "everything assigned to X" query, so the search checks each board with a People column (three at a time, filtered on monday's side). Big accounts still take a while; the app waits and retries if it hits monday's API limits.
- Covers active items on boards the admin can access. Archived items, boards the admin can't see, and assignments through team membership aren't included.
- Changes run one by one and can partly succeed; failures are listed on screen. Each item is re-read just before it's changed, so edits made since the search aren't lost.
