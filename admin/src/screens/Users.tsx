import { AnimatedNumber } from '../components/AnimatedNumber';
import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getUser, getUserActivity, getUserPantry, getUsers } from '../api';
import type { AdminUser, RemovalOutcome, ReviewStatus, UserActivity } from '../api/types';
import { Drawer, Empty, ErrorState, Loading, Notice, PageHead, Pager, SearchField, Segmented, Status, type Tone } from '../components/pz';
import { downloadCsv } from '../lib/csv';
import { initials } from '../lib/format';
import { useBrowse } from '../lib/useBrowse';
import { useResource } from '../lib/useResource';

// The server's statuses. "Dormant" means no activity for 30 days; the console
// calls it Inactive. Accounts disabled earlier still come back as Suspended.
const FILTERS = [
  { value: 'All', label: 'All' },
  { value: 'Active', label: 'Active' },
  { value: 'Dormant', label: 'Inactive' },
] as const;
const TONE: Record<string, Tone> = { Active: 'good', Dormant: 'muted', Suspended: 'bad' };
const statusLabel = (status: string) => (status === 'Dormant' ? 'Inactive' : status);
// Accounts with no sign-in provider are guest accounts from an older app
// version; the current app only signs people up with an email or Facebook.
const isGuest = (user: AdminUser) => /guest|anonymous/i.test(user.signInMethod ?? '');
const contact = (user: AdminUser) => user.email || (isGuest(user) ? 'Guest account (older app)' : !user.signInMethod || user.signInMethod === 'Unknown' ? 'No email available' : `Signs in with ${user.signInMethod}`);

function Avatar({ user, size = 30 }: { user: AdminUser; size?: number }) {
  return (
    <span className="avatar" style={{ background: user.av, width: size, height: size, fontSize: size > 32 ? 14 : 12 }}>
      {user.photoURL ? <img src={user.photoURL} alt="" /> : initials(user.name)}
    </span>
  );
}

export function Users() {
  const [open, setOpen] = useState<{ user: AdminUser } | null>(null);
  // Other pages link here as /users?user=<uid> to open one person directly,
  // whether or not they are on the page of the table that is loaded.
  const [params, setParams] = useSearchParams();
  const linked = params.get('user');
  const closeLinked = () => setParams((next) => { next.delete('user'); return next; }, { replace: true });
  const { data, error, loading, reload, updatedAt, query, filter, page, busy, setQuery, setFilter, setPage, refresh } = useBrowse(getUsers);
  const users = data?.users ?? [];

  const exportRows = () => downloadCsv('panzi-users.csv',
    ['Name', 'Email', 'Pantry items', 'Scans', 'Joined', 'Status', 'Last active', 'Device', 'Signs in with'],
    users.map((u) => [u.name, u.email, u.items, u.scans, u.joined, statusLabel(u.status), u.last, u.device, isGuest(u) ? 'Guest (older app)' : u.signInMethod ?? 'Unknown']));

  return (
    <>
      <PageHead
        title="Users"
        text="The people behind every pantry. Explore their accounts, scan activity, and saved dishes."
        updatedAt={updatedAt}
        tools={<>
          <button className="btn" type="button" onClick={refresh}>Refresh</button>
          <button className="btn" type="button" onClick={exportRows} disabled={!users.length}>Export this page</button>
        </>}
      />
      {data?.warning && <Notice title="Limited data" tone="warn">{data.warning}</Notice>}
      {data && <section className="panel strip" aria-label="Account summary">
        <div className="metric"><div className="metric-label">Matching accounts</div><div className="metric-value"><AnimatedNumber value={(data.pagination?.total ?? users.length).toLocaleString()} /></div><div className="metric-note">For the current search and status</div></div>
        <div className="metric"><div className="metric-label">Pantry items on this page</div><div className="metric-value"><AnimatedNumber value={users.reduce((sum, u) => sum + u.items, 0).toLocaleString()} /></div><div className="metric-note">Across the accounts shown below</div></div>
        <div className="metric"><div className="metric-label">Scans on this page</div><div className="metric-value"><AnimatedNumber value={users.reduce((sum, u) => sum + u.scans, 0).toLocaleString()} /></div><div className="metric-note">Across the accounts shown below</div></div>
      </section>}
      <div className="toolbar">
        <SearchField label="Search users" value={query} onChange={setQuery} placeholder="Name or email" />
        <Segmented label="Status" options={FILTERS} value={filter as (typeof FILTERS)[number]['value']} onChange={setFilter} />
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <section className={`panel${busy ? ' is-busy' : ''}`}>
          <div className="table-heading"><h2>The Panzi community</h2><span>Select a name to open their pantry</span></div>
          {users.length === 0 ? (
            <Empty title={query ? `No one matches “${query}”` : 'No accounts in this filter'}>{query ? 'Check the spelling, or search by email instead.' : 'Try another status.'}</Empty>
          ) : (
            <div className="table-wrap" role="region" aria-label="Users" tabIndex={0}>
              <table>
                <thead><tr><th>Person</th><th>Status</th><th className="r">Pantry items</th><th className="r">Scans</th><th>Device</th><th>Joined</th><th>Last active</th></tr></thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="clickable" onClick={(event) => { if (!(event.target as Element).closest('button')) setOpen({ user }); }}>
                      <td><div className="person"><Avatar user={user} /><span>
                        <button type="button" className="row-btn" onClick={() => setOpen({ user })}>{user.name}</button>
                        <span className="cell-sub">{contact(user)}</span>
                      </span></div></td>
                      <td><Status tone={TONE[user.status] ?? 'muted'}>{statusLabel(user.status)}</Status></td>
                      <td className="r">{user.items}</td>
                      <td className="r">{user.scans}</td>
                      <td>{user.device}</td>
                      <td>{user.joined}</td>
                      <td>{user.last}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager page={page} pageSize={data.pagination?.pageSize ?? 25} total={data.pagination?.total ?? users.length} count={users.length} busy={busy} onChange={setPage} noun="people" />
        </section>
      )}
      {open && <PersonDrawer key={open.user.id} userId={open.user.id} initial={open.user} onClose={() => setOpen(null)} />}
      {!open && linked && <PersonDrawer key={linked} userId={linked} onClose={closeLinked} />}
    </>
  );
}


const OUTCOME_TONE: Record<RemovalOutcome, Tone> = { eaten: 'good', wasted: 'bad', unclassified: 'muted' };
// The words the app shows on its own removal sheet (src/services/removals.ts).
const REASON_WORD: Record<string, string> = {
  consumed: 'Consumed', spoiled: 'Spoiled', expired: 'Expired', other: 'Other',
};

/** "Other · Gave to neighbour" when the person typed why. */
function reasonText(row: { reason: string; note: string | null }): string {
  const word = REASON_WORD[row.reason] ?? row.reason;
  return row.reason === 'other' && row.note ? `${word} · ${row.note}` : word;
}
const FEEDBACK_WORD: Record<ReviewStatus, string> = { new: 'New', in_progress: 'In progress', resolved: 'Resolved' };
const FEEDBACK_TONE: Record<ReviewStatus, Tone> = { new: 'warn', in_progress: 'muted', resolved: 'good' };
const priced = (value: string) => (value.trim() === '—' ? 'Not priced' : value);

/**
 * One person: who they are, what is on their shelves, and what they have
 * done — scans, removals, feedback, AI spend. `initial` is the table row when
 * there is one; a panel opened from a link loads the account itself.
 */
function PersonDrawer({ userId, initial, onClose }: { userId: string; initial?: AdminUser; onClose: () => void }) {
  const account = useResource(useCallback(() => (initial ? Promise.resolve(initial) : getUser(userId).then((r) => r.user)), [userId, initial]), [userId]);
  const pantry = useResource(useCallback(() => getUserPantry(userId), [userId]), [userId]);
  const activity = useResource(useCallback(() => getUserActivity(userId), [userId]), [userId]);
  const user = account.data;

  if (!user) {
    return (
      <Drawer title={account.error ? 'Account unavailable' : 'Loading account'} onClose={onClose}>
        {account.error ? <ErrorState message={account.error} onRetry={account.reload} /> : <Loading label="Loading account" />}
      </Drawer>
    );
  }

  return (
    <Drawer title={user.name} subtitle={contact(user)} leading={<Avatar user={user} size={40} />} onClose={onClose}>
      <div className="mini-stats">
        <div><b><AnimatedNumber value={user.items} /></b><span>Pantry items</span></div>
        <div><b><AnimatedNumber value={user.scans} /></b><span>Scans</span></div>
        <div><b><AnimatedNumber value={user.recipesCooked ?? 0} /></b><span>Dishes saved</span></div>
        <div><b><AnimatedNumber value={user.recipesRated ?? 0} /></b><span>Dishes rated</span></div>
      </div>
      <dl className="kv">
        <dt>Status</dt><dd>{statusLabel(user.status)}</dd>
        <dt>Joined</dt><dd>{user.joined}</dd>
        <dt>Last active</dt><dd>{user.last}</dd>
        <dt>Device</dt><dd>{user.device}</dd>
        <dt>Signs in with</dt><dd>{isGuest(user) ? 'Guest account from an older app version' : user.signInMethod ?? 'Unknown'}</dd>
      </dl>
      <div>
        <h3>Pantry</h3>
        {pantry.loading && !pantry.data && <Loading label="Loading pantry" />}
        {pantry.error && <ErrorState message={pantry.error} onRetry={pantry.reload} />}
        {pantry.data && (pantry.data.length === 0
          ? <p className="hint" style={{ margin: 0 }}>Their pantry is empty.</p>
          : <ul className="list">{pantry.data.map((line, i) => (
              <li key={`${line.name}-${i}`}><span><span className="cell-strong">{line.name}</span>{line.qty && <span className="cell-sub">{line.qty}</span>}</span><span className="right">{line.exp}</span></li>
            ))}</ul>)}
      </div>
      {activity.loading && !activity.data && <Loading label="Loading activity" />}
      {activity.error && <ErrorState message={activity.error} onRetry={activity.reload} />}
      {activity.data && <PersonActivity data={activity.data} />}
      <p className="hint" style={{ margin: 0 }}>Opening an account is recorded in the audit log.</p>
    </Drawer>
  );
}

function PersonActivity({ data }: { data: UserActivity }) {
  const { eaten, wasted, unclassified } = data.outcomes;
  const confirmed = eaten + wasted;
  return (
    <>
      <div>
        <h3>Recent scans</h3>
        {data.scans.length === 0 ? <p className="hint" style={{ margin: 0 }}>No scans yet.</p> : (
          <ul className="list">{data.scans.map((scan) => (
            <li key={scan.id}>
              <span>
                <span className="cell-strong">{scan.scene}</span>
                <span className="cell-sub">{scan.items} found, {scan.added} added{scan.unresolved > 0 ? `, ${scan.unresolved} still need a date` : ''}</span>
              </span>
              <span className="right">{scan.at}</span>
            </li>
          ))}</ul>
        )}
      </div>
      <div>
        <h3>Where their food went</h3>
        {eaten + wasted + unclassified === 0 ? <p className="hint" style={{ margin: 0 }}>Nothing removed from their pantry yet.</p> : (
          <>
            <dl className="kv" style={{ marginBottom: 10 }}>
              <dt>Used up</dt><dd>{eaten.toLocaleString()}</dd>
              <dt>Thrown out</dt><dd>{wasted.toLocaleString()}{confirmed > 0 && <span className="hint"> · {Math.round((wasted / confirmed) * 100)}% of confirmed items</span>}</dd>
              <dt>No reason given</dt><dd>{unclassified.toLocaleString()}</dd>
            </dl>
            <ul className="list">{data.removals.map((row) => (
              <li key={row.id}>
                <span><span className="cell-strong">{row.name}</span><span className="cell-sub"><Status tone={OUTCOME_TONE[row.outcome]}>{reasonText(row)}</Status></span></span>
                <span className="right">{row.at}</span>
              </li>
            ))}</ul>
          </>
        )}
      </div>
      <div>
        <h3>Feedback they sent</h3>
        {data.feedback.length === 0 ? <p className="hint" style={{ margin: 0 }}>No feedback from this account.</p> : (
          <>
            <ul className="list">{data.feedback.map((row) => (
              <li key={row.id} style={{ alignItems: 'flex-start' }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{row.message}</span>
                  <span className="cell-sub"><Status tone={FEEDBACK_TONE[row.status]}>{FEEDBACK_WORD[row.status]}</Status> · {row.platform}, app {row.appVersion}</span>
                </span>
                <span className="right">{row.at}</span>
              </li>
            ))}</ul>
            <p className="hint" style={{ margin: '8px 0 0' }}><Link to="/feedback?status=all">Manage feedback</Link></p>
          </>
        )}
      </div>
      <div>
        <h3>AI cost</h3>
        {data.cost.calls === 0 ? <p className="hint" style={{ margin: 0 }}>No AI requests recorded for this account.</p> : (
          <>
            <dl className="kv" style={{ marginBottom: 10 }}>
              <dt>Last 30 days</dt><dd>{priced(data.cost.month)} <span className="hint">· {data.cost.monthCalls.toLocaleString()} requests</span></dd>
              <dt>All time</dt><dd>{priced(data.cost.total)} <span className="hint">· {data.cost.calls.toLocaleString()} requests</span></dd>
            </dl>
            <ul className="list">{data.cost.routes.map((row) => (
              <li key={row.route}><span className="cell-strong">{row.route}</span><span className="right">{row.calls.toLocaleString()} requests · {priced(row.cost)}</span></li>
            ))}</ul>
            {data.cost.unpriced > 0 && <p className="hint" style={{ margin: '8px 0 0' }}>{data.cost.unpriced} request(s) used a model with no price and are left out of these totals.</p>}
          </>
        )}
      </div>
    </>
  );
}
