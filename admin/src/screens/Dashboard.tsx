import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, CircleAlert, Inbox, Receipt, Refrigerator, TrendingDown, TrendingUp } from 'lucide-react';
import { getAlerts, getAnalytics, getDashboard, getReview } from '../api';
import type { AnalyticsData, RangeKey } from '../api/types';
import { ColumnChart, Empty, ErrorState, Loading, PageHead, Panel, RANGE_OPTIONS, Segmented, Status, toneFromColor, TrendLine } from '../components/pz';
import { downloadCsv } from '../lib/csv';
import { useResource } from '../lib/useResource';

const toNumber = (value: string | undefined) => Number(String(value ?? '').replace(/[^0-9.]/g, '')) || 0;
const stat = (data: AnalyticsData, label: RegExp) => data.stats.find((row) => label.test(row.label));

export function Dashboard() {
  const [range, setRange] = useState<RangeKey>('30d');
  const dashboard = useResource(useCallback(() => getDashboard(range), [range]), [range]);
  const outcomes = useResource(useCallback(() => getAnalytics(range), [range]), [range]);
  const alerts = useResource(useCallback(() => getAlerts(), []), []);
  const review = useResource(useCallback(() => getReview('open', 1), []), []);
  const data = dashboard.data;

  const refresh = () => { dashboard.reload(); outcomes.reload(); alerts.reload(); review.reload(); };
  const exportRows = () => data && downloadCsv(`panzi-dashboard-${range}.csv`, ['Metric', 'Value', 'Change', 'Note'],
    data.range.stats.map((row) => [row.label, row.value, row.delta, row.note]));

  const openReports = review.data ? (review.data.pagination?.scans ?? review.data.scans.length) + (review.data.pagination?.feedback ?? review.data.feedback.length) : null;

  return (
    <>
      <PageHead
        title="Dashboard"
        text={`How Panzi pantries did over the ${data?.range.label ?? 'selected period'}, and what needs a look.`}
        updatedAt={dashboard.updatedAt}
        tools={<>
          <Segmented label="Date range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
          <button className="btn" type="button" onClick={refresh}>Refresh</button>
          <button className="btn" type="button" onClick={exportRows} disabled={!data}>Export CSV</button>
        </>}
      />
      {dashboard.loading && !data && <Loading />}
      {dashboard.error && <ErrorState message={dashboard.error} onRetry={dashboard.reload} />}
      {data && (
        <div className={dashboard.loading ? 'is-busy' : ''}>
          <div className="row hero">
            <FoodOutcome data={outcomes.data} error={outcomes.error} loading={outcomes.loading} label={data.range.label} />
            <Panel title="Needs your attention">
              <ul className="todo">
                {openReports !== null && (
                  <li><Link to="/review"><span className={`todo-icon ${openReports ? 'warn' : 'good'}`}><Inbox className="i" aria-hidden="true" /></span>
                    <span><b>{openReports ? `${openReports} open report${openReports === 1 ? '' : 's'}` : 'No open reports'}</b><small>Scan issues and feedback waiting for a decision</small></span>
                    <ChevronRight className="i go" aria-hidden="true" /></Link></li>
                )}
                {alerts.data?.alerts.map((alert) => (
                  <li key={alert.id}><Link to={alert.href}><span className={`todo-icon ${alert.severity === 'error' ? 'bad' : 'warn'}`}><CircleAlert className="i" aria-hidden="true" /></span>
                    <span><b>{alert.title}</b><small>{alert.detail}</small></span><ChevronRight className="i go" aria-hidden="true" /></Link></li>
                ))}
                {data.expiring[0] && (
                  <li><Link to="/food"><span className="todo-icon"><Refrigerator className="i" aria-hidden="true" /></span>
                    <span><b>{data.expiring[0].name} is due in {data.expiring[0].count} pantries</b><small>Due {data.expiring[0].due}</small></span>
                    <ChevronRight className="i go" aria-hidden="true" /></Link></li>
                )}
                <li><Link to="/costs"><span className="todo-icon"><Receipt className="i" aria-hidden="true" /></span>
                  <span><b>API spend</b><small>See what each scan, recipe and chat reply cost</small></span><ChevronRight className="i go" aria-hidden="true" /></Link></li>
              </ul>
              {alerts.data && alerts.data.alerts.length === 0 && <p className="hint" style={{ padding: '0 18px 14px', margin: 0 }}>{alerts.data.note}</p>}
            </Panel>
          </div>

          <section className="panel strip" aria-label="Summary">
            {data.range.stats.map((row) => (
              <div className="metric" key={row.label}>
                <div className="metric-label">{row.label}</div>
                <div className="metric-value">{row.value}</div>
                <div className="metric-note">{row.note}</div>
                {row.delta && <div className="metric-note"><span className={row.up ? 'up' : 'down'}>{row.delta}</span> vs the previous {data.range.label.replace(/^last /, '')}</div>}
              </div>
            ))}
          </section>

          <div className="row two">
            <Panel title="Items scanned" aside={data.range.label}>
              <div className="panel-body">
                {data.range.chart.every((bar) => bar.v === 0)
                  ? <Empty title="No scans in this period" />
                  : <ColumnChart label="Items scanned" rows={data.range.chart.map((bar) => ({ label: bar.label, value: bar.v, tip: `${bar.label}\n${bar.v.toLocaleString()} items\n${bar.m}% fixed by hand` }))} />}
              </div>
            </Panel>
            <Panel title={data.healthLabel ?? 'Pipeline activity'}>
              <div className="panel-flush">
                <table>
                  <thead><tr><th>Measure</th><th>Now</th><th>Status</th></tr></thead>
                  <tbody>
                    {data.health.map((row) => {
                      const tone = toneFromColor(row.color);
                      return <tr key={row.label}><td className="cell-strong">{row.label}</td><td>{row.value}</td><td><Status tone={tone}>{tone === 'good' ? 'Normal' : 'Check'}</Status></td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          <div className="row half">
            <Panel title="Expiring in the next 3 days" aside={<Link to="/food">Pantry insights</Link>}>
              {data.expiring.length === 0 ? <Empty title="Nothing is due in the next 3 days" /> : (
                <div className="panel-flush table-wrap" role="region" aria-label="Expiring soon" tabIndex={0}>
                  <table>
                    <thead><tr><th>Food</th><th className="r">Pantries</th><th>Due</th></tr></thead>
                    <tbody>{data.expiring.map((row) => <tr key={row.id}><td><span className="cell-strong">{row.name}</span><span className="cell-sub">{row.cat}</span></td><td className="r">{row.count}</td><td>{row.due}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </Panel>
            <Panel title="Recent activity" aside={<Link to="/logs">All logs</Link>}>
              {data.activity.length === 0 ? <Empty title="No activity yet" /> : (
                <ul className="todo">
                  {data.activity.map((row) => {
                    const tone = toneFromColor(row.color);
                    return <li key={row.id}><div style={{ display: 'grid', gridTemplateColumns: '10px 1fr', gap: 12, padding: '12px 18px', alignItems: 'baseline' }}>
                      <span className={`dot ${tone === 'bad' ? 'error' : tone === 'warn' ? 'caution' : tone === 'good' ? 'used' : ''}`} style={{ width: 8, height: 8, borderRadius: '50%', background: tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : tone === 'good' ? 'var(--used)' : 'var(--ink-3)' }} />
                      <span><b style={{ fontWeight: 500, display: 'block' }}>{row.text}</b><small style={{ color: 'var(--ink-3)', fontSize: 13 }}>{row.time}</small></span>
                    </div></li>;
                  })}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}

/** The one loud panel: where removed pantry food went. Reads the same
 *  item_dispositions figures as Food outcomes, so both pages always agree. */
function FoodOutcome({ data, error, loading, label }: { data: AnalyticsData | null; error: string | null; loading: boolean; label: string }) {
  if (loading && !data) return <section className="panel outcome"><Loading label="Loading food outcomes" /></section>;
  if (error || !data) return <section className="panel outcome"><ErrorState message={error ?? 'No data'} /></section>;
  const used = toNumber(stat(data, /consumed|saved/i)?.value);
  const wasted = toNumber(stat(data, /discarded|wasted/i)?.value);
  const unknown = toNumber(stat(data, /unclassified/i)?.value);
  const byAmount = stat(data, /by amount/i)?.value;
  const total = used + wasted + unknown;
  const confirmed = used + wasted;
  const pct = (v: number) => (total ? (v / total) * 100 : 0);
  const rate = confirmed ? Math.round((wasted / confirmed) * 1000) / 10 : null;
  const trend = data.chart
    .filter((b) => b.saved + b.wasted > 0)
    .map((b) => ({ label: b.label, value: Math.round((b.wasted / (b.saved + b.wasted)) * 1000) / 10 }));
  const change = trend.length >= 2 ? Math.round((trend[trend.length - 1].value - trend[0].value) * 10) / 10 : null;

  return (
    <section className="panel outcome" aria-labelledby="outcome-title">
      <div className="outcome-top">
        <div>
          <h2 id="outcome-title">Where pantry food went</h2>
          <div className="sub">Every item removed from a pantry in the {label}</div>
          {rate === null ? (
            <>
              <div className="hero-figure" style={{ color: 'var(--ink-3)' }}>No data</div>
              <div className="sub" style={{ marginTop: 6 }}>Nobody has marked food used up or thrown out yet</div>
            </>
          ) : (
            <>
              <div className="hero-figure">{rate}<span>%</span></div>
              <div className="sub" style={{ marginTop: 6 }}>of confirmed items were thrown out</div>
              {byAmount && byAmount !== '—' && <div className="sub">{byAmount} by amount, counting “some of it” as half</div>}
              {change !== null && change !== 0 && (
                <div className={`delta ${change < 0 ? 'good' : 'bad'}`}>
                  {change < 0 ? <TrendingDown className="i" aria-hidden="true" /> : <TrendingUp className="i" aria-hidden="true" />}
                  {Math.abs(change)} points {change < 0 ? 'lower' : 'higher'} <span className="delta-note">than at the start of the period</span>
                </div>
              )}
            </>
          )}
        </div>
        <TrendLine rows={trend} caption="Waste rate over the period" />
      </div>
      {total > 0 ? (
        <>
          <div className="ribbon" role="img" aria-label={`Used up ${used}, thrown out ${wasted}, no reason given ${unknown}`}>
            {used > 0 && <span className="seg used" style={{ width: `${pct(used)}%` }} data-tip={`Used up\n${used.toLocaleString()} items, ${pct(used).toFixed(1)}%`} />}
            {wasted > 0 && <span className="seg wasted" style={{ width: `${pct(wasted)}%` }} data-tip={`Thrown out\n${wasted.toLocaleString()} items, ${pct(wasted).toFixed(1)}%`} />}
            {unknown > 0 && <span className="seg unknown" style={{ width: `${pct(unknown)}%` }} data-tip={`No reason given\n${unknown.toLocaleString()} items, ${pct(unknown).toFixed(1)}%`} />}
          </div>
          <div className="ribbon-key">
            <div className="key"><i className="sw used" /><span>Used up</span><b style={{ gridColumn: 2 }}>{used.toLocaleString()}</b><p>Eaten or cooked</p></div>
            <div className="key"><i className="sw wasted" /><span>Thrown out</span><b style={{ gridColumn: 2 }}>{wasted.toLocaleString()}</b><p>Marked as thrown away</p></div>
            <div className="key"><i className="sw unknown" /><span>No reason given</span><b style={{ gridColumn: 2 }}>{unknown.toLocaleString()}</b><p>Deleted or cleared, so not counted as waste</p></div>
          </div>
        </>
      ) : (
        <p className="hint" style={{ marginTop: 20 }}>No pantry items were removed in this period.</p>
      )}
    </section>
  );
}
