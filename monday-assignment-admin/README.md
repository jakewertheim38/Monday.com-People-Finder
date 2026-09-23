# monday Assignment Administration

A client-side monday Administration View. Search an account user, list their assignments across accessible active classic and multi-level boards, select assignments, and replace their entry in the relevant People column. Co-assignees and teams are retained. The app runs as the signed-in admin through the monday SDK; no API token is shipped to the browser.

## Set up in monday Developer Centre

1. Create an app, add **Administration view** under **Build → Features** (Enterprise feature).
2. Grant `boards:read`, `boards:write` and `users:read` app scopes. Install the draft version on the account. The signed-in admin must have permission to view and edit the boards involved.
3. Under **Host on monday → Client-side code**, use the deployed client-side URL for the Administration View feature. If this menu's label differs, select the client-side deployment URL generated for your app version.
4. In GitHub, create a private repository and add these project files. Set repository secret `MONDAY_API_TOKEN` (a token for a Developer Centre collaborator); set repository variables `MONDAY_APP_VERSION_ID` (draft version ID) and `MONDAY_REGION` (`eu` for an EU monday code region, if that matches your app). Never commit the token.
5. Push to `main`, or manually run the workflow in **Actions**. It runs `npm ci`, builds Vite, and pushes `dist/` to monday code's client-side hosting. To deploy from your Mac instead: `npm install && npm run build`, `npm install -g @mondaycom/apps-cli`, `mapps init`, then `mapps code:push -c -d ./dist -i YOUR_DRAFT_VERSION_ID -z eu`.
6. Open the Administration View in your monday account and test on an item you can safely reassign. Publish/promote the app version only when ready.

## Limits

- monday does not offer a single cross-board assignment query. Searching scans each accessible board and each People column, with pagination; large accounts take time and may hit API limits.
- Search covers active items returned by the board API, including subitem boards only where monday exposes them in the board list. Archived items, inaccessible private/shareable boards, non-People assignment representations, and team membership derived assignments are excluded. Errors are shown instead of silently claiming a complete account-wide result.
- Changes are sequential and can partly succeed; the UI reports failures. A concurrent edit between the final read and update could still overwrite changes to that People column; verify time-sensitive handovers.
