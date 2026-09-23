import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { loadUsers, loadBoards, findAssignments, reassign } from './api';
import './style.css';
function App() {
  const [users,setUsers]=useState([]), [boards,setBoards]=useState([]), [source,setSource]=useState(''), [target,setTarget]=useState('');
  const [filter,setFilter]=useState(''), [rows,setRows]=useState([]), [selected,setSelected]=useState([]), [errors,setErrors]=useState([]);
  const [busy,setBusy]=useState(false), [progress,setProgress]=useState(''), [notice,setNotice]=useState('');
  useEffect(()=>{Promise.all([loadUsers(),loadBoards()]).then(([u,b])=>{setUsers(u);setBoards(b);}).catch(e=>setNotice(e.message));},[]);
  async function search() {
    if (!source) return;
    setBusy(true);setRows([]);setSelected([]);setErrors([]);setNotice('');
    try { const result=await findAssignments(source,boards,(n,total,matches,failures)=>{setProgress(`Searched ${n}/${total} people columns`);setRows(matches);setErrors(failures);}); setRows(result.results);setErrors(result.errors); }
    catch(e){setNotice(e.message);} finally{setBusy(false);setProgress('');}
  }
  async function apply() {
    if (!target || !selected.length || source===target) return;
    const newName=users.find(u=>String(u.id)===target)?.name;
    if (!window.confirm(`Replace the selected person with ${newName} on ${selected.length} assignment(s)? This updates live items.`)) return;
    setBusy(true);setNotice('');let success=0;const failures=[];
    for (const key of selected) {
      const row=rows.find(r=>`${r.item.id}:${r.column.id}`===key);
      if (!row) continue;
      try { await reassign(row,source,target);success++;setRows(current=>current.filter(r=>`${r.item.id}:${r.column.id}`!==key)); }
      catch(e){failures.push(`${row.item.name}: ${e.message}`);}
      setProgress(`Updated ${success}; failed ${failures.length}; processed ${success+failures.length}/${selected.length}`);
    }
    setSelected([]);setErrors(current=>[...current,...failures]);setNotice(`${success} assignment(s) reassigned${failures.length?`; ${failures.length} failed`:''}.`);setBusy(false);setProgress('');
  }
  const visibleUsers=users.filter(u=>`${u.name} ${u.email||''}`.toLowerCase().includes(filter.toLowerCase()));
  const keys=rows.map(r=>`${r.item.id}:${r.column.id}`);
  return <main><header><h1>Assignment administration</h1><p>Find a person's assignments across accessible boards and hand selected work to someone else.</p></header>
    <section className="controls"><label>Find user<input placeholder="Filter names or emails" value={filter} onChange={e=>setFilter(e.target.value)}/><select value={source} onChange={e=>{setSource(e.target.value);setRows([]);setSelected([]);}}><option value="">Select a user</option>{visibleUsers.map(u=><option value={u.id} key={u.id}>{u.name} {u.email?`(${u.email})`:''}</option>)}</select></label><button onClick={search} disabled={!source||busy||!boards.length}>Search assignments</button><span>{boards.length} accessible boards</span></section>
    {progress&&<p role="status">{progress}</p>}{notice&&<p role="status">{notice}</p>}
    <section><div className="heading"><h2>Assignments ({rows.length})</h2><label><input type="checkbox" checked={!!keys.length&&selected.length===keys.length} onChange={e=>setSelected(e.target.checked?keys:[])} disabled={busy}/> Select all</label></div><div className="table"><table><thead><tr><th>Select</th><th>Task</th><th>Board</th><th>People column</th></tr></thead><tbody>{rows.map(row=>{const key=`${row.item.id}:${row.column.id}`;return <tr key={key}><td><input type="checkbox" disabled={busy} checked={selected.includes(key)} onChange={e=>setSelected(current=>e.target.checked?[...current,key]:current.filter(x=>x!==key))}/></td><td><a href={row.item.url} target="_blank" rel="noreferrer">{row.item.name}</a></td><td>{row.board.name}</td><td>{row.column.title}</td></tr>})}</tbody></table>{!rows.length&&!busy&&<p>No matching assignments loaded.</p>}</div></section>
    <section className="action"><label>Reassign selected to<select value={target} onChange={e=>setTarget(e.target.value)}><option value="">Select a new person</option>{users.filter(u=>String(u.id)!==source).map(u=><option key={u.id} value={u.id}>{u.name} {u.email?`(${u.email})`:''}</option>)}</select></label><button onClick={apply} disabled={busy||!target||!selected.length}>Reassign {selected.length} selected</button></section>
    {!!errors.length&&<details><summary>{errors.length} board or item error(s)</summary><ul>{errors.map((e,i)=><li key={i}>{e}</li>)}</ul></details>}
    <footer>Searches include active items on boards this admin can access. Existing co-assignees and teams are preserved.</footer></main>;
}
createRoot(document.getElementById('root')).render(<App/>);
