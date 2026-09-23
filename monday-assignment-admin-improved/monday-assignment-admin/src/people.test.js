import test from 'node:test';
import assert from 'node:assert/strict';
import { assignmentRules, replacePerson, retryDelayMs } from './people.js';

test('builds an OR filter across every People column', () => {
  const rules = assignmentRules([{ id: 'person' }, { id: 'people1' }], 42);
  assert.equal(rules.operator, 'or');
  assert.deepEqual(rules.rules[1], { column_id: 'people1', compare_value: ['person-42'], operator: 'any_of' });
});

test('replaces the old person with one new person, keeping teams and co-assignees', () => {
  const people = [{ id: '1', kind: 'person' }, { id: '9', kind: 'team' }, { id: '2', kind: 'person' }];
  assert.deepEqual(replacePerson(people, 1, ['3']), [
    { id: 9, kind: 'team' }, { id: 2, kind: 'person' }, { id: 3, kind: 'person' },
  ]);
});

test('can hand one task to several people', () => {
  const people = [{ id: '1', kind: 'person' }];
  assert.deepEqual(replacePerson(people, 1, ['3', '4', '5']), [
    { id: 3, kind: 'person' }, { id: 4, kind: 'person' }, { id: 5, kind: 'person' },
  ]);
});

test('can keep the original person and add helpers', () => {
  const people = [{ id: '1', kind: 'person' }];
  assert.deepEqual(replacePerson(people, 1, ['3'], { keepOld: true }), [
    { id: 1, kind: 'person' }, { id: 3, kind: 'person' },
  ]);
});

test('never adds someone twice', () => {
  const people = [{ id: '1', kind: 'person' }, { id: '3', kind: 'person' }];
  assert.deepEqual(replacePerson(people, 1, ['3', '3']), [{ id: 3, kind: 'person' }]);
});

test('knows which errors are worth retrying', () => {
  assert.equal(retryDelayMs('Complexity budget exhausted, reset in 12 seconds'), 13000);
  assert.equal(retryDelayMs('Rate limit exceeded'), 5000);
  assert.equal(retryDelayMs('Column not found'), null);
});
