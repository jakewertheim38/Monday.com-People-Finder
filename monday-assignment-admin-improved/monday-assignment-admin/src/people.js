// Pure helpers with no monday SDK dependency, so they can be unit-tested with `npm run check`.

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

// Remove oldId (unless keepOld) and add every new person, keeping all other
// people, teams and agents already on the item. No duplicates.
export function replacePerson(people, oldId, newIds, { keepOld = false } = {}) {
  const ids = [].concat(newIds).map(String);
  const next = keepOld ? people.slice() : people.filter(p => !isPerson(p, oldId));
  for (const id of ids) if (!next.some(p => isPerson(p, id))) next.push({ id, kind: 'person' });
  return next.map(p => ({ id: Number(p.id), kind: p.kind }));
}

// monday returns "reset in N seconds" when the complexity budget runs out.
export function retryDelayMs(message = '') {
  const seconds = /reset in (\d+)/i.exec(message)?.[1];
  if (seconds) return (Number(seconds) + 1) * 1000;
  if (/complexity|rate limit|too many|429|timeout|temporarily/i.test(message)) return 5000;
  return null; // not a retryable error
}
