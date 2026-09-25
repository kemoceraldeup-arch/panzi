import { useCallback, useEffect, useId, useState } from 'react';
import { Check } from 'lucide-react';
import { getReview, SAMPLE_MODE, updateReview } from '../api';
import { ApiError } from '../api/client';
import type { ReviewFeedback, ReviewScan, ReviewState, ReviewStatus } from '../api/types';
import { Empty, ErrorState, Loading, Notice, PageHead, Segmented, useToast } from '../components/pz';
import { downloadCsv } from '../lib/csv';
import { useResource } from '../lib/useResource';

type Kind = 'scans' | 'feedback';
type Item = { kind: 'scans'; row: ReviewScan } | { kind: 'feedback'; row: ReviewFeedback };
const STATUSES: ReviewStatus[] = ['new', 'in_progress', 'resolved'];
const LABEL: Record<ReviewStatus, string> = { new: 'New', in_progress: 'In progress', resolved: 'Resolved' };
const EMPTY: ReviewState = { status: 'new', note: '', revision: 0, updatedAt: null, updatedBy: null };
const FILTERS = [{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }, { value: 'all', label: 'All' }] as const;
type Filter = (typeof FILTERS)[number]['value'];

export function Review() {
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('open');
  const [kind, setKind] = useState<Kind>('scans');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error, loading, reload, updatedAt } = useResource(useCallback(() => getReview(filter, page), [filter, page]), [filter, page]);

  const items: Item[] = data ? (kind === 'scans' ? data.scans.map((row) => ({ kind: 'scans' as const, row })) : data.feedback.map((row) => ({ kind: 'feedback' as const, row }))) : [];
  const current = items.find((item) => item.row.id === selected) ?? items[0];
  const total = data?.pagination?.[kind] ?? items.length;
  const pageSize = data?.pagination?.pageSize ?? 20;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  // J and K move through the list; the decision form owns 1, 2 and 3.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      if (event.key !== 'j' && event.key !== 'k') return;
      const index = items.findIndex((item) => item.row.id === current?.row.id);
      const next = items[index + (event.key === 'j' ? 1 : -1)];
      if (next) { event.preventDefault(); setSelected(next.row.id); document.querySelector<HTMLElement>(`[data-report="${next.row.id}"]`)?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const exportRows = () => data && (kind === 'scans'
    ? downloadCsv('panzi-scan-issues.csv', ['When', 'User', 'Scene', 'Items', 'Unresolved', 'Added', 'Undated', 'Unsure', 'Status', 'Team note'],
        data.scans.map((s) => [s.at, s.user, s.scene, s.items, s.unresolved, s.added, s.undated.join('; '), s.unsure.map((u) => u.name).join('; '), LABEL[s.review?.status ?? 'new'], s.review?.note ?? '']))
    : downloadCsv('panzi-feedback.csv', ['When', 'User', 'Email', 'Platform', 'App version', 'Message', 'Status', 'Team note'],
        data.feedback.map((f) => [f.at, f.user, f.email ?? '', f.platform, f.appVersion, f.message, LABEL[f.review?.status ?? 'new'], f.review?.note ?? ''])));

  return (
    <>
      <PageHead
        title="Needs review"
        text="Scan problems and feedback people sent. A decision records what the team did about it; it never changes the person’s scan or pantry."
        updatedAt={updatedAt}
        tools={<>
          <button className="btn" type="button" onClick={reload}>Refresh</button>
          <button className="btn" type="button" onClick={exportRows} disabled={!items.length}>Export this page</button>
        </>}
      />
      {data?.note && <Notice>{data.note}</Notice>}
      {loading && !data && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <>
          <section className={`panel inbox${loading ? ' is-busy' : ''}`}>
            <div className="inbox-list">
              <div className="inbox-filters">
                <Segmented label="Status" options={FILTERS} value={filter} onChange={(v) => { setFilter(v); setPage(1); setSelected(null); }} />
                <Segmented label="Type" options={[
                  { value: 'scans', label: `Scan issues ${data.pagination?.scans ?? data.scans.length}` },
                  { value: 'feedback', label: `Feedback ${data.pagination?.feedback ?? data.feedback.length}` },
                ] as const} value={kind} onChange={(v) => { setKind(v); setPage(1); setSelected(null); }} />
              </div>
              {items.length === 0 ? (
                <Empty title={filter === 'open' ? 'Nothing waiting' : 'Nothing here'}>
                  {kind === 'scans' ? 'A scan lands here when an item comes back with no date, or with a name the scanner wasn’t sure of.' : 'Feedback sent from the app’s help screen lands here.'}
                </Empty>
              ) : (
                <ul className="inbox-items">
                  {items.map((item) => {
                    const status = item.row.review?.status ?? 'new';
                    const title = item.kind === 'scans' ? `${item.row.scene}: ${item.row.unresolved} unresolved` : item.row.message;
                    return (
                      <li key={item.row.id}>
                        <button type="button" className="inbox-item" data-report={item.row.id} aria-current={item.row.id === current?.row.id} onClick={() => setSelected(item.row.id)}>
                          <span className="line1">{status === 'new' && <span className="unread-dot" aria-label="New" />}<b>{title}</b><span className="when">{item.row.at}</span></span>
                          <p>{item.row.user}{status === 'in_progress' ? ', in progress' : status === 'resolved' ? ', resolved' : ''}</p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {pages > 1 && (
                <div className="pager">
                  <span>Page {page} of {pages}</span>
                  <span style={{ display: 'flex', gap: 8 }}>
                    <button className="btn small" type="button" disabled={loading || page <= 1} onClick={() => { setPage(page - 1); setSelected(null); }}>Previous</button>
                    <button className="btn small" type="button" disabled={loading || page >= pages} onClick={() => { setPage(page + 1); setSelected(null); }}>Next</button>
                  </span>
                </div>
              )}
            </div>
            <div className="inbox-detail">
              {current ? (
                <>
                  {current.kind === 'scans' ? <ScanDetail scan={current.row} /> : <FeedbackDetail row={current.row} />}
                  <Decision key={`${current.kind}:${current.row.id}`} kind={current.kind} id={current.row.id} review={current.row.review ?? EMPTY}
                    onSaved={(status) => { toast(status === (current.row.review?.status ?? 'new') ? 'Decision saved' : `Moved to ${LABEL[status].toLowerCase()}`); reload(); }}
                    onReload={reload} />
                </>
              ) : <Empty title="Select a report">Pick one from the list to see the details.</Empty>}
            </div>
          </section>
          <p className="hint" style={{ marginTop: 10 }}>Keyboard: <kbd>J</kbd> and <kbd>K</kbd> move through the list, <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> set the status.</p>
        </>
      )}
    </>
  );
}

function ScanDetail({ scan }: { scan: ReviewScan }) {
  return (
    <>
      <div className="detail-head"><h2>{scan.scene}</h2><p>Scan by {scan.user}, {scan.at}</p></div>
      <dl className="kv"><dt>Items read</dt><dd>{scan.items}</dd><dt>Kept in pantry</dt><dd>{scan.added}</dd><dt>Still unresolved</dt><dd>{scan.unresolved}</dd></dl>
      {scan.undated.length > 0 && (
        <div className="detail-section"><h3>No expiry date found</h3><div className="pill-row">{scan.undated.map((name, i) => <span className="pill" key={`${name}-${i}`}>{name}</span>)}</div></div>
      )}
      {scan.unsure.length > 0 && (
        <div className="detail-section"><h3>Names the scanner wasn’t sure of</h3>
          {scan.unsure.map((item, i) => (
            <div className="unsure" key={`${item.name}-${i}`}>
              <b>{item.name}</b>
              {item.reason && <span className="hint">{item.reason}</span>}
              {item.alternatives.length > 0 && <div className="pill-row">{item.alternatives.map((alt) => <span className="pill" key={alt}>{alt}</span>)}</div>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function FeedbackDetail({ row }: { row: ReviewFeedback }) {
  return (
    <>
      <div className="detail-head"><h2>Feedback from {row.user}</h2><p>{row.at}, {row.platform || 'unknown platform'}{row.appVersion ? `, app ${row.appVersion}` : ''}</p></div>
      <p className="quote" style={{ whiteSpace: 'pre-wrap' }}>{row.message}</p>
      <dl className="kv"><dt>Reply to</dt><dd>{row.email ? <a className="link" href={`mailto:${row.email}`}>{row.email}</a> : 'No email on this account'}</dd></dl>
    </>
  );
}

function Decision({ kind, id, review, onSaved, onReload }: {
  kind: Kind; id: string; review: ReviewState; onSaved: (status: ReviewStatus) => void; onReload: () => void;
}) {
  const fieldId = useId();
  const [status, setStatus] = useState<ReviewStatus>(review.status);
  const [note, setNote] = useState(review.note);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const dirty = status !== review.status || note !== review.note;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test(target.tagName) && target.getAttribute('type') !== 'radio') return;
      const index = ['1', '2', '3'].indexOf(event.key);
      if (index >= 0 && !SAMPLE_MODE) setStatus(STATUSES[index]);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  async function save() {
    setPending(true); setError(''); setConflict(false);
    try {
      await updateReview(kind, id, { status, note, revision: review.revision });
      onSaved(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save this decision. Try again.');
      setConflict(err instanceof ApiError && err.code === 'review-conflict');
    } finally { setPending(false); }
  }

  const noteChange = note === review.note ? 'No change' : note.trim() ? 'Updated' : 'Cleared';
  return (
    <form className="field" style={{ gap: 18 }} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ padding: 0, marginBottom: 6, fontWeight: 600, fontSize: 13.5 }}>Status</legend>
        <div className="radio-row">
          {STATUSES.map((s, i) => (
            <label key={s}><input type="radio" name={`${fieldId}-status`} value={s} checked={status === s} disabled={pending || SAMPLE_MODE} onChange={() => setStatus(s)} />{LABEL[s]}<kbd>{i + 1}</kbd></label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor={`${fieldId}-note`}>Team note</label>
        <textarea id={`${fieldId}-note`} value={note} maxLength={2000} disabled={pending || SAMPLE_MODE} placeholder="What you checked, and what happens next" onChange={(e) => setNote(e.target.value)} />
        <span className="hint">Only admins see this note. Up to 2,000 characters.</span>
      </div>
      <div className="changes" aria-live="polite">
        <h3>What saving changes</h3>
        <div><span className="k">Status</span><span>{status === review.status ? 'No change' : <>{LABEL[review.status]} to <b>{LABEL[status].toLowerCase()}</b></>}</span></div>
        <div><span className="k">Team note</span><span>{noteChange}</span></div>
        <div><span className="k">Their scan and pantry</span><span className="same">Never changed by a review</span></div>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {conflict && (
        <button type="button" className="btn" onClick={() => { if (window.confirm('Discard your changes and load the latest decision?')) { setStatus(review.status); setNote(review.note); setError(''); setConflict(false); onReload(); } }}>
          Load the latest decision
        </button>
      )}
      <div className="detail-actions">
        <span className="hint">{SAMPLE_MODE ? 'Saving needs the server; sample data is read-only.' : review.updatedAt ? `Last saved ${new Date(review.updatedAt).toLocaleString()}` : 'No decision yet'}</span>
        <button className="btn primary" type="submit" disabled={pending || !dirty || SAMPLE_MODE}><Check className="i" aria-hidden="true" />{pending ? 'Saving…' : 'Save decision'}</button>
      </div>
    </form>
  );
}
