'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { runPipeline, type PipelineProgress } from '@/lib/client/pipeline';
import { personalise } from '@/lib/ranking';

type Role = 'PM' | 'SPM';
type Decision = 'invite' | 'reject';
type Score = { criterion_id: string; role: Role; score: number; reason: string; name: string; weight: number };
type Candidate = {
  id: string;
  file_name: string | null;
  applied_role: Role;
  personal_details: { name?: string; email?: string; phone?: string };
  status: 'new' | 'scored' | 'error';
  last_error: string | null;
  headline: string | null;
  pm_score: number | null;
  spm_score: number | null;
  brief: string | null;
  draft_decision: Decision | null;
  email_subject: string | null;
  email_body: string | null;
  email_status: 'none' | 'sending' | 'sent' | 'failed';
  sent_at: string | null;
  sent_to: string | null;
  send_error: string | null;
  rank: number | null;
  decision: Decision | null;
  scores: Score[];
};
type Data = {
  config: { topN: number; inviteThreshold: number; resendConfigured: boolean };
  status: PipelineProgress['status'];
  candidates: Candidate[];
};

const ROLE_LABEL: Record<Role, string> = { PM: 'Product Manager', SPM: 'Senior Product Manager' };
const scoreFor = (c: Candidate, r: Role) => (r === 'PM' ? c.pm_score : c.spm_score);
const draftReady = (c: Candidate) => Boolean(c.email_body) && c.draft_decision === c.decision;

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Role>('PM');
  const [open, setOpen] = useState<string | null>(null);
  const [pipe, setPipe] = useState<PipelineProgress | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

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
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    let last = 0;
    await runPipeline((p) => {
      setPipe(p);
      if (Date.now() - last > 4000) {
        last = Date.now();
        load();
      }
    });
    runningRef.current = false;
    setRunning(false);
    await load();
  }, [load]);

  // Finish any pending scoring / drafting automatically when the dashboard opens.
  useEffect(() => {
    load().then((d) => {
      if (d && d.status.scoring + d.status.drafts > 0) drive();
    });
  }, [load, drive]);

  if (loadError) return <div className="notice err">Could not load candidates: {loadError}</div>;
  if (!data) return <p className="muted">Loading…</p>;

  const { config } = data;
  const inRole = data.candidates.filter((c) => c.applied_role === tab);
  const scored = inRole.filter((c) => c.status === 'scored').sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  const invites = scored.filter((c) => c.decision === 'invite');
  const rejects = scored.filter((c) => c.decision === 'reject');
  const pending = inRole.filter((c) => c.status !== 'scored');
  const sent = inRole.filter((c) => c.email_status === 'sent').length;
  const status = pipe?.status ?? data.status;
  const left = status.scoring + status.drafts;

  const card = (c: Candidate) => (
    <CandidateCard key={c.id} c={c} role={tab} config={config} open={open === c.id}
      toggle={() => setOpen(open === c.id ? null : c.id)} reload={load} />
  );

  return (
    <>
      <div className="spread" style={{ marginBottom: 18 }}>
        <div>
          <h1>Candidates</h1>
          <div className="muted">
            Ranked by rubric score. Top {config.topN} per role scoring {config.inviteThreshold}+ are recommended for interview.
            Nothing is sent until you click send.
          </div>
        </div>
        <Link className="btn" href="/">+ Upload CVs</Link>
      </div>

      {!config.resendConfigured && <div className="notice warn">Email sending is not set up yet (RESEND_API_KEY is missing).</div>}
      {left > 0 && (
        <div className={`notice ${pipe?.notice === 'quota' ? 'warn' : 'info'}`}>
          {running && <span className="spinner" />}
          <div style={{ flex: 1 }}>
            {pipe?.notice === 'quota'
              ? 'The free Gemini quota for today is used up. Remaining CVs will be processed when you come back later.'
              : pipe?.notice === 'busy'
                ? `Google's AI service is busy - retrying automatically. ${status.scoring} CV(s) to score, ${status.drafts} email(s) to write.`
                : running
                  ? `Processing: ${status.scoring} CV(s) to score, ${status.drafts} brief(s) and email(s) to write.`
                  : `${status.scoring} CV(s) to score, ${status.drafts} email(s) to write.`}
          </div>
          {!running && <button onClick={drive}>Resume</button>}
        </div>
      )}

      <div className="tabs">
        {(['PM', 'SPM'] as Role[]).map((r) => (
          <button key={r} className={tab === r ? 'on' : ''} onClick={() => { setTab(r); setOpen(null); }}>
            {ROLE_LABEL[r]}<span className="count">{data.candidates.filter((c) => c.applied_role === r).length}</span>
          </button>
        ))}
      </div>

      <div className="stats">
        <div className="stat"><div className="v">{inRole.length}</div><div className="l">Applicants</div></div>
        <div className="stat"><div className="v" style={{ color: 'var(--green)' }}>{invites.length}</div><div className="l">Recommended for interview</div></div>
        <div className="stat"><div className="v">{rejects.length}</div><div className="l">Not moving forward</div></div>
        <div className="stat"><div className="v" style={{ color: 'var(--blue)' }}>{sent}</div><div className="l">Emails sent</div></div>
      </div>

      {inRole.length === 0 && (
        <div className="card empty">No {ROLE_LABEL[tab]} candidates yet. <Link href="/">Upload CVs</Link> to get started.</div>
      )}

      {invites.length > 0 && <div className="line">Recommended for interview</div>}
      {invites.map(card)}
      {rejects.length > 0 && <div className="line">Not moving forward</div>}
      {rejects.map(card)}

      {pending.length > 0 && <div className="line">Being processed</div>}
      {pending.map((c) => (
        <div key={c.id} className="cand">
          <div className="cand-head" style={{ cursor: 'default' }}>
            <div className="rank">–</div>
            <div>
              <div className="name">{c.personal_details.name || c.file_name}</div>
              <div className="headline">{c.file_name}</div>
            </div>
            <div />
            <div className="status-col">
              {c.status === 'error' ? <span className="pill red">Could not be scored</span> : <span className="pill amber">Scoring…</span>}
            </div>
            <div />
          </div>
          {c.status === 'error' && (
            <div className="spread" style={{ padding: '0 16px 14px' }}>
              <span className="small muted">{c.last_error}</span>
              <button onClick={async () => { await api(`/api/candidates/${c.id}`, { method: 'POST' }); await load(); drive(); }}>Retry</button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function ScoreTable({ rows }: { rows: Score[] }) {
  return (
    <table className="crit">
      <tbody>
        {rows.map((s) => (
          <tr key={s.criterion_id}>
            <td style={{ width: '38%' }}>
              <div style={{ fontWeight: 600 }}>{s.name}</div>
              <div className="small muted">{s.weight}% weight</div>
            </td>
            <td style={{ width: 88, whiteSpace: 'nowrap' }}>
              <span className="dots">{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= s.score ? 'on' : ''} />)}</span>
              <div className="small muted">{s.score}/5</div>
            </td>
            <td className="small">{s.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CandidateCard({ c, role, config, open, toggle, reload }: {
  c: Candidate; role: Role; config: Data['config']; open: boolean; toggle: () => void; reload: () => Promise<unknown>;
}) {
  const other: Role = role === 'PM' ? 'SPM' : 'PM';
  const name = c.personal_details.name;
  const score = scoreFor(c, role) ?? 0;
  const otherScore = scoreFor(c, other) ?? 0;
  const isSent = c.email_status === 'sent';
  const ready = draftReady(c);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    const to = c.personal_details.email;
    if (!to) return setErr('No email address was found on this CV.');
    if (!confirm(`Send this ${c.decision === 'invite' ? 'interview invite' : 'rejection'} to ${to}?`)) return;
    setSending(true);
    setErr(null);
    try {
      await api(`/api/candidates/${c.id}/send`, { method: 'POST' });
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const barClass = score >= config.inviteThreshold ? 'good' : score < 40 ? 'low' : '';

  return (
    <div className={`cand ${open ? 'open' : ''}`}>
      <div className="cand-head" onClick={toggle}>
        <div className="rank">#{c.rank}</div>
        <div style={{ minWidth: 0 }}>
          <div className="name">{name || <span className="muted">Name not found</span>}</div>
          <div className="headline">{c.headline}</div>
        </div>
        <div className="scorebox">
          <span className="big">{score}</span><span className="of"> / 100</span>
          <div className={`bar ${barClass}`}><span style={{ width: `${score}%` }} /></div>
          <div className="other">{other} score: {otherScore}</div>
        </div>
        <div className="status-col">
          <span className={`pill ${c.decision === 'invite' ? 'green' : 'grey'}`}>{c.decision === 'invite' ? 'Interview' : 'Reject'}</span>
          {isSent ? <span className="pill blue">✓ Email sent</span> : !ready ? <span className="pill amber">Drafting…</span> : null}
        </div>
        <div className="chev">›</div>
      </div>

      {open && (
        <div className="cand-body">
          <div>
            {c.brief && (
              <>
                <h3>Interview brief</h3>
                <div className="brief">{c.brief}</div>
              </>
            )}
            <h3>{ROLE_LABEL[role]} rubric · {score}/100</h3>
            <ScoreTable rows={c.scores.filter((s) => s.role === role)} />
            <details style={{ marginTop: 14 }}>
              <summary className="small" style={{ cursor: 'pointer', color: 'var(--muted)', fontWeight: 600 }}>
                {ROLE_LABEL[other]} rubric · {otherScore}/100
              </summary>
              <div style={{ marginTop: 8 }}><ScoreTable rows={c.scores.filter((s) => s.role === other)} /></div>
            </details>
          </div>

          <div>
            <h3>{c.decision === 'invite' ? 'Interview invite' : 'Rejection email'}</h3>
            {ready || isSent ? (
              <div className="email">
                <div className="hdr">
                  <div><span className="muted">To:</span> {c.sent_to || c.personal_details.email || <span style={{ color: 'var(--red)' }}>no email on CV</span>}</div>
                  <div><span className="muted">Subject:</span> <strong>{personalise(c.email_subject || '', name)}</strong></div>
                </div>
                <div className="body">{personalise(c.email_body || '', name)}</div>
              </div>
            ) : (
              <div className="notice info" style={{ margin: 0 }}><span className="spinner" /> Writing the email…</div>
            )}

            <div style={{ marginTop: 14 }}>
              {isSent ? (
                <div className="notice ok" style={{ margin: 0 }}>✓ Sent to {c.sent_to} on {new Date(c.sent_at!).toLocaleString()}</div>
              ) : (
                <button className="primary" disabled={!ready || sending || !config.resendConfigured} onClick={send}>
                  {sending ? 'Sending…' : c.decision === 'invite' ? 'Confirm & send invite' : 'Confirm & send rejection'}
                </button>
              )}
            </div>
            {(err || (c.send_error && !isSent)) && (
              <div className="notice err small" style={{ marginTop: 12, marginBottom: 0 }}>{err || c.send_error}</div>
            )}
            <div className="contact">
              {[c.personal_details.email, c.personal_details.phone].filter(Boolean).join(' · ')}
              {c.file_name ? ` · ${c.file_name}` : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
