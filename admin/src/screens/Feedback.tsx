import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Mail } from 'lucide-react';
import { getFeedback, updateReview } from '../api';
import { ApiError } from '../api/client';
import type { ReviewFeedback, ReviewStatus } from '../api/types';
import { Empty, ErrorState, Loading, Notice, PageHead, Pager, SearchField, Segmented, Status, useToast, type Tone } from '../components/pz';
import { downloadCsv } from '../lib/csv';
import { useBrowse } from '../lib/useBrowse';

// Messages people sent from Help & feedback in the app. The only thing an
// administrator changes here is the console's own bookkeeping — a status and
// an internal note per message — never anything the person sees.

const STATUS_WORD: Record<ReviewStatus, string> = { new: 'New', in_progress: 'In progress', resolved: 'Resolved' };
const STATUS_TONE: Record<ReviewStatus, Tone> = { new: 'warn', in_progress: 'muted', resolved: 'good' };
const statusOf = (row: ReviewFeedback): ReviewStatus => row.review?.status ?? 'new';

export function Feedback() {
  const { data, error, loading, reload, updatedAt, query, filter, page, busy, setQuery, setFilter, setPage, refresh } = useBrowse(getFeedback, 'status', 'open');
  const rows = data?.feedback ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;

  const filters = [
    { value: 'open', label: data ? `Open (${data.open.toLocaleString()})` : 'Open' },
    { value: 'new', label: 'New' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'all', label: 'All' },
  ] as const;

  const exportRows = () => downloadCsv('panzi-feedback.csv', ['Sent', 'Person', 'Email', 'Message', 'Platform', 'App version', 'Status', 'Note'],
    rows.map((r) => [r.sentAt ?? r.at, r.user, r.email ?? '', r.message, r.platform, r.appVersion, STATUS_WORD[statusOf(r)], r.review?.note ?? '']));

  return (
    <>
      <PageHead
        title="Feedback"
        text="What people wrote from Help & feedback in the app. Mark each message as you handle it so nothing is answered twice or missed."
        updatedAt={updatedAt}
        tools={<>
          <button className="btn" type="button" onClick={refresh}>Refresh</button>
          <button className="btn" type="button" onClick={exportRows} disabled={!rows.length}>Export this page</button>
        </>}
      />
      <div className="toolbar">
        <SearchField label="Search feedback" value={query} onChange={setQuery} placeholder="Words in the message, or an email" />
        <Segmented label="Status" options={filters} value={filter as (typeof filters)[number]['value']} onChange={setFilter} />
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <section className={`panel${busy ? ' is-busy' : ''}`}>
          {rows.length === 0 ? (
            <Empty title={query ? `No feedback matches “${query}”` : filter === 'open' ? 'No open feedback' : 'No feedback in this filter'}>
              {query ? 'Try other words, or search the whole email address.' : filter === 'open' ? 'Everything people sent has been handled.' : 'Try another status.'}
            </Empty>
          ) : (
            <div className="inbox">
              <div className="inbox-list">
                <ul className="inbox-items" aria-label="Feedback messages">
                  {rows.map((row) => (
                    <li key={row.id}>
                      <button type="button" className="inbox-item" aria-current={row.id === selected?.id} onClick={() => setSelectedId(row.id)}>
                        <span className="line1"><b>{row.user}</b><span className="when">{row.at}</span></span>
                        <p>{row.message}</p>
                        <span><Status tone={STATUS_TONE[statusOf(row)]}>{STATUS_WORD[statusOf(row)]}</Status></span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              {selected && <FeedbackDetail key={`${selected.id}-${selected.review?.revision ?? 0}`} row={selected} onSaved={reload} />}
            </div>
          )}
          <Pager page={page} pageSize={data.pagination.pageSize} total={data.pagination.total} count={rows.length} busy={busy} onChange={setPage} noun="messages" />
        </section>
      )}
    </>
  );
}

function FeedbackDetail({ row, onSaved }: { row: ReviewFeedback; onSaved: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<ReviewStatus>(statusOf(row));
  const [note, setNote] = useState(row.review?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const changed = status !== statusOf(row) || note.trim() !== (row.review?.note ?? '');

  useEffect(() => { setProblem(null); }, [status, note]);

  async function save() {
    setSaving(true);
    try {
      await updateReview('feedback', row.id, { status, note, revision: row.review?.revision ?? 0 });
      toast(status === 'resolved' ? 'Marked as resolved' : 'Saved');
      onSaved();
    } catch (err) {
      // Another administrator saved first. Reloading shows their note rather
      // than letting this one overwrite it.
      if (err instanceof ApiError && err.code === 'review-conflict') { setProblem(err.message); onSaved(); }
      else setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="inbox-detail">
      <div className="detail-head">
        <h2>{row.user}</h2>
        <p title={row.sentAt}>{row.at} · {row.platform} · app {row.appVersion}</p>
      </div>
      <blockquote className="quote" style={{ whiteSpace: 'pre-wrap' }}>{row.message}</blockquote>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {row.email
          ? <a className="btn" href={`mailto:${row.email}?subject=${encodeURIComponent('About your Panzi feedback')}`}><Mail className="i" aria-hidden="true" />Reply to {row.email}</a>
          : <span className="hint">No email on this account, so there is no way to reply.</span>}
        <Link className="btn" to={`/users?user=${encodeURIComponent(row.userId)}`}>Open their profile <ArrowUpRight className="i" aria-hidden="true" /></Link>
      </div>
      <div className="field">
        <span className="label" id="feedback-status">Status</span>
        <div className="radio-row" role="radiogroup" aria-labelledby="feedback-status">
          {(Object.keys(STATUS_WORD) as ReviewStatus[]).map((value) => (
            <label key={value}><input type="radio" name="feedback-status" value={value} checked={status === value} onChange={() => setStatus(value)} />{STATUS_WORD[value]}</label>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="feedback-note">Internal note</label>
        <textarea id="feedback-note" value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} placeholder="What was done, or who is looking into it. Only administrators see this." />
      </div>
      {problem && <Notice tone="warn">{problem}</Notice>}
      <div className="detail-actions">
        <span className="hint">{row.review?.updatedAt ? `Last updated ${new Date(row.review.updatedAt).toLocaleString()}` : 'Not handled yet'}</span>
        <button className="btn primary" type="button" onClick={() => void save()} disabled={saving || !changed}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}
