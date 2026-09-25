import { useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import { getAdmins, getConfig } from '../api';
import { Empty, ErrorState, Loading, Notice, PageHead, Panel, Status } from '../components/pz';
import { useResource } from '../lib/useResource';

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never');

// Admin access is read-only here. Accounts get or lose the claim through the
// server's grant-admin script, so nothing on this page hands out access.
export function Settings() {
  const admins = useResource(useCallback(() => getAdmins(), []), []);
  const config = useResource(useCallback(() => getConfig(), []), []);

  return (
    <>
      <PageHead
        title="Settings"
        text="Who can open this console, and how the server is set up. Access is checked again by the server on every request."
        updatedAt={admins.updatedAt}
        tools={<button className="btn" type="button" onClick={() => { admins.reload(); config.reload(); }}>Refresh</button>}
      />
      {admins.loading && !admins.data && <Loading />}
      {admins.error && <ErrorState message={admins.error} onRetry={admins.reload} />}
      {admins.data && (
        <Panel title="Admins" aside={`${admins.data.admins.length} ${admins.data.admins.length === 1 ? 'account' : 'accounts'}`}>
          {admins.data.note && <div style={{ padding: '12px 18px 0' }}><Notice>{admins.data.note}</Notice></div>}
          {admins.data.admins.length === 0 ? <Empty title="No admin accounts to show" /> : (
            <div className="panel-flush"><table>
              <thead><tr><th>Account</th><th>Status</th><th>Added</th><th>Last sign-in</th></tr></thead>
              <tbody>{admins.data.admins.map((a) => (
                <tr key={a.id}>
                  <td><span className="cell-strong">{a.email}</span>{a.isYou && <> <span className="chip">You</span></>}</td>
                  <td>{a.disabled ? <Status tone="bad">Disabled</Status> : a.canSignIn ? <Status tone="good">Can sign in</Status> : <Status tone="warn">No password sign-in</Status>}</td>
                  <td>{date(a.createdAt)}</td>
                  <td>{date(a.lastSignInAt)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="hint" style={{ padding: '12px 18px 14px', margin: 0 }}>Admin access is granted with the grant-admin script in the server folder.</p>
          <details className="more">
            <summary><ChevronRight className="i" aria-hidden="true" />Server configuration</summary>
            <div className="panel-body" style={{ paddingTop: 0 }}>
              {config.loading && !config.data && <Loading />}
              {config.error && <ErrorState message={config.error} onRetry={config.reload} />}
              {config.data && (config.data.groups.length === 0 ? <p className="hint">Configuration is available when connected to the server.</p> : config.data.groups.map((group) => (
                <div key={group.title} style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>{group.title}</h3>
                  <dl className="kv">{group.rows.map((row) => <FragmentRow key={row.label} label={row.label} value={row.value} note={row.note} />)}</dl>
                </div>
              )))}
            </div>
          </details>
        </Panel>
      )}
    </>
  );
}

function FragmentRow({ label, value, note }: { label: string; value: string; note: string }) {
  return <><dt>{label}</dt><dd>{value}{note && <span className="cell-sub">{note}</span>}</dd></>;
}
