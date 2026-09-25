import { getLogs, SAMPLE_MODE, SAMPLE_ONLY } from '../api';
import type { LogLevel } from '../api/types';
import { Empty, ErrorState, Loading, Notice, PageHead, Pager, SearchField, Segmented, Status, type Tone } from '../components/pz';
import { downloadCsv } from '../lib/csv';
import { useBrowse } from '../lib/useBrowse';

const LEVELS = [{ value: 'All', label: 'All levels' }, { value: 'WARN', label: 'Warnings' }, { value: 'ERROR', label: 'Errors' }] as const;
const TONE: Record<LogLevel, Tone> = { INFO: 'muted', DEBUG: 'muted', WARN: 'warn', ERROR: 'bad' };
const WORD: Record<LogLevel, string> = { INFO: 'Info', DEBUG: 'Debug', WARN: 'Warning', ERROR: 'Error' };

export function Logs() {
  const { data, error, loading, reload, updatedAt, query, filter, page, busy, setQuery, setFilter, setPage, refresh } = useBrowse(getLogs, 'level');
  const rows = data?.logs ?? [];
  const exportRows = () => downloadCsv('panzi-logs.csv', ['Time', 'Level', 'Event', 'Details'], rows.map((r) => [r.time, r.level, r.event, r.detail]));
  const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }); };

  return (
    <>
      <PageHead
        title="System logs"
        text="Model calls, admin actions, and account deletions, newest first."
        updatedAt={updatedAt}
        tools={<>
          <button className="btn" type="button" onClick={refresh}>Refresh</button>
          <button className="btn" type="button" onClick={exportRows} disabled={!rows.length}>Export this page</button>
        </>}
      />
      {SAMPLE_MODE && <Notice>{SAMPLE_ONLY.logs}</Notice>}
      {data?.note && <Notice>{data.note}</Notice>}
      <div className="toolbar">
        <SearchField label="Search logs" value={query} onChange={setQuery} placeholder="Event or detail" />
        <Segmented label="Level" options={LEVELS} value={filter as (typeof LEVELS)[number]['value']} onChange={setFilter} />
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <section className={`panel${busy ? ' is-busy' : ''}`}>
          {rows.length === 0 ? <Empty title="No events match" /> : (
            <div className="table-wrap" role="region" aria-label="Log entries" tabIndex={0}>
              <table>
                <thead><tr><th>Time</th><th>Level</th><th>Event</th><th>Details</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{when(r.time)}</td>
                    <td><Status tone={TONE[r.level]}>{WORD[r.level]}</Status></td>
                    <td><code>{r.event}</code></td>
                    <td className="log-detail">{r.detail}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <Pager page={page} pageSize={data.pagination?.pageSize ?? 25} total={data.pagination?.total ?? rows.length} count={rows.length} busy={busy} onChange={setPage} noun="events" />
        </section>
      )}
    </>
  );
}
