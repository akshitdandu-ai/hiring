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
import { PortalHero } from './landing/PortalHero';
import { ChecksRoster, FeatureDeck, GrandFinale, RatesTable, Statement } from './landing/Sections';
import { UploadTab } from './UploadTab';

type Tab = 'chat' | 'upload' | 'results';
const TABS: Array<[Tab, string]> = [
  ['chat', 'Chat'],
  ['upload', 'Upload'],
  ['results', 'Results'],
];
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

  const goToApp = useCallback((smooth = true) => document.getElementById('app')?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }), []);
  const startChat = useCallback(() => {
    setTab('chat');
    goToApp();
  }, [goToApp]);
  const trySample = useCallback(async () => {
    goToApp();
    await loadSample();
  }, [goToApp, loadSample]);
  const tryText = useCallback(
    (text: string) => {
      setTab('chat');
      goToApp();
      void send(text);
    },
    [goToApp, send],
  );
  // a link ending in #app opens straight on the tool
  useEffect(() => {
    if (window.location.hash === '#app') goToApp(false);
  }, [goToApp]);

  return (
    <div className="min-h-screen bg-ground text-ink">
      <header className="fixed inset-x-0 top-0 z-50 flex h-[58px] items-center justify-between gap-4 border-b hairline bg-ground/80 px-4 backdrop-blur-md sm:px-6">
        <a href="#top" className="min-w-0 shrink-0 leading-none" aria-label={`${TEAM_NAME}, back to the top`}>
          <span className="font-display text-base font-extrabold tracking-[-0.03em] sm:text-lg" data-testid="team-name">
            {TEAM_NAME}
            {PAIR_LABEL ? <span className="font-normal text-ink/60"> · {PAIR_LABEL}</span> : null}
          </span>
          <span className="label ml-3 hidden text-ink/50 md:inline">
            <span aria-hidden="true">✈ </span>
            {APP_NAME}
          </span>
        </a>
        <nav aria-label="Page" className="flex min-w-0 items-center gap-5 overflow-x-auto [scrollbar-width:none] sm:gap-7">
          <a className="nav-link" href="#app">Tool</a>
          <a className="nav-link hidden sm:inline" href="#checks">Checks</a>
          <a className="nav-link hidden sm:inline" href="#rates">Rates</a>
          <button type="button" className="nav-link" onClick={() => void trySample()} disabled={!!loading}>
            Load sample data
          </button>
          <button type="button" className="nav-link" onClick={downloadTemplate}>
            Download template
          </button>
        </nav>
      </header>

      <PortalHero onStart={startChat} onSample={() => void trySample()} onSkip={() => goToApp()} />

      <main>
        <section id="app" aria-labelledby="app-title" className="scroll-mt-[58px] bg-ground">
          <div className="mx-auto flex w-full max-w-7xl flex-col px-3 pb-20 pt-24 sm:px-4">
            <p className="label text-tealLight">The tool</p>
            <h2 id="app-title" className="mt-3 font-display text-3xl leading-[1.05] sm:text-5xl">Book it. Check it. Before it leaves.</h2>
            <p className="mt-3 max-w-2xl text-sm text-ink/65">{APP_NAME}: shipment booking and pre-flight checks, UK → Germany, France, Netherlands.</p>

            <nav className="mt-8 flex gap-6 border-b hairline" role="tablist" aria-label="Sections">
              {TABS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls={`panel-${id}`}
                  onClick={() => setTab(id)}
                  className={cx('label -mb-px border-b-2 px-1 py-3 transition-colors duration-300', tab === id ? 'border-amber text-amber' : 'border-transparent text-ink/65 hover:text-ink')}
                >
                  {label}
                  {id === 'results' && batch?.results.length ? <span className="ml-2 rounded-full bg-slate-200 px-1.5 text-[10px]">{batch.results.length}</span> : null}
                </button>
              ))}
            </nav>

            <div className="mt-6 min-w-0 flex-1">
              {tab === 'chat' && (
                <div role="tabpanel" id="panel-chat" aria-labelledby="tab-chat" className="grid min-w-0 gap-4 lg:grid-cols-2">
                  <div className="min-w-0">
                    <ChatWindow state={chat} busy={busy} onSend={send} />
                  </div>
                  <div className="min-w-0 space-y-3">
                    {chat.result && (
                      <div className="flex gap-2" role="tablist" aria-label="Booking panel">
                        {(['booking', 'checks'] as const).map((p) => (
                          <button key={p} type="button" role="tab" aria-selected={panel === p} onClick={() => setPanel(p)} className={cx('rounded-full border px-3 py-1 text-sm font-medium transition-colors duration-300', panel === p ? 'border-amber bg-amber text-ground' : 'border-hairline bg-transparent text-ink/80 hover:border-amber')}>
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
            </div>
          </div>
        </section>

        <Statement />
        <FeatureDeck onTry={tryText} onStartChat={startChat} onSample={() => void trySample()} />
        <ChecksRoster />
        <RatesTable />
      </main>

      <GrandFinale onSubmit={tryText} onSample={() => void trySample()} onTemplate={downloadTemplate} />
    </div>
  );
}
