# People administration for monday.com

An Administration View that finds a person's **tasks**, **boards** and **workspaces**, and changes them in one go. It runs as the signed-in admin through the monday SDK, so no API token is in the page.

## How it works

1. **Pick the person.**
2. **Tasks, Boards or Workspaces?**
3. **Where to look**
   - Tasks and Boards: all workspaces, or the ones you choose (the Main workspace is included).
   - Workspaces: only the ones they're in, or any workspace.
4. **What to do**
   - Tasks: Add people (they stay on) · Replace · Remove · Find tasks (list, tick, then choose Add, Replace or Remove).
   - Boards: Add (only when you chose specific workspaces) · Remove · Make owner · Change owner to member.
   - Workspaces: Add (only with "any workspace") · Remove · Make owner · Change owner to member.
5. **All or select** — do it to everything found, or tick which ones. With "all", choose to see the list first (then press Go) or go straight in.
6. **Summary** — what changed, what was skipped and why, and anything that failed.

Every step has a Back button.

## Safety

- Only the searched person is changed. Other people and teams on a task, board or workspace are never touched.
- Each task, board or workspace is re-read just before it changes, so edits made since the search aren't lost.
- Board and workspace changes are read back afterwards to confirm monday applied them.
- Anything that makes no sense is skipped with a reason: already an owner, not a member, or **the only owner** (the app won't remove or demote the last owner).
- "Change owner to member" is done by removing and re-adding them as a member, because monday has no single action for it. If re-adding fails, the app tries to restore them as owner and reports it.
- Removing someone from a task where they're the only assignee leaves the task unassigned.

## Limits

- Only covers boards and workspaces the admin account can see.
- Big accounts take a while: each board is searched separately (three at a time), and the app waits and retries if it hits monday's API limits.

## Deploying

Committing to `main` deploys to your newest **draft** version of app 12225465 (server-side by default). Create a new draft in Developer Centre before each update. See `.github/workflows/deploy.yml`.

App scopes needed: `users:read`, `boards:read`, `boards:write`, `workspaces:read`, `workspaces:write`.

## Local checks

```bash
npm install
npm run check   # unit tests
npm run build
```
