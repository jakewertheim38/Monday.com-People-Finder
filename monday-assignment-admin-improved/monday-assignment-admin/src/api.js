import mondaySdk from 'monday-sdk-js';
import { assignmentRules, isPerson, replacePerson, retryDelayMs } from './people.js';

export const monday = mondaySdk();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Runs as the signed-in admin (seamless auth). Waits and retries when monday's
// complexity or rate limits are hit, instead of failing the whole search.
async function request(query, variables = {}, attempt = 1) {
  let message;
  try {
    const response = await monday.api(query, { variables });
    if (!response.errors?.length) return response.data;
    message = response.errors.map(e => e.message).join('; ');
  } catch (error) {
    message = error?.message || String(error);
  }
  const wait = retryDelayMs(message);
  if (wait && attempt < 5) {
    await sleep(wait);
    return request(query, variables, attempt + 1);
  }
  throw new Error(message);
}

export async function loadUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const data = await request(
      'query($page:Int!){ users(page:$page, limit:100){ id name email enabled is_guest } }',
      { page },
    );
    users.push(...data.users);
    if (data.users.length < 100) break;
  }
  return users.sort((a, b) => a.name.localeCompare(b.name));
}

// Only boards that actually have a People column are worth searching.
export async function loadBoards() {
  const boards = [];
  for (let page = 1; ; page++) {
    const data = await request(
      `query($page:Int!){ boards(page:$page, limit:100, state:active, hierarchy_type:[classic, multi_level]){
        id name url columns(types:[people]){ id title } } }`,
      { page },
    );
    boards.push(...data.boards);
    if (data.boards.length < 100) break;
  }
  return boards.filter(board => board.columns?.length);
}

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
      // Double-check each column so only the user's own People columns are listed.
      for (const column of board.columns) {
        const people = item.column_values.find(v => v.id === column.id)?.persons_and_teams || [];
        if (people.some(p => isPerson(p, userId))) rows.push({ board, column, item });
      }
    }
    page = page.cursor
      ? (await request(`query($cursor:String!){ next_items_page(cursor:$cursor, limit:200){ ${itemFields} } }`,
        { cursor: page.cursor })).next_items_page
      : null;
  }
  return rows;
}

// Searches a few boards at a time: much faster than one by one, gentle enough on API limits.
export async function findAssignments(userId, boards, onProgress, parallel = 3) {
  const results = [], errors = [];
  let next = 0, done = 0;
  async function worker() {
    while (next < boards.length) {
      const board = boards[next++];
      try { results.push(...await searchBoard(board, userId)); }
      catch (error) { errors.push(`${board.name}: ${error.message}`); }
      done++;
      onProgress?.(done, boards.length, results.slice(), errors.slice());
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, boards.length) }, worker));
  return { results, errors };
}

export async function reassign(row, oldId, newIds, options = {}) {
  // Re-read just before writing so changes made since the search are kept.
  const data = await request(
    'query($id:[ID!], $column:[String!]){ items(ids:$id){ id column_values(ids:$column){ id ... on PeopleValue { persons_and_teams { id kind } } } } }',
    { id: [row.item.id], column: [row.column.id] },
  );
  const people = data.items[0]?.column_values[0]?.persons_and_teams;
  if (!people?.some(p => isPerson(p, oldId))) throw new Error('the original person is no longer assigned');
  await request(
    'mutation($board:ID!, $item:ID!, $values:JSON!){ change_multiple_column_values(board_id:$board, item_id:$item, column_values:$values){ id } }',
    { board: row.board.id, item: row.item.id, values: JSON.stringify({ [row.column.id]: { personsAndTeams: replacePerson(people, oldId, newIds, options) } }) },
  );
}
