import { startOfDay } from 'date-fns';
import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_NAME, PAIR_LABEL, TEAM_NAME } from '../config/app';
import { ChatWindow } from '../chat/ChatWindow';
import { type ConversationState, initialState, step } from '../chat/conversationState';
import { ruleExtract } from '../chat/extractor';
import { LiveBookingPanel } from '../chat/LiveBookingPanel';
import { llmEnabled, llmExtract, mergeLlm } from '../chat/llm';
import { type BatchResult, evaluateFiles } from '../ingest';
import { buildSampleWorkbook, buildTemplateWorkbook } from '../ingest/sampleData';
import { download } from '../util/csv';
import { ResultsTab } from './ResultsTab';
import { ResultView } from './results/ResultView';
import { card, cx } from './styles';
import { UploadTab } from './UploadTab';

type Tab = 'chat' | 'upload' | 'results';
const TABS: Array<[Tab, string]> = [
  ['chat', 'Chat'],
  ['upload', 'Upload'],
  ['results', 'Results'],
];
const headerBtn = 'inline-flex items-center justify-center rounded-lg border border-indigo-300 bg-indigo-900 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export default function AppShell() {
  const [tab, setTab] = useState<Tab>('chat');
  const [chat, setChat] = useState<ConversationState>(() => initialState());
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'booking' | 'checks'>('booking');
  const [batch, setBatch] = useState<BatchResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // show the results panel as soon as the first result exists, and fall back when it is cleared
  useEffect(() => {
    setPanel(chat.result ? 'checks' : 'booking');
  }, [chat.phase === 'results', chat.booking.bookingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(async (text: string) => {
    setBusy(true);
    try {
      const today = startOfDay(new Date());
      const cur = chatRef.current;
      const rule = ruleExtract(text, { booking: cur.booking, awaiting: cur.awaiting, today });
      let ex = rule;
      if (llmEnabled() && !rule.signals.yes && !rule.signals.no && !rule.signals.undo && !rule.signals.startOver) ex = mergeLlm(rule, await llmExtract(text, cur.booking));
      setChat((prev) => step(prev, text, ex, today));
    } catch {
      setChat((prev) => ({ ...prev, messages: [...prev.messages, { id: prev.nextId, role: 'assistant', text: 'Sorry, something went wrong reading that. Please try rephrasing.' }], nextId: prev.nextId + 1 }));
    } finally {
      setBusy(false);
    }
  }, []);

  const runFiles = useCallback(async (files: Array<{ name: string; data: ArrayBuffer }>) => {
    setLoading('Reading and checking your files…');
    setUploadError(null);
    try {
      await new Promise((r) => setTimeout(r, 40)); // let the loading state paint
      const out = evaluateFiles(files, startOfDay(new Date()));
      setBatch(out);
      if (!out.results.length) {
        setUploadError(out.report.errors.join(' ') || 'No bookings were found in the file.');
        setTab('upload');
      } else {
        setSelected(out.results[0].booking.bookingId);
        setTab('results');
      }
    } catch (e) {
      setUploadError(`Something unexpected happened while reading the file${e instanceof Error ? ` (${e.message})` : ''}. Please check it is a .xlsx, .xls or .csv with a header row.`);
      setTab('upload');
    } finally {
      setLoading(null);
    }
  }, []);

  const onFiles = useCallback(
    async (files: File[]) => {
      try {
        await runFiles(await Promise.all(files.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() }))));
      } catch {
        setUploadError('Could not open that file. Make sure it is not password-protected.');
        setLoading(null);
      }
    },
    [runFiles],
  );
  const loadSample = useCallback(() => runFiles([{ name: 'preflight-sample.xlsx', data: buildSampleWorkbook() }]), [runFiles]);
  const downloadTemplate = useCallback(() => download('preflight-template.xlsx', buildTemplateWorkbook(), XLSX_MIME), []);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-3 pb-8 sm:px-4">
      <header className="sticky top-0 z-20 -mx-3 border-b border-indigo-900 bg-indigo-950 px-3 py-2.5 text-white shadow sm:-mx-4 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight" data-testid="team-name">
              {TEAM_NAME} <span className="font-normal text-indigo-200">· {PAIR_LABEL}</span>
            </p>
            <p className="text-xs text-indigo-200">
              <span aria-hidden="true">✈ </span>
              {APP_NAME}: shipment booking and pre-flight checks, UK → Germany, France, Netherlands
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={headerBtn} onClick={loadSample} disabled={!!loading}>
              Load sample data
            </button>
            <button type="button" className={headerBtn} onClick={downloadTemplate}>
              Download template
            </button>
          </div>
        </div>
      </header>

      <nav className="mt-3 flex gap-1 border-b border-slate-300" role="tablist" aria-label="Sections">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => setTab(id)}
            className={cx('-mb-px rounded-t-lg border border-b-0 px-4 py-2 text-sm font-semibold', tab === id ? 'border-slate-300 bg-white text-indigo-900' : 'border-transparent text-slate-600 hover:bg-white/60')}
          >
            {label}
            {id === 'results' && batch?.results.length ? <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 text-xs">{batch.results.length}</span> : null}
          </button>
        ))}
      </nav>

      <main className="mt-4 min-w-0 flex-1">
        {tab === 'chat' && (
          <div role="tabpanel" id="panel-chat" aria-labelledby="tab-chat" className="grid min-w-0 gap-4 lg:grid-cols-2">
            <div className="min-w-0">
              <ChatWindow state={chat} busy={busy} onSend={send} />
            </div>
            <div className="min-w-0 space-y-3">
              {chat.result && (
                <div className="flex gap-2" role="tablist" aria-label="Booking panel">
                  {(['booking', 'checks'] as const).map((p) => (
                    <button key={p} type="button" role="tab" aria-selected={panel === p} onClick={() => setPanel(p)} className={cx('rounded-full border px-3 py-1 text-sm font-medium', panel === p ? 'border-indigo-700 bg-indigo-700 text-white' : 'border-slate-300 bg-white text-slate-700')}>
                      {p === 'booking' ? 'Booking' : 'Checks and carrier'}
                    </button>
                  ))}
                </div>
              )}
              {panel === 'checks' && chat.result ? <ResultView result={chat.result} /> : <LiveBookingPanel state={chat} />}
            </div>
          </div>
        )}
        {tab === 'upload' && (
          <div role="tabpanel" id="panel-upload" aria-labelledby="tab-upload">
            <UploadTab loading={loading} error={uploadError} batch={batch} onFiles={onFiles} onLoadSample={loadSample} onTemplate={downloadTemplate} />
          </div>
        )}
        {tab === 'results' && (
          <div role="tabpanel" id="panel-results" aria-labelledby="tab-results">
            {loading ? (
              <p role="status" className={cx(card, 'p-4 text-sm')}>{loading}</p>
            ) : (
              <ResultsTab batch={batch} selected={selected} onSelect={setSelected} onLoadSample={loadSample} onGoUpload={() => setTab('upload')} />
            )}
          </div>
        )}
      </main>
      <footer className="mt-8 text-center text-xs text-slate-500">
        All rule checks and carrier choices are deterministic code that runs in your browser: no login, no sign-up, nothing is uploaded to a server.
      </footer>
    </div>
  );
}
