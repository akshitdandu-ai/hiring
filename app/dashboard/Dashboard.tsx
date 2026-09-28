'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { runPipeline, type PipelineStatus } from '@/lib/client/pipeline';
import { personalise } from '@/lib/ranking';

type Role = 'PM' | 'SPM';
type Decision = 'invite' | 'reject';
type Score = { criterion_id: string; role: Role; score: number; reason: string; name: string; weight: number };
type Candidate = {
  id: string;
  created_at: string;
  file_name: string | null;
  applied_role: Role;
  personal_details: { name?: string; email?: string; phone?: string; links?: string[] };
  status: 'new' | 'scored' | 'error';
  last_error: string | null;
  headline: string | null;
  ai_model: string | null;
  pm_score: number | null;
  spm_score: number | null;
  decision_override: Decision | null;
  brief: string | null;
  draft_decision: Decision | null;
  email_subject: string | null;
  email_body: string | null;
  draft_edited: boolean;
  draft_error: string | null;
  email_status: 'none' | 'sending' | 'sent' | 'failed';
  sent_at: string | null;
  sent_to: string | null;
  send_error: string | null;
  rank: number | null;
  recommended: Decision | null;
  decision: Decision | null;
  scores: Score[];
};
type Data = {
  config: { topN: number; inviteThreshold: number; testRecipient: string | null; resendConfigured: boolean; aiConfigured: boolean };
  status: PipelineStatus;
  candidates: Candidate[];
};

const ROLE_LABEL: Record<Role, string> = { PM: 'Product Manager', SPM: 'Senior Product Manager' };

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const draftReady = (c: Candidate) => Boolean(c.email_body) && c.draft_decision === c.decision;
const score = (c: Candidate, r: Role) => (r === 'PM' ? c.pm_score : c.spm_score);

export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Role>('PM');
  const [open, setOpen] = useState<string | null>(null);
  const [pipe, setPipe] = useState<{ running: boolean; status?: PipelineStatus; error?: string }>({ running: false });
  const [bulk, setBulk] = useState<string | null>(null);
  const running = useRef(false);

  const load = useCallback(async () => {
    try {
      const d: Data = await api('/api/candidates');
      setData(d);
      setLoadError(null);
      return d;
    } catch (e) {
      setLoadError((e as Error).message);
      return null;
    }
  }, []);

  const drive = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setPipe({ running: true });
    let last = 0;
    await runPipeline((status, error) => {
      setPipe({ running: true, status, error });
      // Refresh the list every few seconds so new scores / drafts appear as they land.
      if (Date.now() - last > 3000) {
        last = Date.now();
        load();
      }
    });
    running.current = false;
    setPipe((p) => ({ ...p, running: false }));
    await load();
  }, [load]);

  useEffect(() => {
    load().then((d) => {
      if (d && d.config.aiConfigured && d.status.scoring + d.status.drafts > 0) drive();
    });
  }, [load, drive]);

  /** Run a candidate action, then let the pipeline rewrite anything that changed. */
  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      await fn();
      const d = await load();
      if (d && d.status.scoring + d.status.drafts > 0) drive();
    },
    [load, drive],
  );

  if (loadError) return <div className="notice err">Could not load candidates: {loadError}</div>;
  if (!data) return <p className="muted">Loading…</p>;

  const { config } = data;
  const inRole = data.candidates.filter((c) => c.applied_role === tab);
  const scored = inRole.filter((c) => c.status === 'scored').sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  const invites = scored.filter((c) => c.decision === 'invite');
  const rejects = scored.filter((c) => c.decision === 'reject');
  const unscored = inRole.filter((c) => c.status !== 'scored');
  const pendingRejects = rejects.filter((c) => c.email_status !== 'sent' && draftReady(c));
  const sentCount = inRole.filter((c) => c.email_status === 'sent').length;

  async function sendAllRejections() {
    if (!confirm(`Send ${pendingRejects.length} rejection emails for ${ROLE_LABEL[tab]}? This cannot be undone.`)) return;
    let ok = 0;
    const failures: string[] = [];
    for (const c of pendingRejects) {
      setBulk(`Sending ${ok + failures.length + 1} of ${pendingRejects.length}…`);
      try {
        await api(`/api/candidates/${c.id}/send`, { method: 'POST' });
        ok++;
      } catch (e) {
        failures.push(`${c.personal_details.name || c.file_name}: ${(e as Error).message}`);
      }
    }
    setBulk(`Sent ${ok} rejection email(s).${failures.length ? ` Failed: ${failures.join('; ')}` : ''}`);
    load();
  }

  return (
    <>
      <div className="spread">
        <div>
          <h1>Candidates</h1>
          <div className="muted small">
            Ranked by weighted rubric score for the role applied for. Interview line: top {config.topN} per role scoring at
            least {config.inviteThreshold}/100. The system recommends - you decide. Nothing is sent until you click send.
          </div>
        </div>
        <Link className="btn primary" href="/">+ Upload CVs</Link>
      </div>

      {!config.aiConfigured && <div className="notice err">GEMINI_API_KEY is not set - CVs cannot be scored or drafted.</div>}
      {!config.resendConfigured && <div className="notice">RESEND_API_KEY is not set yet - drafts are ready to review, but sending is disabled.</div>}
      {config.testRecipient && <div className="notice info">Test mode: every email is sent to {config.testRecipient}, not to the candidate.</div>}
      {(pipe.running || data.status.scoring + data.status.drafts > 0) && (
        <div className="notice info">
          {pipe.running ? 'Pipeline running: ' : 'Pending: '}
          {data.status.scoring > 0 && `${pipe.status?.scoring ?? data.status.scoring} CV(s) to score. `}
          {(pipe.status?.drafts ?? data.status.drafts) > 0 && `${pipe.status?.drafts ?? data.status.drafts} brief/draft(s) to write. `}
          {!pipe.running && <button onClick={drive}>Run now</button>}
          {pipe.error && <div className="small">Last error: {pipe.error}</div>}
        </div>
      )}

      <div className="tabs">
        {(['PM', 'SPM'] as Role[]).map((r) => (
          <button key={r} className={tab === r ? 'on' : ''} onClick={() => setTab(r)}>
            {ROLE_LABEL[r]} ({data.candidates.filter((c) => c.applied_role === r).length})
          </button>
        ))}
      </div>

      <div className="spread" style={{ marginTop: 10 }}>
        <div className="small muted">
          {invites.length} to interview · {rejects.length} not moving forward · {sentCount} emailed
        </div>
        {pendingRejects.length > 0 && config.resendConfigured && (
          <button onClick={sendAllRejections} disabled={Boolean(bulk?.startsWith('Sending'))}>
            Send all {pendingRejects.length} rejection drafts
          </button>
        )}
      </div>
      {bulk && <div className="notice info small">{bulk}</div>}

      {inRole.length === 0 && <div className="card muted">No candidates for this role yet. <Link href="/">Upload CVs</Link>.</div>}

      {invites.length > 0 && <div className="divider">Interview ({invites.length})</div>}
      {invites.map((c) => (
        <CandidateCard key={c.id} c={c} role={tab} config={config} open={open === c.id} toggle={() => setOpen(open === c.id ? null : c.id)} act={act} />
      ))}
      {rejects.length > 0 && <div className="divider">Below the line - not moving forward ({rejects.length})</div>}
      {rejects.map((c) => (
        <CandidateCard key={c.id} c={c} role={tab} config={config} open={open === c.id} toggle={() => setOpen(open === c.id ? null : c.id)} act={act} />
      ))}
      {unscored.length > 0 && <div className="divider">Not scored yet ({unscored.length})</div>}
      {unscored.map((c) => (
        <div key={c.id} className="card spread">
          <div>
            <b>{c.personal_details.name || c.file_name}</b>{' '}
            {c.status === 'error' ? <span className="badge b-reject">scoring failed</span> : <span className="badge b-warn">waiting to be scored</span>}
            {c.last_error && <div className="small muted">{c.last_error}</div>}
          </div>
          <div className="row">
            <button onClick={() => act(() => api(`/api/candidates/${c.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'rescore' }) }))}>Retry</button>
            <button className="danger" onClick={() => confirm('Delete this candidate?') && act(() => api(`/api/candidates/${c.id}`, { method: 'DELETE' }))}>Delete</button>
          </div>
        </div>
      ))}
    </>
  );
}

function CandidateCard({
  c, role, config, open, toggle, act,
}: {
  c: Candidate;
  role: Role;
  config: Data['config'];
  open: boolean;
  toggle: () => void;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const other: Role = role === 'PM' ? 'SPM' : 'PM';
  const name = c.personal_details.name;
  const ready = draftReady(c);
  const sent = c.email_status === 'sent';
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [editDetails, setEditDetails] = useState(false);
  const [details, setDetails] = useState({ name: '', email: '', phone: '' });

  useEffect(() => {
    if (!dirty) {
      setSubject(personalise(c.email_subject || '', name));
      setBody(personalise(c.email_body || '', name));
    }
  }, [c.email_subject, c.email_body, name, dirty]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setErr(null);
    try {
      await act(fn);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const patch = (payload: object) => api(`/api/candidates/${c.id}`, { method: 'PATCH', body: JSON.stringify(payload) });

  async function send() {
    const to = config.testRecipient || c.personal_details.email;
    if (!to) return setErr('No email address on file - add one under candidate details.');
    if (!confirm(`Send this ${c.decision === 'invite' ? 'interview invite' : 'rejection'} to ${to}?`)) return;
    await run('send', async () => {
      if (dirty) {
        await patch({ action: 'edit_email', subject, body });
        setDirty(false);
      }
      await api(`/api/candidates/${c.id}/send`, { method: 'POST' });
    });
  }

  const appliedScore = score(c, role);
  const otherScore = score(c, other);
  const strongerElsewhere = otherScore !== null && appliedScore !== null && otherScore >= config.inviteThreshold && otherScore > appliedScore;
  const rows = c.scores.filter((s) => s.role === (showOther ? other : role));

  return (
    <div className="card cand">
      <div className="cand-head" onClick={toggle}>
        <div className="rank">#{c.rank}</div>
        <div>
          <div className="row">
            <b>{name || <span className="muted">Name not found ({c.file_name})</span>}</b>
            <span className={`badge ${c.decision === 'invite' ? 'b-invite' : 'b-reject'}`}>
              {c.decision === 'invite' ? 'Interview' : 'Reject'}
              {c.decision_override ? ' (your call)' : ''}
            </span>
            {sent && <span className="badge b-sent">Sent {new Date(c.sent_at!).toLocaleDateString()}</span>}
            {c.email_status === 'failed' && <span className="badge b-reject">Send failed</span>}
            {!sent && !ready && <span className="badge b-warn">Drafting…</span>}
            {strongerElsewhere && <span className="badge b-warn">Stronger fit for {other}</span>}
          </div>
          <div className="small muted">{c.headline}</div>
        </div>
        <div>
          <div className="score">{appliedScore}</div>
          <div className="small muted" style={{ textAlign: 'right' }}>{other} {otherScore}</div>
        </div>
      </div>

      {open && (
        <div className="cand-body">
          <div>
            {c.brief && (
              <>
                <h3 style={{ marginTop: 0 }}>Interview brief</h3>
                <div className="brief">{c.brief}</div>
              </>
            )}
            <div className="spread">
              <h3>Score breakdown · {showOther ? other : role} rubric</h3>
              <button className="small" onClick={() => setShowOther(!showOther)}>Show {showOther ? role : other} rubric</button>
            </div>
            <table>
              <thead><tr><th>Criterion</th><th>Score</th><th>Why</th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.criterion_id}>
                    <td>{s.name}<div className="small muted">weight {s.weight}%</div></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <b>{s.score}/5</b><br />
                      <span className="bar"><span style={{ width: `${(s.score / 5) * 100}%` }} /></span>
                    </td>
                    <td className="small">{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="small muted" style={{ marginTop: 6 }}>
              Weighted total: {showOther ? otherScore : appliedScore}/100{c.ai_model ? ` · scored by ${c.ai_model}` : ''}
            </div>

            <h3>Candidate details <span className="small muted">(private - never sent to AI)</span></h3>
            {editDetails ? (
              <div style={{ display: 'grid', gap: 6 }}>
                <input type="text" placeholder="Name" value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} />
                <input type="email" placeholder="Email" value={details.email} onChange={(e) => setDetails({ ...details, email: e.target.value })} />
                <input type="text" placeholder="Phone" value={details.phone} onChange={(e) => setDetails({ ...details, phone: e.target.value })} />
                <div className="row">
                  <button className="primary" disabled={!!busy} onClick={() => run('details', async () => { await patch({ action: 'edit_details', ...details }); setEditDetails(false); })}>Save</button>
                  <button onClick={() => setEditDetails(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="small">
                {name || '-'} · {c.personal_details.email || <span className="badge b-warn">no email</span>} · {c.personal_details.phone || 'no phone'}
                {c.personal_details.links?.length ? <> · {c.personal_details.links.join(' · ')}</> : null}
                <div className="muted">File: {c.file_name}</div>
                <button className="small" style={{ marginTop: 4 }} onClick={() => { setDetails({ name: name || '', email: c.personal_details.email || '', phone: c.personal_details.phone || '' }); setEditDetails(true); }}>Edit details</button>
              </div>
            )}
          </div>

          <div>
            <div className="spread">
              <h3 style={{ marginTop: 0 }}>{c.decision === 'invite' ? 'Interview invite' : 'Rejection'} email</h3>
              <span className="small muted">
                {c.decision_override ? `Your call (system said ${c.recommended})` : 'System recommendation'}
              </span>
            </div>
            {sent ? (
              <div className="notice ok small">Sent to {c.sent_to} on {new Date(c.sent_at!).toLocaleString()}.</div>
            ) : null}
            {ready || sent ? (
              <>
                <div className="small muted">To: {config.testRecipient || c.personal_details.email || '(no email on file)'}</div>
                <input type="text" value={subject} disabled={sent} onChange={(e) => { setSubject(e.target.value); setDirty(true); }} style={{ margin: '6px 0' }} />
                <textarea value={body} disabled={sent} onChange={(e) => { setBody(e.target.value); setDirty(true); }} />
              </>
            ) : (
              <div className="notice info small">
                {c.draft_error ? `Draft failed: ${c.draft_error}` : 'Writing the draft - it will appear here in a few seconds.'}
              </div>
            )}
            {c.send_error && !sent && <div className="notice err small">Last send attempt failed: {c.send_error}</div>}
            {err && <div className="notice err small">{err}</div>}

            {!sent && (
              <div className="row" style={{ marginTop: 8 }}>
                <button className="primary" disabled={!ready || !!busy || !config.resendConfigured} onClick={send}
                  title={config.resendConfigured ? '' : 'Set RESEND_API_KEY to enable sending'}>
                  {busy === 'send' ? 'Sending…' : c.decision === 'invite' ? 'Send invite' : 'Send rejection'}
                </button>
                {dirty && (
                  <button disabled={!!busy} onClick={() => run('save', async () => { await patch({ action: 'edit_email', subject, body }); setDirty(false); })}>
                    Save edits
                  </button>
                )}
                <button disabled={!!busy} onClick={() => { setDirty(false); run('flip', () => patch({ action: 'override', decision: c.decision === 'invite' ? 'reject' : 'invite' })); }}>
                  {c.decision === 'invite' ? 'Reject instead' : 'Interview instead'}
                </button>
                {c.decision_override && (
                  <button disabled={!!busy} onClick={() => { setDirty(false); run('reset', () => patch({ action: 'override', decision: null })); }}>
                    Use system recommendation
                  </button>
                )}
              </div>
            )}
            {!sent && (
              <div className="row small" style={{ marginTop: 8 }}>
                <button disabled={!!busy} onClick={() => { setDirty(false); run('regen', () => patch({ action: 'regenerate' })); }}>Rewrite draft</button>
                <button disabled={!!busy} onClick={() => confirm(`Move this candidate to the ${ROLE_LABEL[other]} list? Their draft will be rewritten.`) && run('role', () => patch({ action: 'set_role', role: other }))}>
                  Move to {other}
                </button>
                <button disabled={!!busy} onClick={() => run('rescore', () => patch({ action: 'rescore' }))}>Rescore</button>
                <button className="danger" disabled={!!busy} onClick={() => confirm('Delete this candidate and all their data?') && run('delete', () => api(`/api/candidates/${c.id}`, { method: 'DELETE' }))}>
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
