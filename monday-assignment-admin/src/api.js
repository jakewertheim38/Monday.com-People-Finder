import mondaySdk from 'monday-sdk-js';
export const monday = mondaySdk();

async function request(query, variables = {}) {
  const response = await monday.api(query, { variables });
  if (response.errors?.length) throw new Error(response.errors.map(e => e.message).join('; '));
  return response.data;
}

export async function loadUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const data = await request('query($page:Int!){ users(page:$page,limit:100){ id name email } }', { page });
    users.push(...data.users);
    if (data.users.length < 100) return users.sort((a,b) => a.name.localeCompare(b.name));
  }
}

export async function loadBoards() {
  const boards = [];
  for (let page = 1; ; page++) {
    const data = await request('query($page:Int!){ boards(page:$page,limit:100,hierarchy_type:[classic,multi_level]){ id name type url columns{ id title type } } }', { page });
    boards.push(...data.boards);
    if (data.boards.length < 100) return boards;
  }
}

const itemFields = `cursor items { id name url column_values { id ... on PeopleValue { persons_and_teams { id kind } } } }`;
export async function findAssignments(userId, boards, onProgress) {
  const results = [], errors = [];
  const targets = boards.flatMap(board => board.columns.filter(col => col.type === 'people').map(column => ({ board, column })));
  for (let i = 0; i < targets.length; i++) {
    const { board, column } = targets[i];
    try {
      let data = await request(`query($board:ID!,$column:String!,$user:String!){ items_page_by_column_values(board_id:$board,limit:100,columns:[{column_id:$column,column_values:[$user]}]){ ${itemFields} } }`, { board: board.id, column: column.id, user: String(userId) });
      let page = data.items_page_by_column_values;
      while (page) {
        for (const item of page.items) {
          const value = item.column_values.find(v => v.id === column.id);
          if (value?.persons_and_teams?.some(person => person.kind === 'person' && String(person.id) === String(userId))) {
            results.push({ board, column, item, people: value.persons_and_teams });
          }
        }
        page = page.cursor ? (await request(`query($cursor:String!){next_items_page(cursor:$cursor,limit:100){ ${itemFields} }}`, { cursor: page.cursor })).next_items_page : null;
      }
    } catch (error) { errors.push(`${board.name} / ${column.title}: ${error.message}`); }
    onProgress?.(i + 1, targets.length, results.slice(), errors.slice());
  }
  return { results, errors };
}

export function replacePerson(people, oldId, newId) {
  const next = people.filter(p => !(p.kind === 'person' && String(p.id) === String(oldId)));
  if (!next.some(p => p.kind === 'person' && String(p.id) === String(newId))) next.push({ id: newId, kind: 'person' });
  return next.map(p => ({ id: Number(p.id), kind: p.kind }));
}

export async function reassign(row, oldId, newId) {
  // Read immediately before writing so teammates' changes made since search are retained.
  const data = await request('query($id:[ID!]!){ items(ids:$id){ id column_values { id ... on PeopleValue { persons_and_teams { id kind } } } } }', { id: [row.item.id] });
  const people = data.items[0]?.column_values.find(c => c.id === row.column.id)?.persons_and_teams;
  if (!people?.some(p => p.kind === 'person' && String(p.id) === String(oldId))) throw new Error('Original assignee is no longer on this item');
  const next = replacePerson(people, oldId, newId);
  await request('mutation($board:ID!,$item:ID!,$values:JSON!){ change_multiple_column_values(board_id:$board,item_id:$item,column_values:$values){id} }', { board: row.board.id, item: row.item.id, values: JSON.stringify({ [row.column.id]: { personsAndTeams: next } }) });
}
