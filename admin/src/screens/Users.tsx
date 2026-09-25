import { useCallback, useState } from 'react';
import { getUserPantry, getUsers } from '../api';
import type { AdminUser } from '../api/types';
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
  const { data, error, loading, reload, updatedAt, query, filter, page, busy, setQuery, setFilter, setPage, refresh } = useBrowse(getUsers);
  const users = data?.users ?? [];

  const exportRows = () => downloadCsv('panzi-users.csv',
    ['Name', 'Email', 'Pantry items', 'Scans', 'Joined', 'Status', 'Last active', 'Device', 'Signs in with'],
    users.map((u) => [u.name, u.email, u.items, u.scans, u.joined, statusLabel(u.status), u.last, u.device, isGuest(u) ? 'Guest (older app)' : u.signInMethod ?? 'Unknown']));

  return (
    <>
      <PageHead
        title="Users"
        text="Find a person to check their pantry and scans."
        updatedAt={updatedAt}
        tools={<>
          <button className="btn" type="button" onClick={refresh}>Refresh</button>
          <button className="btn" type="button" onClick={exportRows} disabled={!users.length}>Export this page</button>
        </>}
      />
      {data?.warning && <Notice title="Limited data" tone="warn">{data.warning}</Notice>}
      <div className="toolbar">
        <SearchField label="Search users" value={query} onChange={setQuery} placeholder="Name or email" />
        <Segmented label="Status" options={FILTERS} value={filter as (typeof FILTERS)[number]['value']} onChange={setFilter} />
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <section className={`panel${busy ? ' is-busy' : ''}`}>
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
      {open && <PersonDrawer key={open.user.id} user={open.user} onClose={() => setOpen(null)} />}
    </>
  );
}

function PersonDrawer({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const pantry = useResource(useCallback(() => getUserPantry(user.id), [user.id]), [user.id]);
  return (
    <Drawer title={user.name} subtitle={contact(user)} leading={<Avatar user={user} size={40} />} onClose={onClose}>
      <div className="mini-stats">
        <div><b>{user.items}</b><span>Pantry items</span></div>
        <div><b>{user.scans}</b><span>Scans</span></div>
        <div><b>{user.recipesCooked ?? 0}</b><span>Dishes saved</span></div>
        <div><b>{user.recipesRated ?? 0}</b><span>Dishes rated</span></div>
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
        <p className="hint" style={{ margin: '8px 0 0' }}>Opening a pantry is recorded in the audit log.</p>
      </div>
    </Drawer>
  );
}
