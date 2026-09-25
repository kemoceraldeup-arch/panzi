import { useCallback, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { getChats, getChatTranscript } from '../api';
import type { ChatSummary } from '../api/types';
import { Empty, ErrorState, Loading, Notice, PageHead, Pager, SearchField } from '../components/pz';
import { downloadCsv } from '../lib/csv';
import { useBrowse } from '../lib/useBrowse';
import { useResource } from '../lib/useResource';

/**
 * The list carries no message text: only who, when, and how many turns.
 * Reading a transcript is a separate request, and so a separate line in the
 * audit log naming whose words were read. Nothing opens until someone clicks.
 */
export function Chatbot() {
  const [open, setOpen] = useState<ChatSummary | null>(null);
  const { data, error, loading, reload, updatedAt, query, page, busy, setQuery, setPage } = useBrowse(getChats);
  const rows = data?.conversations ?? [];

  const exportRows = () => downloadCsv('panzi-conversations.csv', ['Title', 'User', 'Messages', 'Questions', 'Recipes', 'Last activity'],
    rows.map((r) => [r.title, r.user, r.messages, r.asked, r.recipes, r.at]));

  return (
    <>
      <PageHead
        title="Conversations"
        text="What people asked the Panzi chatbot. Opening a conversation is recorded in the audit log."
        updatedAt={updatedAt}
        tools={<button className="btn" type="button" onClick={exportRows} disabled={!rows.length}>Export this page</button>}
      />
      {data?.note && <Notice>{data.note}</Notice>}
      <div className="toolbar"><SearchField label="Search conversations" value={query} onChange={setQuery} placeholder="Title or person" /></div>
      {loading && !data && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <section className={`panel inbox${busy ? ' is-busy' : ''}`}>
          <div className="inbox-list">
            {rows.length === 0 ? <Empty title={query ? 'No conversation matches that search' : 'No conversations yet'} /> : (
              <ul className="inbox-items">
                {rows.map((row) => (
                  <li key={row.id}>
                    <button type="button" className="inbox-item" aria-current={row.id === open?.id} onClick={() => setOpen(row)}>
                      <span className="line1"><b>{row.title}</b><span className="when">{row.at}</span></span>
                      <p>{row.user}, {row.messages} messages{row.recipes ? `, ${row.recipes} recipe${row.recipes === 1 ? '' : 's'}` : ''}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Pager page={page} pageSize={data.pagination?.pageSize ?? 25} total={data.pagination?.total ?? rows.length} count={rows.length} busy={busy} onChange={setPage} noun="conversations" />
          </div>
          <div className="inbox-detail">
            {open ? <Transcript key={open.id} summary={open} /> : (
              <Empty title="Select a conversation">The transcript loads only when you open one, and that is recorded in the audit log.</Empty>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function Transcript({ summary }: { summary: ChatSummary }) {
  const { data, error, loading, reload } = useResource(useCallback(() => getChatTranscript(summary.id), [summary.id]), [summary.id]);
  return (
    <>
      <div className="detail-head"><h2>{summary.title}</h2><p>{summary.user}, {summary.at}</p></div>
      <div className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><ShieldCheck className="i" aria-hidden="true" style={{ width: 15, height: 15 }} />You opened this transcript; the access is logged.</div>
      {loading && !data && <Loading label="Loading transcript" />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <div className="chat">
          {data.messages.map((turn) => (
            <div key={turn.id} className={`msg ${turn.role === 'user' ? 'user' : 'bot'}`}>
              {turn.recipeTitle ? <><b>Recipe:</b> {turn.recipeTitle}</> : turn.text}
            </div>
          ))}
          {data.truncated && <p className="hint">Only the most recent messages are shown.</p>}
        </div>
      )}
    </>
  );
}
