import test from 'node:test';
import assert from 'node:assert/strict';
import { assignmentRules, taskPeopleAfter, replacePerson, roleOf, membershipCheck, inWorkspaceScope, retryDelayMs } from './people.js';

const alice = { id: '1', kind: 'person' }, team = { id: '9', kind: 'team' }, other = { id: '2', kind: 'person' };

test('builds an OR filter across every People column', () => {
  const rules = assignmentRules([{ id: 'person' }, { id: 'people1' }], 42);
  assert.equal(rules.operator, 'or');
  assert.deepEqual(rules.rules[1], { column_id: 'people1', compare_value: ['person-42'], operator: 'any_of' });
});

test('add keeps the person and everyone else, and adds the new people', () => {
  assert.deepEqual(taskPeopleAfter([alice, team, other], 1, 'add', ['3', '4']), [
    { id: 1, kind: 'person' }, { id: 9, kind: 'team' }, { id: 2, kind: 'person' }, { id: 3, kind: 'person' }, { id: 4, kind: 'person' },
  ]);
});

test('replace swaps only the person, keeping others', () => {
  assert.deepEqual(taskPeopleAfter([alice, team, other], 1, 'replace', ['3']), [
    { id: 9, kind: 'team' }, { id: 2, kind: 'person' }, { id: 3, kind: 'person' },
  ]);
});

test('remove takes only the person off; a task can end up empty', () => {
  assert.deepEqual(taskPeopleAfter([alice, team], 1, 'remove'), [{ id: 9, kind: 'team' }]);
  assert.deepEqual(taskPeopleAfter([alice], 1, 'remove'), []);
});

test('never adds someone twice', () => {
  assert.deepEqual(taskPeopleAfter([alice, { id: '3', kind: 'person' }], 1, 'replace', ['3', '3']), [{ id: 3, kind: 'person' }]);
  assert.deepEqual(replacePerson([alice], 1, ['3'], { keepOld: true }), [{ id: 1, kind: 'person' }, { id: 3, kind: 'person' }]);
});

test('works out the role on a board or workspace', () => {
  assert.equal(roleOf(1, ['1'], ['1', '2']), 'owner');
  assert.equal(roleOf(2, ['1'], ['1', '2']), 'member');
  assert.equal(roleOf(5, ['1'], ['2']), 'none');
});

test('skips actions that make no sense, with a reason', () => {
  assert.deepEqual(membershipCheck('add', 'none', 1), { ok: true });
  assert.equal(membershipCheck('add', 'member', 1).reason, 'already a member');
  assert.equal(membershipCheck('owner', 'owner', 2).reason, 'already an owner');
  assert.deepEqual(membershipCheck('owner', 'member', 1), { ok: true });
  assert.equal(membershipCheck('member', 'owner', 1).reason, 'they are the only owner');
  assert.deepEqual(membershipCheck('member', 'owner', 2), { ok: true });
  assert.equal(membershipCheck('remove', 'owner', 1).reason, 'they are the only owner');
  assert.deepEqual(membershipCheck('remove', 'member', 1), { ok: true });
});

test('filters boards by the chosen workspaces, including the Main workspace', () => {
  assert.equal(inWorkspaceScope({ workspace_id: 5 }, { all: true }), true);
  assert.equal(inWorkspaceScope({ workspace_id: 5 }, { ids: ['5'] }), true);
  assert.equal(inWorkspaceScope({ workspace_id: 6 }, { ids: ['5'] }), false);
  assert.equal(inWorkspaceScope({ workspace_id: null }, { ids: ['main'] }), true);
});

test('knows which errors are worth retrying', () => {
  assert.equal(retryDelayMs('Complexity budget exhausted, reset in 12 seconds'), 13000);
  assert.equal(retryDelayMs('Rate limit exceeded'), 5000);
  assert.equal(retryDelayMs('Column not found'), null);
});
