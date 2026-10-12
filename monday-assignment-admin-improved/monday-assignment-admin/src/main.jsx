import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  loadUsers, loadWorkspaces, loadBoards, describeBoards, describeWorkspaces,
  findTasks, changeTask, changeMembership, inParallel,
} from './api';
import { MAIN_WORKSPACE } from './people';
import './style.css';

// ---------- Wording ----------

const AREAS = {
  tasks: { label: 'Tasks', hint: 'Items they are assigned to in People columns' },
  boards: { label: 'Boards', hint: 'Boards they are a member or owner of' },
  workspaces: { label: 'Workspaces', hint: 'Workspaces they are a member or owner of' },
};

const ACTIONS = {
  tasks: {
    add: { label: 'Add people', hint: 'Add people to the tasks they are on. They stay on too.', verb: 'Add people to' },
    replace: { label: 'Replace', hint: 'Put new people on the tasks and take them off.', verb: 'Replace them on' },
    remove: { label: 'Remove', hint: 'Take them off the tasks. Nobody is added.', verb: 'Remove them from' },
    find: { label: 'Find tasks', hint: 'List their tasks, then choose what to do to the ones you tick.', verb: '' },
  },
  boards: {
    add: { label: 'Add to boards', hint: 'Add them as a member of boards they are not on.', verb: 'Add them to' },
    remove: { label: 'Remove from boards', hint: 'Take them off boards they are on.', verb: 'Remove them from' },
    owner: { label: 'Make owner', hint: 'Make them an owner of boards they are a member of.', verb: 'Make them owner of' },
    member: { label: 'Change owner to member', hint: 'Keep them on the board, but no longer as an owner.', verb: 'Change them to member on' },
  },
  workspaces: {
    add: { label: 'Add to workspaces', hint: 'Add them as a member of workspaces they are not in.', verb: 'Add them to' },
    remove: { label: 'Remove from workspaces', hint: 'Take them out of workspaces they are in.', verb: 'Remove them from' },
    owner: { label: 'Make owner', hint: 'Make them an owner of workspaces they are a member of.', verb: 'Make them owner of' },
    member: { label: 'Change owner to member', hint: 'Keep them in the workspace, but no longer as an owner.', verb: 'Change them to member in' },
  },
};

const ROLE = { owner: 'Owner', member: 'Member', none: 'Not in it', unknown: 'Unknown' };
const userLabel = u => `${u.name}${u.email ? ` (${u.email})` : ''}${u.enabled === false ? ' – deactivated' : ''}${u.is_guest ? ' – guest' : ''}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const nouns = { tasks: 'task', boards: 'board', workspaces: 'workspace' };

// ---------- The question order ----------
// Each answer is stored under a key. The next question is worked out from the
// answers so far, and Back simply removes the last answer.

function nextStep(a) {
  if (!a.person) return 'person';
  if (!a.area) return 'area';
  if (!a.scope) return 'scope';
  if (!a.action) return 'action';
  if (a.area === 'tasks' && (a.action === 'add' || a.action === 'replace') && !a.people?.length) return 'people';
  if (directPick(a)) return 'results';
  if (!a.mode) return 'mode';
  if (a.mode === 'all' && !a.run) return 'run';
  return 'results';
}

// Cases that go straight to a list to pick from, with no "all or select" question.
const directPick = a =>
  (a.area === 'tasks' && a.action === 'find') ||
  (a.area === 'boards' && a.action === 'add') ||
  (a.area === 'workspaces' && a.scope?.any);

// How the results screen behaves.
const resultsMode = a => (directPick(a) || a.mode === 'select') ? 'select' : a.run === 'preview' ? 'preview' : 'go';

// ---------- Small building blocks ----------

// Stays pinned to the bottom of the screen, so Back / Next / Apply are always in reach.
const ActionBar = ({ children }) => <div className="actionbar">{children}</div>;
const BackButton = ({ onClick }) => <button className="secondary" onClick={onClick}>Back</button>;

function Options({ options, onPick }) {
  return <div className="options">
    {options.map(o => <button key={o.value} className="option" onClick={() => onPick(o.value)}>
      <strong>{o.label}</strong>{o.hint && <span>{o.hint}</span>}
    </button>)}
  </div>;
}

function PeoplePicker({ people, value, onChange, disabled, placeholder = 'Type a name to add someone' }) {
  const [text, setText] = useState('');
  const byLabel = useMemo(() => new Map(people.map(u => [userLabel(u), String(u.id)])), [people]);
  const names = useMemo(() => new Map(people.map(u => [String(u.id), u.name])), [people]);
  function pick(input) {
    setText(input);
    const id = byLabel.get(input);
    if (id) { onChange([...new Set([...value, id])]); setText(''); }
  }
  return <div className="picker">
    {value.map(id => <span className="chip" key={id}>{names.get(id) || id}
      <button type="button" aria-label={`Remove ${names.get(id)}`} disabled={disabled}
        onClick={() => onChange(value.filter(x => x !== id))}>×</button></span>)}
    <input list="people-options" value={text} placeholder={placeholder} disabled={disabled} onChange={e => pick(e.target.value)} />
  </div>;
}

function Checklist({ items, selected, setSelected, render, disabledReason, filterText }) {
  const shown = items.filter(i => !filterText || render.text(i).toLowerCase().includes(filterText.toLowerCase()));
  const selectable = shown.filter(i => !disabledReason?.(i)).map(i => i.key);
  const all = selectable.length > 0 && selectable.every(k => selected.includes(k));
  const count = selected.length;
  return <div className="table">
    <div className="select-tools">
      <button type="button" className="secondary small" disabled={!selectable.length || all}
        onClick={() => setSelected([...new Set([...selected, ...selectable])])}>
        Select all{filterText ? ' shown' : ''} ({selectable.length})</button>
      <button type="button" className="secondary small" disabled={!count} onClick={() => setSelected([])}>Clear</button>
      <span className="muted">{count} selected</span>
    </div>
    <table>
      <thead><tr>
        <th><input type="checkbox" aria-label="Select all shown" checked={all} disabled={!selectable.length}
          onChange={e => setSelected(e.target.checked ? [...new Set([...selected, ...selectable])] : selected.filter(k => !selectable.includes(k)))} /></th>
        {render.head.map(h => <th key={h}>{h}</th>)}
      </tr></thead>
      <tbody>{shown.map(i => {
        const reason = disabledReason?.(i);
        return <tr key={i.key} className={reason ? 'dim' : ''}>
          <td><input type="checkbox" aria-label={`Select ${render.text(i)}`} disabled={!!reason}
            checked={selected.includes(i.key)}
            onChange={e => setSelected(e.target.checked ? [...selected, i.key] : selected.filter(k => k !== i.key))} /></td>
          {render.cells(i).map((c, n) => <td key={n}>{c}</td>)}
          {reason !== undefined && <td className="muted">{reason || ''}</td>}
        </tr>;
      })}</tbody>
    </table>
    {!shown.length && <p className="muted">Nothing to show.</p>}
  </div>;
}

// ---------- Steps ----------

function PersonStep({ users, loading, onPick }) {
  const [text, setText] = useState('');
  const matches = useMemo(() => {
    const t = text.trim().toLowerCase();
    return (t ? users.filter(u => `${u.name} ${u.email || ''}`.toLowerCase().includes(t)) : users).slice(0, 40);
  }, [users, text]);
  return <>
    <h2>Who are you looking for?</h2>
    <input autoFocus className="wide" placeholder="Type a name or email" value={text} onChange={e => setText(e.target.value)} />
    <div className="people-list">
      {loading ? <p className="muted">Loading people…</p> : matches.map(u =>
        <button key={u.id} className="person" onClick={() => onPick(String(u.id))}>{userLabel(u)}</button>)}
      {!loading && !matches.length && <p className="muted">No one matches that.</p>}
    </div>
  </>;
}

function WorkspaceScopeStep({ workspaces, onPick, onBack }) {
  const [choosing, setChoosing] = useState(false);
  const [ids, setIds] = useState([]);
  const [filter, setFilter] = useState('');
  const list = [{ id: MAIN_WORKSPACE, name: 'Main workspace' }, ...workspaces].map(w => ({ ...w, key: String(w.id) }));
  if (!choosing) return <>
    <h2>Where should I look?</h2>
    <Options options={[
      { value: 'all', label: 'All workspaces', hint: 'Every workspace you can see' },
      { value: 'some', label: 'Choose workspaces', hint: 'Pick one or more workspaces' },
    ]} onPick={v => v === 'all' ? onPick({ all: true }) : setChoosing(true)} />
    <ActionBar><BackButton onClick={onBack} /></ActionBar>
  </>;
  return <>
    <h2>Which workspaces?</h2>
    <input className="wide" placeholder="Filter workspaces" value={filter} onChange={e => setFilter(e.target.value)} />
    <Checklist items={list} selected={ids} setSelected={setIds} filterText={filter}
      render={{ head: ['Workspace'], text: w => w.name, cells: w => [w.name] }} />
    <ActionBar>
      <BackButton onClick={() => setChoosing(false)} />
      <button disabled={!ids.length} onClick={() => onPick({ ids })}>Next ({ids.length} chosen)</button>
    </ActionBar>
  </>;
}

// ---------- Results: find, show, and apply ----------

function Results({ answers, users, workspaces, onRestart, onNewSearch, onBack }) {
  const { person, area, scope, action, people = [] } = answers;
  const mode = resultsMode(answers);
  const personName = users.find(u => String(u.id) === person)?.name || 'this person';
  const [phase, setPhase] = useState('loading');   // loading → ready → working → done
  const [progress, setProgress] = useState('Starting…');
  const [rows, setRows] = useState([]);           // everything found, each with key and check
  const [readErrors, setReadErrors] = useState([]);
  const [selected, setSelected] = useState([]);
  const [filter, setFilter] = useState('');
  const [taskAction, setTaskAction] = useState(action === 'find' ? '' : action);
  const [taskPeople, setTaskPeople] = useState(people);
  const [confirming, setConfirming] = useState(false);
  const [summary, setSummary] = useState(null);
  const started = useRef(false);
  const assignable = users.filter(u => u.enabled !== false && String(u.id) !== person);

  // 1. Find everything relevant.
  useEffect(() => {
    if (started.current) return; started.current = true;
    (async () => {
      try {
        let found = [];
        if (area === 'tasks') {
          setProgress('Loading boards…');
          const boards = await loadBoards(scope, { withPeopleColumns: true }, n => setProgress(`Loading boards… ${n} so far`));
          const { results, errors } = await findTasks(person, boards,
            (done, total, count) => setProgress(`Searching boards: ${done} of ${total} · ${plural(count, 'task')} found`));
          found = results.map(r => ({ ...r, check: { ok: true } }));
          setReadErrors(errors);
        } else if (area === 'boards') {
          setProgress('Loading boards and their members…');
          const boards = await loadBoards(scope, { withMembers: true }, n => setProgress(`Loading boards… ${n} so far`));
          found = describeBoards(boards, person, action)
            .filter(b => action === 'add' ? b.role === 'none' : b.role !== 'none')
            .map(b => ({ ...b, key: String(b.id) }));
        } else {
          setProgress('Checking workspace members…');
          const described = await describeWorkspaces(workspaces, person, action,
            (done, total) => setProgress(`Checking workspaces: ${done} of ${total}`));
          found = described
            .filter(w => scope.any ? true : w.role !== 'none')
            .map(w => ({ ...w, key: String(w.id) }));
        }
        found.sort((x, y) => Number(y.check.ok) - Number(x.check.ok)); // ones that will change first
        setRows(found);
        if (mode === 'go') await apply(found.filter(r => r.check.ok), found.filter(r => !r.check.ok));
        else setPhase('ready');
      } catch (error) {
        setProgress(`Something went wrong while searching: ${error.message}`);
        setPhase('error');
      }
    })();
  }, []);

  const eligible = rows.filter(r => r.check.ok);
  const notEligible = rows.filter(r => !r.check.ok);
  const needsPeople = area === 'tasks' && (taskAction === 'add' || taskAction === 'replace');
  const nameOf = r => area === 'tasks' ? `${r.item.name} (${r.board.name})` : r.name;

  // 2. Make the changes, then build the summary.
  async function apply(targets, skippedUpfront = []) {
    setPhase('working'); setConfirming(false);
    const result = {
      changed: [], failed: [], skipped: skippedUpfront.map(r => ({ name: nameOf(r), reason: r.check.reason })),
    };
    let done = 0;
    await inParallel(targets, async r => {
      try {
        const out = area === 'tasks'
          ? await changeTask(r, person, taskAction, taskPeople)
          : await changeMembership(area === 'boards' ? 'board' : 'workspace', r.id, person, action);
        if (out.status === 'changed') result.changed.push(nameOf(r));
        else result.skipped.push({ name: nameOf(r), reason: out.reason });
      } catch (error) { result.failed.push({ name: nameOf(r), reason: error.message }); }
      setProgress(`Making changes: ${++done} of ${targets.length}`);
    }, null, 2);
    setSummary(result); setPhase('done');
  }

  const chosen = mode === 'select' ? eligible.filter(r => selected.includes(r.key)) : eligible;
  const canApply = chosen.length && (area !== 'tasks' || (taskAction && (!needsPeople || taskPeople.length)));
  const peopleNames = taskPeople.map(id => users.find(u => String(u.id) === id)?.name).join(', ');
  const plan = area === 'tasks'
    ? { add: `Add ${peopleNames} to`, replace: `Replace ${personName} with ${peopleNames} on`, remove: `Remove ${personName} from` }[taskAction]
    : `${ACTIONS[area][action].verb}`.replace('them', personName);

  const render = area === 'tasks'
    ? { head: ['Task', 'Board', 'Column'], text: r => `${r.item.name} ${r.board.name}`,
        cells: r => [<a href={r.item.url} target="_blank" rel="noreferrer">{r.item.name}</a>, r.board.name, r.column.title] }
    : area === 'boards'
      ? { head: ['Board', 'Workspace', 'Their role', ''], text: r => `${r.name} ${r.workspace?.name || ''}`,
          cells: r => [<a href={r.url} target="_blank" rel="noreferrer">{r.name}</a>, r.workspace?.name || 'Main workspace', ROLE[r.role]] }
      : { head: ['Workspace', 'Their role', ''], text: r => r.name, cells: r => [r.name, ROLE[r.role]] };

  if (phase === 'loading' || phase === 'working' || phase === 'error') {
    return <><h2>{phase === 'working' ? 'Making changes' : 'Searching'}</h2><p className="status" role="status">{progress}</p>
      {phase === 'error' && <ActionBar><BackButton onClick={onBack} /><button className="secondary" onClick={onRestart}>Start again</button></ActionBar>}</>;
  }

  if (phase === 'done') return <Summary summary={summary} readErrors={readErrors} onRestart={onRestart} onNewSearch={onNewSearch} personName={personName} />;

  // phase === 'ready': a list to preview or pick from
  return <>
    <h2>{mode === 'preview' ? `Found ${plural(eligible.length, nouns[area])}` : `Choose ${nouns[area]}s`}</h2>
    <p>{rows.length
      ? mode === 'preview'
        ? `This is everything that will change. Nothing has changed yet.`
        : `Tick the ${nouns[area]}s you want to change.`
      : `Nothing found for ${personName} here.`}</p>

    {area === 'tasks' && action === 'find' && !!rows.length && <div className="bulk">
      <label>What should happen to the ticked tasks?
        <select value={taskAction} onChange={e => setTaskAction(e.target.value)}>
          <option value="">Choose an action</option>
          <option value="add">Add people (they stay on)</option>
          <option value="replace">Replace them with other people</option>
          <option value="remove">Remove them</option>
        </select>
      </label>
      {needsPeople && <label>Who?<PeoplePicker people={assignable} value={taskPeople} onChange={setTaskPeople} /></label>}
    </div>}

    {!!rows.length && <input className="wide" placeholder="Filter the list" value={filter} onChange={e => setFilter(e.target.value)} />}

    {mode === 'select'
      ? <Checklist items={rows} selected={selected} setSelected={setSelected} render={render} filterText={filter}
          disabledReason={area === 'tasks' ? undefined : r => r.check.ok ? '' : `Skipped: ${r.check.reason}`} />
      : <div className="table"><table>
          <thead><tr>{render.head.map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{rows.filter(r => !filter || render.text(r).toLowerCase().includes(filter.toLowerCase())).map(r =>
            <tr key={r.key} className={r.check.ok ? '' : 'dim'}>{render.cells(r).map((c, n) => <td key={n}>{c}</td>)}
              {area !== 'tasks' && <td className="muted">{r.check.ok ? '' : `Will be skipped: ${r.check.reason}`}</td>}</tr>)}</tbody>
        </table></div>}

    {!!readErrors.length && <details><summary>{plural(readErrors.length, 'board')} couldn't be searched</summary>
      <ul>{readErrors.map((e, i) => <li key={i}>{e.name}: {e.reason}</li>)}</ul></details>}

    <ActionBar>
      <BackButton onClick={onBack} />
      {!confirming
        ? <button disabled={!canApply} onClick={() => setConfirming(true)}>
            {mode === 'preview' ? 'Go' : `Apply to ${plural(chosen.length, nouns[area])}`}</button>
        : <div className="confirm">
            <span>{plan} {plural(chosen.length, nouns[area])}?</span>
            <button onClick={() => apply(chosen, mode === 'preview' ? notEligible : [])}>Yes, do it</button>
            <button className="secondary" onClick={() => setConfirming(false)}>Cancel</button>
          </div>}
      {!!notEligible.length && !confirming && <span className="muted">{plural(notEligible.length, nouns[area])} will be skipped</span>}
    </ActionBar>
  </>;
}

function Summary({ summary, readErrors, onRestart, onNewSearch, personName }) {
  const { changed, skipped, failed } = summary;
  return <>
    <h2>Done</h2>
    <div className="totals">
      <div className="total ok"><strong>{changed.length}</strong>changed</div>
      <div className="total"><strong>{skipped.length}</strong>skipped</div>
      <div className={`total ${failed.length ? 'bad' : ''}`}><strong>{failed.length}</strong>failed</div>
    </div>
    {!!failed.length && <details open><summary>Failed</summary><ul>{failed.map((f, i) => <li key={i}><b>{f.name}</b>: {f.reason}</li>)}</ul></details>}
    {!!skipped.length && <details open={skipped.length < 10}><summary>Skipped</summary><ul>{skipped.map((s, i) => <li key={i}><b>{s.name}</b>: {s.reason}</li>)}</ul></details>}
    {!!changed.length && <details><summary>Changed</summary><ul>{changed.map((c, i) => <li key={i}>{c}</li>)}</ul></details>}
    {!!readErrors.length && <details><summary>{plural(readErrors.length, 'board')} couldn't be searched</summary>
      <ul>{readErrors.map((e, i) => <li key={i}>{e.name}: {e.reason}</li>)}</ul></details>}
    <ActionBar>
      <button onClick={onNewSearch}>Something else for {personName}</button>
      <button className="secondary" onClick={onRestart}>Start over</button>
    </ActionBar>
  </>;
}

// ---------- The app ----------

const ORDER = ['person', 'area', 'scope', 'action', 'people', 'mode', 'run'];

function App() {
  const [users, setUsers] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [answers, setAnswers] = useState({});
  const [peopleDraft, setPeopleDraft] = useState([]);
  const [run, setRun] = useState(0); // bump to restart the results screen

  useEffect(() => {
    loadUsers().then(setUsers).catch(e => setNotice(`Couldn't load people: ${e.message}`)).finally(() => setLoading(false));
    loadWorkspaces().then(setWorkspaces).catch(e => setNotice(`Couldn't load workspaces: ${e.message}`));
  }, []);

  const step = nextStep(answers);
  const answer = (key, value) => setAnswers(a => ({ ...a, [key]: value }));
  const back = () => setAnswers(a => {
    const last = [...ORDER].reverse().find(k => a[k] !== undefined);
    const next = { ...a }; delete next[last];
    if (last === 'people') setPeopleDraft([]);
    return next;
  });
  const restart = () => { setAnswers({}); setPeopleDraft([]); setRun(r => r + 1); };
  const newSearch = () => { setAnswers(a => ({ person: a.person })); setPeopleDraft([]); setRun(r => r + 1); };

  const person = users.find(u => String(u.id) === answers.person);
  const assignable = users.filter(u => u.enabled !== false && String(u.id) !== answers.person);
  const scopeText = s => !s ? '' : s.all ? 'All workspaces' : s.any ? 'Any workspace' : s.theirs ? 'Their workspaces'
    : plural(s.ids.length, 'workspace');
  const trail = [
    person?.name, AREAS[answers.area]?.label, scopeText(answers.scope),
    answers.action && ACTIONS[answers.area][answers.action].label,
    answers.people?.length && `with ${answers.people.map(id => users.find(u => String(u.id) === id)?.name).join(', ')}`,
    answers.mode && (answers.mode === 'all' ? 'All' : 'Select'),
    answers.run && (answers.run === 'preview' ? 'Show first' : 'Go straight in'),
  ].filter(Boolean);

  const actionOptions = answers.area && Object.entries(ACTIONS[answers.area])
    .filter(([key]) => key !== 'add'
      || answers.area === 'tasks'
      || (answers.area === 'boards' && !answers.scope?.all)
      || (answers.area === 'workspaces' && answers.scope?.any))
    .map(([value, a]) => ({ value, label: a.label, hint: a.hint }));

  return <main>
    <datalist id="people-options">{assignable.map(u => <option key={u.id} value={userLabel(u)} />)}</datalist>
    <header>
      <h1>People administration</h1>
      <p>Find a person's tasks, boards and workspaces, and change them in one go.</p>
    </header>

    {notice && <p className="status" role="status">{notice}</p>}

    {!!trail.length && <nav className="trail" aria-label="Your choices">
      {trail.map((t, i) => <span key={i}>{t}</span>)}
    </nav>}

    <section>
      {step === 'person' && <PersonStep users={users} loading={loading} onPick={id => answer('person', id)} />}

      {step === 'area' && <><h2>What are you looking at for {person?.name}?</h2>
        <Options options={Object.entries(AREAS).map(([value, a]) => ({ value, label: a.label, hint: a.hint }))}
          onPick={v => answer('area', v)} /></>}

      {step === 'scope' && answers.area !== 'workspaces' && <WorkspaceScopeStep workspaces={workspaces} onPick={s => answer('scope', s)} onBack={back} />}
      {step === 'scope' && answers.area === 'workspaces' && <><h2>Which workspaces?</h2>
        <Options options={[
          { value: 'theirs', label: `Only ones ${person?.name} is in`, hint: 'Workspaces they are a member or owner of' },
          { value: 'any', label: 'Any workspace', hint: "Pick from every workspace, including ones they're not in" },
        ]} onPick={v => answer('scope', { [v]: true })} /></>}

      {step === 'action' && <><h2>What would you like to do?</h2>
        <Options options={actionOptions} onPick={v => answer('action', v)} /></>}

      {step === 'people' && <><h2>{answers.action === 'add' ? 'Who should be added?' : `Who should replace ${person?.name}?`}</h2>
        <p className="muted">Add as many people as you need.</p>
        <PeoplePicker people={assignable} value={peopleDraft} onChange={setPeopleDraft} />
        <ActionBar>
          <BackButton onClick={back} />
          <button disabled={!peopleDraft.length} onClick={() => answer('people', peopleDraft)}>Next</button>
        </ActionBar></>}

      {step === 'mode' && <><h2>All of them, or choose?</h2>
        <Options options={[
          { value: 'all', label: `Do this to all ${answers.area}`, hint: `Every ${nouns[answers.area]} I find` },
          { value: 'select', label: `Select ${answers.area}`, hint: `I'll list them and you tick which ones` },
        ]} onPick={v => answer('mode', v)} /></>}

      {step === 'run' && <><h2>Before I start</h2>
        <Options options={[
          { value: 'preview', label: `Show me the ${answers.area} first`, hint: 'See the full list, then press Go' },
          { value: 'go', label: 'Go straight in', hint: `Find them and change them now` },
        ]} onPick={v => answer('run', v)} /></>}

      {step === 'results' && <Results key={run} answers={answers} users={users} workspaces={workspaces}
        onRestart={restart} onNewSearch={newSearch} onBack={back} />}

      {(['area', 'action', 'mode', 'run'].includes(step) || (step === 'scope' && answers.area === 'workspaces')) &&
        <ActionBar><BackButton onClick={back} /></ActionBar>}
    </section>

    <footer>Covers boards and workspaces your account can see. Other people and teams are never changed.</footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
