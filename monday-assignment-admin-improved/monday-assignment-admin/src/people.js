// Pure helpers with no monday SDK dependency, so they can be unit-tested with `npm run check`.

export const MAIN_WORKSPACE = 'main'; // boards in the Main workspace have no workspace id

export const isPerson = (entity, userId) =>
  entity.kind === 'person' && String(entity.id) === String(userId);

// One filter per board: match the user in ANY of that board's People columns.
// monday's documented People filter is any_of with "person-<id>".
export function assignmentRules(peopleColumns, userId) {
  return {
    operator: 'or',
    rules: peopleColumns.map(column => ({
      column_id: column.id,
      compare_value: [`person-${userId}`],
      operator: 'any_of',
    })),
  };
}

// New People-column value for a task. Only the searched person is touched:
// every other person, team and agent already on the task stays.
//   add:     keep the person, add the new people
//   replace: take the person off, add the new people
//   remove:  take the person off
export function taskPeopleAfter(people, userId, action, newIds = []) {
  const next = action === 'add' ? people.slice() : people.filter(p => !isPerson(p, userId));
  if (action !== 'remove') {
    for (const id of newIds.map(String)) if (!next.some(p => isPerson(p, id))) next.push({ id, kind: 'person' });
  }
  return next.map(p => ({ id: Number(p.id), kind: p.kind }));
}

// Kept for older callers and tests.
export function replacePerson(people, oldId, newIds, { keepOld = false } = {}) {
  return taskPeopleAfter(people, oldId, keepOld ? 'add' : 'replace', [].concat(newIds));
}

// The person's role on a board or workspace, from its owner and member id lists.
export function roleOf(userId, ownerIds, memberIds) {
  const id = String(userId);
  if (ownerIds.map(String).includes(id)) return 'owner';
  if (memberIds.map(String).includes(id)) return 'member';
  return 'none';
}

// Whether a membership action makes sense, and if not, why it's skipped.
export function membershipCheck(action, role, ownerCount) {
  switch (action) {
    case 'add': return role === 'none' ? { ok: true } : { ok: false, reason: `already ${role === 'owner' ? 'an owner' : 'a member'}` };
    case 'remove':
      if (role === 'none') return { ok: false, reason: 'not a member' };
      if (role === 'owner' && ownerCount <= 1) return { ok: false, reason: 'they are the only owner' };
      return { ok: true };
    case 'owner':
      if (role === 'owner') return { ok: false, reason: 'already an owner' };
      if (role === 'none') return { ok: false, reason: 'not a member' };
      return { ok: true };
    case 'member':
      if (role === 'member') return { ok: false, reason: 'already a member, not an owner' };
      if (role === 'none') return { ok: false, reason: 'not a member' };
      if (ownerCount <= 1) return { ok: false, reason: 'they are the only owner' };
      return { ok: true };
    default: return { ok: false, reason: 'unknown action' };
  }
}

// The role we expect after an action, used to confirm monday really applied it.
export const expectedRole = { add: 'member', remove: 'none', owner: 'owner', member: 'member' };

// Does a board fall inside the chosen workspaces? scope = { all: true } or { ids: [...] }.
export function inWorkspaceScope(board, scope) {
  if (scope.all) return true;
  const id = board.workspace_id == null ? MAIN_WORKSPACE : String(board.workspace_id);
  return scope.ids.map(String).includes(id);
}

// monday returns "reset in N seconds" when the complexity budget runs out.
export function retryDelayMs(message = '') {
  const seconds = /reset in (\d+)/i.exec(message)?.[1];
  if (seconds) return (Number(seconds) + 1) * 1000;
  if (/complexity|rate limit|too many|429|timeout|temporarily/i.test(message)) return 5000;
  return null; // not a retryable error
}
