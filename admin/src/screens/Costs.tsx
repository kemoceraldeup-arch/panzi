import { useCallback, useState } from 'react';
import { getCosts } from '../api';
import type { RangeKey } from '../api/types';
import { ColumnChart, Empty, ErrorState, Loading, Notice, PageHead, Panel, RANGE_OPTIONS, Segmented } from '../components/pz';
import { downloadCsv } from '../lib/csv';
import { useResource } from '../lib/useResource';

// Costs are derived from stored token counts and a price table. When the price
// table is empty the server answers with dashes, which this page shows as "Not
// priced" rather than as zero dollars.
const shown = (value: string) => (value.trim() === '—' || value.trim() === '' ? 'Not priced' : value);

export function Costs() {
  const [range, setRange] = useState<RangeKey>('30d');
  const { data, error, loading, reload, updatedAt } = useResource(useCallback(() => getCosts(range), [range]), [range]);

  const exportRows = () => data && downloadCsv(`panzi-api-costs-${range}.csv`, ['Route', 'Calls', 'Tokens', 'Cost', 'Average ms'],
    data.routes.map((r) => [r.route, r.calls, r.tokens, r.cost, r.avgMs]));

  return (
    <>
      <PageHead
        title="API costs"
        text="Estimated from the tokens each model call recorded. Token counts are stored; prices are applied when you open this page."
        updatedAt={updatedAt}
        tools={<>
          <Segmented label="Date range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
          <button className="btn" type="button" onClick={exportRows} disabled={!data?.routes.length}>Export CSV</button>
        </>}
      />
      {loading && !data && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <div className={loading ? 'is-busy' : ''}>
          {data.note && <Notice title="About these numbers" tone={data.stats.some((s) => s.value.trim() === '—') ? 'warn' : 'info'}>{data.note}</Notice>}
          <section className="panel strip" aria-label="Spend">
            {data.stats.map((row) => (
              <div className="metric" key={row.label}>
                <div className="metric-label">{row.label}</div>
                <div className={`metric-value${shown(row.value) === 'Not priced' ? ' muted' : ''}`}>{shown(row.value)}</div>
                <div className="metric-note">{row.note}</div>
              </div>
            ))}
          </section>
          <div className="row two">
            <Panel title="Spend over time" aside={range}>
              <div className="panel-body">
                {data.chart.length === 0 ? <Empty title="No model calls in this period" /> : (
                  <ColumnChart label="Spend" rows={data.chart.map((bar) => ({ label: bar.label, value: bar.pct, tip: `${bar.label}\n${shown(bar.value)}` }))} />
                )}
              </div>
            </Panel>
            <Panel title="Top accounts by spend">
              {data.users.length === 0 ? <Empty title="No usage in this period" /> : (
                <div className="panel-flush"><table>
                  <thead><tr><th>Account</th><th className="r">Calls</th><th>Cost</th></tr></thead>
                  <tbody>{data.users.map((u) => <tr key={u.userId}><td className="cell-strong">{u.userId === 'deleted' ? 'Deleted account' : u.userId}</td><td className="r">{u.calls.toLocaleString()}</td><td>{shown(u.cost)}</td></tr>)}</tbody>
                </table></div>
              )}
            </Panel>
          </div>
          <Panel title="By feature">
            {data.routes.length === 0 ? <Empty title="No model calls in this period" /> : (
              <div className="panel-flush table-wrap" role="region" aria-label="Cost by feature" tabIndex={0}><table>
                <thead><tr><th>Feature</th><th className="r">Calls</th><th className="r">Tokens</th><th className="r">Average time</th><th>Cost</th><th style={{ width: '25%' }}><span className="sr-only">Share</span></th></tr></thead>
                <tbody>{data.routes.map((r, i) => (
                  <tr key={r.route}>
                    <td className="cell-strong">{r.route}</td><td className="r">{r.calls.toLocaleString()}</td><td className="r">{r.tokens}</td>
                    <td className="r">{(r.avgMs / 1000).toFixed(1)} s</td><td>{shown(r.cost)}</td>
                    <td><span className="share-fill" style={{ ['--i' as string]: i, display: 'block', height: 8, width: `${r.pct}%`, borderRadius: '0 4px 4px 0', background: 'var(--ink-2)' }} /></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
