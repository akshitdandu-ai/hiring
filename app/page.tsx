'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { runPipeline, type PipelineProgress } from '@/lib/client/pipeline';
import PageHero from './PageHero';

type Role = 'PM' | 'SPM';
type Item = {
  key: string;
  file: File;
  role: Role;
  state: 'waiting' | 'uploading' | 'saved' | 'duplicate' | 'failed';
  message?: string;
};

const ACCEPT = '.pdf,.docx,.txt';
const PILL: Record<Item['state'], [string, string]> = {
  waiting: ['grey', 'Waiting'],
  uploading: ['blue', 'Uploading…'],
  saved: ['green', 'Uploaded'],
  duplicate: ['grey', 'Already uploaded'],
  failed: ['red', 'Could not read'],
};

export default function UploadPage() {
  const [role, setRole] = useState<Role | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const update = (key: string, patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  function addFiles(files: FileList | null) {
    if (!files || !role || busy) return;
    const next = Array.from(files).map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, role, state: 'waiting' as const }));
    setItems((xs) => [...xs, ...next]);
    setDone(false);
  }

  async function uploadOne(it: Item) {
    update(it.key, { state: 'uploading' });
    const fd = new FormData();
    fd.append('file', it.file);
    fd.append('role', it.role);
    try {
      const res = await fetch('/api/candidates', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) return update(it.key, { state: 'duplicate' });
      if (!res.ok) return update(it.key, { state: 'failed', message: data.error || 'Upload failed' });
      update(it.key, { state: 'saved', message: data.name || 'Name not found on CV' });
    } catch {
      update(it.key, { state: 'failed', message: 'Network error - try again' });
    }
  }

  async function start() {
    setBusy(true);
    setDone(false);
    const queue = items.filter((i) => i.state === 'waiting');
    const work = async () => {
      for (let it = queue.shift(); it; it = queue.shift()) await uploadOne(it);
    };
    setProgress({ status: { scoring: 0, drafts: 0, errors: 0 }, notice: null });
    setTotal(0);
    await Promise.all([work(), work(), work()]);
    let max = 0;
    await runPipeline((p) => {
      max = Math.max(max, p.status.scoring + p.status.drafts);
      setTotal(max);
      setProgress(p);
    });
    setBusy(false);
    setDone(true);
  }

  const waiting = items.filter((i) => i.state === 'waiting').length;
  const left = progress ? progress.status.scoring + progress.status.drafts : 0;
  const pct = total ? Math.round(((total - left) / total) * 100) : 0;

  return (
    <>
      <PageHero title="Upload CVs">
        Each CV is scored against both the PM and SPM rubrics. Names, emails and phone numbers are separated on upload and
        never sent to the AI.
      </PageHero>

      <div className="card">
        <div className="step"><span className="n">1</span> Role applied for</div>
        <div className="seg">
          {(['PM', 'SPM'] as Role[]).map((r) => (
            <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(r)} disabled={busy}>
              {r === 'PM' ? 'Product Manager' : 'Senior Product Manager'}
            </button>
          ))}
        </div>

        <div className="step" style={{ marginTop: 22 }}><span className="n">2</span> CV files</div>
        <div
          className={`drop ${over ? 'over' : ''} ${role && !busy ? '' : 'disabled'}`}
          onClick={() => role && !busy && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); if (role) setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
        >
          <div className="big">{role ? 'Drop CVs here or click to choose' : 'Choose the role first'}</div>
          <div className="muted small">
            PDF, DOCX or TXT{role ? ` · added as ${role === 'PM' ? 'Product Manager' : 'Senior Product Manager'} applicants` : ''}
          </div>
          <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        </div>

        <div className="spread" style={{ marginTop: 16 }}>
          <span className="muted small">For both roles: add the PM CVs, switch role, then add the SPM CVs.</span>
          <button className="primary" disabled={busy || waiting === 0} onClick={start}>
            {busy ? 'Processing…' : `Upload and process${waiting ? ` ${waiting} CV${waiting === 1 ? '' : 's'}` : ''}`}
          </button>
        </div>
      </div>

      {progress && (busy || done) && (
        <div className="card">
          {busy ? (
            <>
              <div className="spread">
                <strong>
                  {items.some((i) => i.state === 'waiting' || i.state === 'uploading')
                    ? `Uploading CVs · ${items.filter((i) => i.state === 'waiting' || i.state === 'uploading').length} left`
                    : total === 0
                      ? 'Starting AI scoring…'
                      : progress.status.scoring > 0
                    ? `Scoring CVs against the rubrics · ${progress.status.scoring} left`
                    : progress.status.drafts > 0
                      ? `Writing interview briefs and emails · ${progress.status.drafts} left`
                      : 'Finishing up…'}
                </strong>
                <span className="muted small">{pct}%</span>
              </div>
              <div className="progress"><span style={{ width: `${pct}%` }} /></div>
              {progress.notice === 'busy' ? (
                <div className="small" style={{ color: 'var(--amber)' }}>
                  Google&apos;s AI service is busy right now. Retrying automatically - keep this page open.
                </div>
              ) : (
                <div className="muted small">Keep this page open until it finishes.</div>
              )}
            </>
          ) : progress.notice === 'quota' ? (
            <div className="notice warn" style={{ margin: 0 }}>
              The free Gemini quota for today is used up. Already-scored candidates are on the dashboard; the rest will be
              processed when you open the dashboard again later.
            </div>
          ) : progress.notice === 'error' ? (
            <div className="notice err" style={{ margin: 0 }}>Something went wrong: {progress.message}</div>
          ) : left > 0 ? (
            <div className="notice warn" style={{ margin: 0 }}>
              Paused while Google&apos;s AI is busy. Open the dashboard and it will continue.
            </div>
          ) : (
            <div className="spread">
              <div><strong>All done.</strong> <span className="muted">Candidates are ranked with briefs and draft emails ready.</span></div>
              <Link className="btn primary" href="/dashboard">Open dashboard →</Link>
            </div>
          )}
        </div>
      )}

      {items.length > 0 && (
        <div className="card tbl">
          <table>
            <thead><tr><th>File</th><th>Role</th><th>Status</th><th>Candidate</th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.key}>
                  <td>{it.file.name}</td>
                  <td>{it.role}</td>
                  <td><span className={`pill ${PILL[it.state][0]}`}>{PILL[it.state][1]}</span></td>
                  <td className="small muted">{it.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
