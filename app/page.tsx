'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { runPipeline, type PipelineStatus } from '@/lib/client/pipeline';

type Role = 'PM' | 'SPM';
type Item = {
  key: string;
  file: File;
  role: Role;
  state: 'queued' | 'uploading' | 'scored' | 'queued-for-retry' | 'duplicate' | 'error';
  message?: string;
};

const ACCEPT = '.pdf,.docx,.txt,.md,.rtf';

export default function UploadPage() {
  const [role, setRole] = useState<Role | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [pipe, setPipe] = useState<{ running: boolean; status?: PipelineStatus; error?: string; done?: boolean }>({ running: false });
  const input = useRef<HTMLInputElement>(null);

  const update = (key: string, patch: Partial<Item>) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  function addFiles(files: FileList | null) {
    if (!files || !role) return;
    const next = Array.from(files).map((file) => ({
      key: `${file.name}-${file.size}-${Math.random()}`,
      file,
      role,
      state: 'queued' as const,
    }));
    setItems((xs) => [...xs, ...next]);
  }

  async function uploadOne(it: Item) {
    update(it.key, { state: 'uploading' });
    const fd = new FormData();
    fd.append('file', it.file);
    fd.append('role', it.role);
    try {
      const res = await fetch('/api/candidates', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) return update(it.key, { state: 'duplicate', message: 'Already uploaded - skipped' });
      if (!res.ok) return update(it.key, { state: 'error', message: data.error || `Upload failed (${res.status})` });
      const who = data.name || 'Name not found - add it on the dashboard';
      if (data.scores) {
        update(it.key, {
          state: 'scored',
          message: `${who} · PM ${data.scores.PM} · SPM ${data.scores.SPM}${data.hasEmail ? '' : ' · no email found on CV'}`,
        });
      } else {
        update(it.key, { state: 'queued-for-retry', message: `${who} · scoring will retry: ${data.scoreError}` });
      }
    } catch (e) {
      update(it.key, { state: 'error', message: (e as Error).message });
    }
  }

  async function start() {
    setBusy(true);
    const queue = items.filter((i) => i.state === 'queued');
    // Two uploads at a time keeps us inside Gemini free-tier rate limits.
    const work = async () => {
      for (let it = queue.shift(); it; it = queue.shift()) await uploadOne(it);
    };
    await Promise.all([work(), work()]);
    setPipe({ running: true });
    await runPipeline((status, error) => setPipe((p) => ({ ...p, status, error: error ?? p.error })));
    setPipe((p) => ({ ...p, running: false, done: true }));
    setBusy(false);
  }

  const queued = items.filter((i) => i.state === 'queued').length;
  const badge: Record<Item['state'], string> = {
    queued: 'b-grey', uploading: 'b-warn', scored: 'b-invite', 'queued-for-retry': 'b-warn', duplicate: 'b-grey', error: 'b-reject',
  };

  return (
    <>
      <h1>Upload CVs</h1>
      <p className="muted">
        Personal details (name, email, phone, profile links) are separated from each CV on upload and stored privately.
        Only the redacted CV is sent to the AI, which scores it against both the PM and SPM rubrics.
      </p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>1. Which role did these candidates apply for?</h3>
        <div className="row role-pick">
          {(['PM', 'SPM'] as Role[]).map((r) => (
            <label key={r} className={role === r ? 'on' : ''}>
              <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} disabled={busy} />
              {r === 'PM' ? 'Product Manager (PM)' : 'Senior Product Manager (SPM)'}
            </label>
          ))}
        </div>

        <h3>2. Add CV files</h3>
        <div
          className={`drop ${over ? 'over' : ''}`}
          style={{ opacity: role ? 1 : 0.5 }}
          onClick={() => role && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
        >
          {role ? (
            <>Drop PDF, DOCX or TXT files here, or click to choose. Files added now are tagged <b>{role}</b>.</>
          ) : (
            'Select a role first'
          )}
          <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        </div>
        <p className="small muted">To upload for both roles, add the PM files, switch the role, then add the SPM files.</p>

        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" disabled={busy || queued === 0} onClick={start}>
            {busy ? 'Working…' : `Upload & process ${queued || ''} CV${queued === 1 ? '' : 's'}`}
          </button>
          {items.length > 0 && !busy && (
            <button onClick={() => setItems((xs) => xs.filter((x) => x.state === 'queued' ? false : true))}>Clear queued</button>
          )}
        </div>
      </div>

      {items.length > 0 && (
        <div className="card">
          <table>
            <thead><tr><th>File</th><th>Role</th><th>Status</th><th>Result</th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.key}>
                  <td>{it.file.name}</td>
                  <td>{it.role}</td>
                  <td><span className={`badge ${badge[it.state]}`}>{it.state.replace(/-/g, ' ')}</span></td>
                  <td className="small">{it.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(pipe.running || pipe.done) && (
        <div className={`notice ${pipe.done && !pipe.error ? 'ok' : pipe.error ? 'err' : 'info'}`}>
          {pipe.running && pipe.status && (
            <>Preparing ranking, interview briefs and draft emails… {pipe.status.scoring > 0 && `${pipe.status.scoring} CV(s) left to score. `}
              {pipe.status.drafts > 0 && `${pipe.status.drafts} draft(s) left to write.`}</>
          )}
          {pipe.running && !pipe.status && 'Preparing ranking, interview briefs and draft emails…'}
          {pipe.done && (
            <>
              Done. {pipe.status?.errors ? `${pipe.status.errors} CV(s) could not be scored - see the dashboard. ` : ''}
              <Link href="/dashboard">Open the dashboard →</Link>
            </>
          )}
          {pipe.error && <div className="small">Last error: {pipe.error}</div>}
        </div>
      )}
    </>
  );
}
