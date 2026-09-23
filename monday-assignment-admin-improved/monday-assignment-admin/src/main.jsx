import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { loadUsers, loadBoards, findAssignments, reassign } from './api';
import './style.css';

const keyOf = row => `${row.item.id}:${row.column.id}`;
const label = user => `${user.name}${user.email ? ` (${user.email})` : ''}${user.enabled === false ? ' – deactivated' : ''}${user.is_guest ? ' – guest' : ''}`;
const addUnique = (list, ids) => [...new Set([...list, ...ids])];

// Type a name, choose from the list; each chosen person shows as a removable chip.
function PeoplePicker({ people, value, onChange, disabled, placeholder = 'Add a person' }) {
  const [text, setText] = useState('');
  const byLabel = useMemo(() => new Map(people.map(u => [label(u), String(u.id)])), [people]);
  const names = useMemo(() => new Map(people.map(u => [String(u.id), u.name])), [people]);
  function pick(input) {
    setText(input);
    const id = byLabel.get(input);
    if (id) { onChange(addUnique(value, [id])); setText(''); }
  }
  return <div className="picker">
    {value.map(id => <span className="chip" key={id}>{names.get(id) || id}
      <button type="button" aria-label={`Remove ${names.get(id)}`} disabled={disabled}
        onClick={() => onChange(value.filter(x => x !== id))}>×</button></span>)}
    <input list="people-options" value={text} placeholder={placeholder} disabled={disabled}
      onChange={e => pick(e.target.value)} />
  </div>;
}

function App() {
  const [users, setUsers] = useState([]);
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [source, setSource] = useState('');
  const [rows, setRows] = useState([]);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState([]);
  const [plan, setPlan] = useState({});          // row key → [new person ids]
  const [bulk, setBulk] = useState([]);          // people to add to selected rows
  const [removeOld, setRemoveOld] = useState(true);
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    Promise.all([loadUsers(), loadBoards()])
      .then(([u, b]) => { setUsers(u); setBoards(b); })
      .catch(e => setNotice(`Couldn't load users and boards: ${e.message}. Check the app has users:read and boards:read.`))
      .finally(() => setLoading(false));
  }, []);

  const visibleUsers = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return term ? users.filter(u => `${u.name} ${u.email || ''}`.toLowerCase().includes(term)) : users;
  }, [users, filter]);
  // People you can hand work to: active and not the person being searched.
  const assignable = useMemo(() => users.filter(u => u.enabled !== false && String(u.id) !== source), [users, source]);
  const sourceName = users.find(u => String(u.id) === source)?.name || 'the original person';

  useEffect(() => {
    if (!busy && visibleUsers.length === 1 && String(visibleUsers[0].id) !== source) pickSource(String(visibleUsers[0].id));
  }, [visibleUsers]);

  function pickSource(id) {
    setSource(id); setRows([]); setSelected([]); setPlan({}); setBulk([]);
    setErrors([]); setSearched(false); setNotice('');
  }

  async function search() {
    if (!source || busy) return;
    setBusy(true); setRows([]); setSelected([]); setPlan({}); setErrors([]); setNotice(''); setSearched(false);
    try {
      const result = await findAssignments(source, boards, (n, total, matches, failures) => {
        setProgress(`Searching boards: ${n} of ${total}`); setRows(matches); setErrors(failures);
      });
      setRows(result.results); setErrors(result.errors); setSearched(true);
    } catch (e) { setNotice(e.message); }
    finally { setBusy(false); setProgress(''); }
  }

  function addBulkToSelected() {
    setPlan(current => {
      const next = { ...current };
      for (const key of selected) next[key] = addUnique(next[key] || [], bulk);
      return next;
    });
    setBulk([]);
  }

  function clearSelectedPlans() {
    setPlan(current => {
      const next = { ...current };
      for (const key of selected) delete next[key];
      return next;
    });
  }

  const planned = rows.filter(r => plan[keyOf(r)]?.length);

  async function apply() {
    if (!planned.length || busy) return;
    const people = new Set(planned.flatMap(r => plan[keyOf(r)]));
    const action = removeOld ? `hand ${planned.length} task(s) from ${sourceName}` : `add people to ${planned.length} task(s) (keeping ${sourceName})`;
    if (!window.confirm(`This will ${action}, involving ${people.size} new person/people.\n\nIt changes live items and can't be undone from here.`)) return;
    setBusy(true); setNotice('');
    let success = 0; const failures = [];
    for (const row of planned) {
      const key = keyOf(row);
      try {
        await reassign(row, source, plan[key], { keepOld: !removeOld });
        success++;
        setPlan(c => { const n = { ...c }; delete n[key]; return n; });
        setSelected(c => c.filter(x => x !== key));
        if (removeOld) setRows(c => c.filter(r => keyOf(r) !== key));
      } catch (e) { failures.push(`${row.item.name} (${row.board.name}): ${e.message}`); }
      setProgress(`Updating tasks: ${success + failures.length} of ${planned.length}`);
    }
    setErrors(c => [...c, ...failures]);
    setNotice(`Updated ${success} task(s).${failures.length ? ` ${failures.length} failed and are still listed with their new people – see the errors below.` : ''}`);
    setBusy(false); setProgress('');
  }

  const keys = rows.map(keyOf);
  const allSelected = !!keys.length && keys.every(k => selected.includes(k));

  return <main>
    <datalist id="people-options">{assignable.map(u => <option key={u.id} value={label(u)} />)}</datalist>

    <header>
      <h1>Assignment administration</h1>
      <p>Find everything a person is assigned to, then hand each task to one or more new people.</p>
    </header>

    <section className="controls">
      <label>Find a person
        <input placeholder="Type a name or email" value={filter} onChange={e => setFilter(e.target.value)} disabled={loading} />
      </label>
      <label>Person
        <select value={source} onChange={e => pickSource(e.target.value)} disabled={loading || busy}>
          <option value="">{loading ? 'Loading people…' : `Choose from ${visibleUsers.length}`}</option>
          {visibleUsers.map(u => <option value={u.id} key={u.id}>{label(u)}</option>)}
        </select>
      </label>
      <button onClick={search} disabled={!source || busy || loading || !boards.length}>Find assignments</button>
      <span className="muted">{loading ? 'Loading boards…' : `${boards.length} boards with People columns`}</span>
    </section>

    {(progress || notice) && <p className="status" role="status">{progress || notice}</p>}

    {!!rows.length && <section className="bulk">
      <label>Add people to the {selected.length || 'selected'} selected task(s)
        <PeoplePicker people={assignable} value={bulk} onChange={setBulk} disabled={busy} placeholder="Add one or more people" />
      </label>
      <button onClick={addBulkToSelected} disabled={busy || !bulk.length || !selected.length}>Add to selected</button>
      <button className="secondary" onClick={clearSelectedPlans} disabled={busy || !selected.some(k => plan[k]?.length)}>Clear selected</button>
    </section>}

    <section>
      <div className="heading">
        <h2>Assignments ({rows.length})</h2>
        <label className="inline"><input type="checkbox" checked={allSelected} disabled={busy || !keys.length}
          onChange={e => setSelected(e.target.checked ? keys : [])} /> Select all</label>
      </div>
      <div className="table">
        <table>
          <thead><tr><th></th><th>Task</th><th>Board</th><th>Column</th><th>New people</th></tr></thead>
          <tbody>{rows.map(row => {
            const key = keyOf(row);
            return <tr key={key} className={plan[key]?.length ? 'planned' : ''}>
              <td><input type="checkbox" aria-label={`Select ${row.item.name}`} disabled={busy} checked={selected.includes(key)}
                onChange={e => setSelected(c => e.target.checked ? [...c, key] : c.filter(x => x !== key))} /></td>
              <td><a href={row.item.url} target="_blank" rel="noreferrer">{row.item.name}</a>
                {row.item.group?.title && <div className="muted">{row.item.group.title}</div>}</td>
              <td>{row.board.name}</td>
              <td>{row.column.title}</td>
              <td><PeoplePicker people={assignable} value={plan[key] || []} disabled={busy}
                onChange={ids => setPlan(c => ({ ...c, [key]: ids }))} /></td>
            </tr>;
          })}</tbody>
        </table>
        {!rows.length && !busy && <p className="muted">{searched ? 'This person has no assignments on the boards you can see.' : 'Choose a person and select Find assignments.'}</p>}
      </div>
    </section>

    {!!rows.length && <section className="action">
      <label className="inline"><input type="checkbox" checked={removeOld} disabled={busy}
        onChange={e => setRemoveOld(e.target.checked)} /> Remove {sourceName} from these tasks</label>
      <button onClick={apply} disabled={busy || !planned.length}>
        Apply changes to {planned.length} task{planned.length === 1 ? '' : 's'}</button>
    </section>}

    {!!errors.length && <details open={errors.length < 6}>
      <summary>{errors.length} board or task couldn't be read or changed</summary>
      <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
    </details>}

    <footer>Covers active items on boards you can access. Other assignees and teams on each task are kept.</footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
