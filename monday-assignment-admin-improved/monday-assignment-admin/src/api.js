import mondaySdk from 'monday-sdk-js';
import {
  assignmentRules, isPerson, taskPeopleAfter, roleOf, membershipCheck, expectedRole,
  inWorkspaceScope, retryDelayMs, MAIN_WORKSPACE,
} from './people.js';

export const monday = mondaySdk();
// Pin the API version so the queries below always mean the same thing.
monday.setApiVersion('2026-01');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Runs as the signed-in admin (seamless auth). Waits and retries when monday's
// complexity or rate limits are hit, instead of failing the whole job.
async function request(query, variables = {}, attempt = 1) {
  let message;
  try {
    const response = await monday.api(query, { variables });
    if (!response.errors?.length) return response.data;
    message = response.errors.map(e => e.message).join('; ');
  } catch (error) {
    const details = [error?.data?.errors, error?.errors, error?.data?.error_message]
      .flat().filter(Boolean).map(e => e.message || e).join('; ');
    message = details || error?.message || String(error);
  }
  const wait = retryDelayMs(message);
  if (wait && attempt < 5) {
    await sleep(wait);
    return request(query, variables, attempt + 1);
  }
  throw new Error(message);
}

// Runs a job over a list, a few at a time, reporting progress.
async function inParallel(list, job, onProgress, parallel = 3) {
  let next = 0, done = 0;
  async function worker() {
    while (next < list.length) {
      const entry = list[next++];
      await job(entry);
      onProgress?.(++done, list.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, list.length) }, worker));
}

// ---------- People and workspaces ----------

export async function loadUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const data = await request(
      'query($page:Int!){ users(page:$page, limit:100){ id name email enabled is_guest } }', { page });
    users.push(...data.users);
    if (data.users.length < 100) break;
  }
  return users.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadWorkspaces() {
  const list = [];
  for (let page = 1; ; page++) {
    const data = await request(
      'query($page:Int!){ workspaces(page:$page, limit:100, membership_kind:all, state:active){ id name kind } }', { page });
    list.push(...data.workspaces.filter(w => w?.id));
    if (data.workspaces.length < 100) break;
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Boards ----------

// Loads boards in the chosen workspaces. withMembers adds owners and members;
// withPeopleColumns keeps only boards that have a People column.
export async function loadBoards(scope, { withMembers = false, withPeopleColumns = false } = {}, onProgress) {
  const useFilter = !scope.all && !scope.ids.includes(MAIN_WORKSPACE);
  const fields = `id name url workspace_id workspace { name }
    ${withPeopleColumns ? 'columns(types:[people]){ id title }' : ''}
    ${withMembers ? 'owners { id } subscribers { id }' : ''}`;
  const boards = [];
  for (let page = 1; ; page++) {
    const data = await request(
      useFilter
        ? `query($page:Int!, $ws:[ID]){ boards(page:$page, limit:50, state:active, hierarchy_types:[classic, multi_level], workspace_ids:$ws){ ${fields} } }`
        : `query($page:Int!){ boards(page:$page, limit:50, state:active, hierarchy_types:[classic, multi_level]){ ${fields} } }`,
      useFilter ? { page, ws: scope.ids } : { page },
    );
    boards.push(...data.boards.filter(b => inWorkspaceScope(b, scope)));
    onProgress?.(boards.length);
    if (data.boards.length < 50) break;
  }
  return withPeopleColumns ? boards.filter(b => b.columns?.length) : boards;
}

async function boardMembership(boardId) {
  const data = await request('query($id:[ID!]){ boards(ids:$id){ owners { id } subscribers { id } } }', { id: [boardId] });
  const board = data.boards[0];
  if (!board) throw new Error("board not found or you can't see it");
  return { owners: board.owners.map(u => u.id), members: board.subscribers.map(u => u.id) };
}

// Adds each board's role for the person, and whether the action applies.
export function describeBoards(boards, userId, action) {
  return boards.map(board => {
    const owners = board.owners.map(u => u.id), members = board.subscribers.map(u => u.id);
    const role = roleOf(userId, owners, members);
    return { ...board, role, check: membershipCheck(action, role, owners.length) };
  });
}

// ---------- Workspaces membership ----------

async function workspacePages(id, field) {
  const ids = [];
  for (let page = 1; ; page++) {
    const data = await request(`query($id:[ID!], $page:Int!){ workspaces(ids:$id){ ${field}(limit:100, page:$page){ id } } }`, { id: [id], page });
    const users = data.workspaces[0]?.[field] || [];
    ids.push(...users.map(u => u.id));
    if (users.length < 100) break;
  }
  return ids;
}

async function workspaceMembership(id) {
  const [owners, members] = await Promise.all([workspacePages(id, 'owners_subscribers'), workspacePages(id, 'users_subscribers')]);
  return { owners, members };
}

// Every workspace with the person's role in it, and whether the action applies.
export async function describeWorkspaces(workspaces, userId, action, onProgress) {
  const out = [];
  await inParallel(workspaces, async ws => {
    try {
      const { owners, members } = await workspaceMembership(ws.id);
      const role = roleOf(userId, owners, members);
      out.push({ ...ws, role, check: membershipCheck(action, role, owners.length) });
    } catch (error) {
      out.push({ ...ws, role: 'unknown', check: { ok: false, reason: `couldn't read members: ${error.message}` } });
    }
  }, onProgress);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Membership changes (boards and workspaces) ----------

const ops = {
  board: {
    read: boardMembership,
    add: (id, userId, kind) => request('mutation($id:ID!, $u:[ID!]!, $k:BoardSubscriberKind){ add_users_to_board(board_id:$id, user_ids:$u, kind:$k){ id } }', { id, u: [userId], k: kind }),
    remove: (id, userId) => request('mutation($id:ID!, $u:[ID!]!){ delete_subscribers_from_board(board_id:$id, user_ids:$u){ id } }', { id, u: [userId] }),
  },
  workspace: {
    read: workspaceMembership,
    add: (id, userId, kind) => request('mutation($id:ID!, $u:[ID!]!, $k:WorkspaceSubscriberKind){ add_users_to_workspace(workspace_id:$id, user_ids:$u, kind:$k){ id } }', { id, u: [userId], k: kind }),
    remove: (id, userId) => request('mutation($id:ID!, $u:[ID!]!){ delete_users_from_workspace(workspace_id:$id, user_ids:$u){ id } }', { id, u: [userId] }),
  },
};

// Re-checks the person's role just before changing anything, makes the change,
// then reads it back to confirm monday really applied it.
export async function changeMembership(type, id, userId, action) {
  const op = ops[type];
  const before = await op.read(id);
  const check = membershipCheck(action, roleOf(userId, before.owners, before.members), before.owners.length);
  if (!check.ok) return { status: 'skipped', reason: check.reason };

  if (action === 'add') await op.add(id, userId, 'subscriber');
  if (action === 'owner') await op.add(id, userId, 'owner');
  if (action === 'remove') await op.remove(id, userId);
  if (action === 'member') {
    // monday has no "owner → member" action: remove, then add back as a member.
    await op.remove(id, userId);
    try { await op.add(id, userId, 'subscriber'); }
    catch (error) {
      await op.add(id, userId, 'owner').catch(() => {});
      throw new Error(`couldn't add them back as a member (${error.message}); tried to restore them as owner`);
    }
  }

  const after = await op.read(id);
  const role = roleOf(userId, after.owners, after.members);
  if (role !== expectedRole[action]) throw new Error(`monday accepted the change, but they're now "${role}"`);
  return { status: 'changed' };
}

// ---------- Tasks ----------

const itemFields = `cursor items { id name url group { title }
  column_values { id ... on PeopleValue { persons_and_teams { id kind } } } }`;

async function searchBoard(board, userId) {
  const rows = [];
  let page = (await request(
    `query($board:[ID!], $filter:ItemsQuery){ boards(ids:$board){ items_page(limit:200, query_params:$filter){ ${itemFields} } } }`,
    { board: [board.id], filter: assignmentRules(board.columns, userId) },
  )).boards[0]?.items_page;

  while (page) {
    for (const item of page.items) {
      for (const column of board.columns) {
        const people = item.column_values.find(v => v.id === column.id)?.persons_and_teams || [];
        if (people.some(p => isPerson(p, userId))) rows.push({ board, column, item, key: `${item.id}:${column.id}` });
      }
    }
    page = page.cursor
      ? (await request(`query($cursor:String!){ next_items_page(cursor:$cursor, limit:200){ ${itemFields} } }`,
        { cursor: page.cursor })).next_items_page
      : null;
  }
  return rows;
}

// Every task the person is assigned to on the given boards.
export async function findTasks(userId, boards, onProgress) {
  const results = [], errors = [];
  await inParallel(boards, async board => {
    try { results.push(...await searchBoard(board, userId)); }
    catch (error) { errors.push({ name: board.name, reason: error.message }); }
  }, (done, total) => onProgress?.(done, total, results.length));
  return { results, errors };
}

// add / replace / remove on one task. Re-reads the task first so changes made
// since the search are kept, and only ever touches the searched person.
export async function changeTask(row, userId, action, newIds = []) {
  const data = await request(
    'query($id:[ID!], $column:[String!]){ items(ids:$id){ id column_values(ids:$column){ id ... on PeopleValue { persons_and_teams { id kind } } } } }',
    { id: [row.item.id], column: [row.column.id] },
  );
  const people = data.items[0]?.column_values[0]?.persons_and_teams;
  if (!people?.some(p => isPerson(p, userId))) return { status: 'skipped', reason: 'no longer assigned to this task' };
  const next = taskPeopleAfter(people, userId, action, newIds);
  await request(
    'mutation($board:ID!, $item:ID!, $values:JSON!){ change_multiple_column_values(board_id:$board, item_id:$item, column_values:$values){ id } }',
    { board: row.board.id, item: row.item.id, values: JSON.stringify({ [row.column.id]: next.length ? { personsAndTeams: next } : null }) },
  );
  return { status: 'changed' };
}

export { inParallel };
