import React, { useEffect, useRef, useState } from 'react';
import { PackageOpen, X, LoaderCircle } from 'lucide-react';
export const complaintStages = ['Submitted', 'Under Review', 'Assigned', 'In Progress', 'Resolved', 'Closed'];
export const laundryStages = ['Scheduled', 'Collected', 'Washing', 'Drying', 'Quality Check', 'Ready', 'Delivered'];
export const categories = ['Missing clothes', 'Damaged clothes', 'Delayed delivery', 'Incorrect bag', 'Washing quality', 'Other laundry issue'];
export const go = path => { location.hash = path; };
export const date = value => value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Not yet set';
export const datetime = value => value ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Not yet set';
export const isOpen = c => !['Resolved', 'Closed'].includes(c.status);
export async function api(path, method = 'GET', body) {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Request failed.'); error.status = response.status; throw error; }
  return data;
}
export function uploadComplaint(body, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/complaints'); xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and retry.'));
    xhr.onload = () => { try { const result = JSON.parse(xhr.responseText); xhr.status < 300 ? resolve(result) : reject(new Error(result.error)); } catch { reject(new Error('Unexpected upload response.')); } };
    xhr.send(JSON.stringify(body));
  });
}
export function Badge({ status }) { return <span className={`badge ${['Resolved', 'Closed', 'Ready', 'Delivered'].includes(status) ? 'positive' : ['Submitted', 'Scheduled', 'Under Review'].includes(status) ? 'neutral' : 'working'}`}>{status}</span>; }
export function Empty({ title = 'Nothing here yet', children, action }) { return <div className="empty"><div className="empty-art"><PackageOpen size={35} strokeWidth={1.25}/></div><h3>{title}</h3><p>{children}</p>{action}</div>; }
export function Field({ label, children, ...props }) { return <label className="field"><span>{label}</span>{children || <input {...props}/>}</label>; }
export function Panel({ title, subtitle, action, children, className = '' }) { return <section className={`panel ${className}`}><div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>; }
export function Modal({ title, children, close }) {
  const ref = useRef();
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} onCancel={close} onClick={e => { if (e.target === ref.current) close(); }}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={20}/></button></div>{children}</dialog>;
}
export function Form({ onSave, children, label = 'Save changes', className = '' }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <form className={`form ${className}`} onSubmit={async e => { e.preventDefault(); if (busy) return; const data = Object.fromEntries(new FormData(e.currentTarget)); setBusy(true); setError(''); try { await onSave(data); } catch (err) { setError(err.message); } finally { setBusy(false); } }}>
    <fieldset disabled={busy}>{children}</fieldset>{error && <p role="alert" className="error">{error}</p>}<button className="button primary" disabled={busy} type="submit">{busy && <LoaderCircle className="spin" size={16}/>} {busy ? 'Saving…' : label}</button>
  </form>;
}
export function Timeline({ events }) { return <ol className="timeline">{events.map(e => <li key={e.id}><span className="timeline-node"/><div><div className="timeline-title"><strong>{e.status}</strong><time>{datetime(e.created_at)}</time></div><p>{e.note}</p><small>{e.actor_name}{e.worker_name ? ` · ${e.worker_name}` : ''}</small></div></li>)}</ol>; }
export function Steps({ stages, status }) { const current = stages.indexOf(status); return <ol className="steps">{stages.map((s, i) => <li className={i <= current ? 'complete' : ''} key={s} aria-current={s === status ? 'step' : undefined}><span>{i < current ? '✓' : i + 1}</span><small>{s}</small></li>)}</ol>; }
export function exportCSV(rows, filename) {
  if (!rows.length) return;
  const cell = value => { const str = String(value ?? ''); return `"${(/^[=+@\-\t\r]/.test(str) ? "'" : '') + str.replaceAll('"', '""')}"`; };
  const keys = Object.keys(rows[0]);
  const blob = new Blob(['\uFEFF', keys.map(cell).join(','), '\r\n', rows.map(row => keys.map(key => cell(row[key])).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
