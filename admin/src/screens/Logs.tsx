import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Sparkles, UserX } from 'lucide-react';
import { getLogs, SAMPLE_MODE, SAMPLE_ONLY } from '../api';
import type { LogEntry, LogKind, LogLevel } from '../api/types';
import { Empty, ErrorState, Loading, Notice, PageHead, Pager, SearchField, Segmented, Status, type Tone } from '../components/pz';
import { downloadCsv } from '../lib/csv';
import { useBrowse } from '../lib/useBrowse';

const KINDS = [
  { value: 'all', label: 'Everything' },
  { value: 'ai', label: 'AI requests' },
  { value: 'admin', label: 'Admin activity' },
  { value: 'account', label: 'Deleted accounts' },
] as const;
const LEVELS = [{ value: 'All', label: 'Any outcome' }, { value: 'WARN', label: 'Warnings' }, { value: 'ERROR', label: 'Errors' }] as const;
const TONE: Record<LogLevel, Tone> = { INFO: 'good', DEBUG: 'muted', WARN: 'warn', ERROR: 'bad' };
const WORD: Record<LogLevel, string> = { INFO: 'OK', DEBUG: 'Debug', WARN: 'Warning', ERROR: 'Error' };
const KIND_ICON: Record<LogKind, typeof Sparkles> = { ai: Sparkles, admin: ShieldCheck, account: UserX };
const KIND_WORD: Record<LogKind, string> = { ai: 'AI request', admin: 'Admin activity', account: 'Deleted account' };

/** "Today, 9:37 AM" / "Yesterday, 9:37 AM" / "Sep 28, 9:37 AM". */
function when(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

/**
 * Folds identical back-to-back rows — same person, same action, same outcome,
 * within a minute — into one. Opening a page, refreshing it, or the dev
 * server's double render would otherwise print the same line several times
 * running. Only what is drawn is folded; the export keeps every record.
 */
function fold(rows: LogEntry[]) {
  const out: { row: LogEntry; count: number; oldest: string }[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.row.title === row.title && last.row.who === row.who && last.row.level === row.level &&
        Math.abs(new Date(last.oldest).getTime() - new Date(row.time).getTime()) < 60000) {
      last.count += 1;
      last.oldest = row.time;
    } else {
      out.push({ row, count: 1, oldest: row.time });
    }
  }
  return out;
}

export function Logs() {
  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>('all');
  const { data, error, loading, reload, updatedAt, query, filter, page, busy, setQuery, setFilter, setPage, refresh } = useBrowse(getLogs, 'level', 'All', { kind });
  const rows = data?.logs ?? [];
  const exportRows = () => downloadCsv('panzi-logs.csv', ['Time', 'Outcome', 'Type', 'What happened', 'Who', 'Details', 'Event'],
    rows.map((r) => [r.time, WORD[r.level], KIND_WORD[r.kind], r.title, r.who, r.detail, r.event]));

  return (
    <>
      <PageHead
        title="System logs"
        text="What happened, newest first: AI requests people made from the app, what administrators opened or changed here, and accounts that were deleted."
        updatedAt={updatedAt}
        tools={<>
          <button className="btn" type="button" onClick={refresh}>Refresh</button>
          <button className="btn" type="button" onClick={exportRows} disabled={!rows.length}>Export this page</button>
        </>}
      />
      {SAMPLE_MODE && <Notice>{SAMPLE_ONLY.logs}</Notice>}
      <div className="toolbar">
        <SearchField label="Search logs" value={query} onChange={setQuery} placeholder="A person, page or feature" />
        <Segmented label="Type" options={KINDS} value={kind} onChange={setKind} />
        <Segmented label="Outcome" options={LEVELS} value={filter as (typeof LEVELS)[number]['value']} onChange={setFilter} />
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <section className={`panel${busy ? ' is-busy' : ''}`}>
          <div className="table-heading"><h2>Activity</h2><span>{(data.pagination?.total ?? rows.length).toLocaleString()} matching events</span></div>
          {rows.length === 0 ? <Empty title="No events match">Try another type, outcome or search.</Empty> : (
            <div className="table-wrap" role="region" aria-label="Log entries" tabIndex={0}>
              <table>
                <thead><tr><th>When</th><th>What happened</th><th>Who</th><th>Outcome</th></tr></thead>
                <tbody>{fold(rows).map(({ row, count }) => <LogRow key={row.id} row={row} count={count} />)}</tbody>
              </table>
            </div>
          )}
          <Pager page={page} pageSize={data.pagination?.pageSize ?? 25} total={data.pagination?.total ?? rows.length} count={rows.length} busy={busy} onChange={setPage} noun="events" />
        </section>
      )}
    </>
  );
}

function LogRow({ row, count }: { row: LogEntry; count: number }) {
  const Icon = KIND_ICON[row.kind] ?? ShieldCheck;
  return (
    <tr>
      <td style={{ whiteSpace: 'nowrap' }} title={new Date(row.time).toLocaleString()}>{when(row.time)}</td>
      <td>
        <span style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Icon className="i" aria-label={KIND_WORD[row.kind]} style={{ flex: 'none', marginTop: 2, color: 'var(--ink-3)' }} />
          <span style={{ minWidth: 0 }}>
            <span className="cell-strong" style={{ display: 'block' }}>
              {row.title}
              {count > 1 && <span className="hint" style={{ fontWeight: 400 }} title="The same action repeated within a minute"> · {count} times</span>}
            </span>
            <span className="cell-sub log-detail">{row.detail}</span>
          </span>
        </span>
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {row.userId && row.kind === 'ai'
          ? <Link to={`/users?user=${encodeURIComponent(row.userId)}`}>{row.who}</Link>
          : row.who}
      </td>
      <td><Status tone={TONE[row.level]}>{WORD[row.level]}</Status></td>
    </tr>
  );
}
