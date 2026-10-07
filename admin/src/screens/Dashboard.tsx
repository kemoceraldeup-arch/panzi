import { AnimatedNumber } from '../components/AnimatedNumber';
import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CircleX, CookingPot, Leaf, Refrigerator, ScanLine, TrendingDown, TrendingUp, TriangleAlert, Users } from 'lucide-react';
import { getAlerts, getAnalytics, getDashboard, getFeedback } from '../api';
import type { AlertsResponse, AnalyticsData, RangeKey } from '../api/types';
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
  const feedback = useResource(useCallback(() => getFeedback({ status: 'open' }), []), []);
  const data = dashboard.data;

  const refresh = () => { dashboard.reload(); outcomes.reload(); alerts.reload(); feedback.reload(); };
  const exportRows = () => data && downloadCsv(`panzi-dashboard-${range}.csv`, ['Metric', 'Value', 'Change', 'Note'],
    data.range.stats.filter((row) => !/chat|review|report/i.test(row.label)).map((row) => [row.label, row.value, row.delta, row.note]));

  const metricIcons = [Users, ScanLine, Users, Leaf];

  return (
    <>
      <PageHead
        title="Dashboard"
        text="A little care for every pantry. Here's the bigger picture."
        updatedAt={dashboard.updatedAt}
        tools={<>
          <Segmented label="Date range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
          <button className="btn" type="button" onClick={refresh}>Refresh</button>
          <button className="btn primary" type="button" onClick={exportRows} disabled={!data}>Export report <ArrowUpRight className="i" /></button>
        </>}
      />
      {dashboard.loading && !data && <Loading />}
      {dashboard.error && <ErrorState message={dashboard.error} onRetry={dashboard.reload} />}
      {alerts.data && alerts.data.alerts.length > 0 && <Alerts data={alerts.data} />}
      {data && (
        <div className={dashboard.loading ? 'is-busy' : ''}>
          <section className="welcome-banner">
            <div className="welcome-copy"><span className="eyebrow"><Leaf className="i" /> THE PANZI PICTURE</span><h2>Good food.<br />Less going to waste.</h2><p>From the first scan to the last bite, see how people are making the most of what they have.</p><Link className="btn primary" to="/analytics">Explore food outcomes <ArrowUpRight className="i" /></Link></div>
            <img src="/mascot/panzi-shelf.png" alt="Panzi keeping the pantry stocked" className="welcome-mascot" />
            <div className="welcome-note"><Refrigerator className="i" /><span>Every pantry<br /><b>has a bigger story.</b></span></div>
          </section>

          <section className="panel strip" aria-label="Summary">
            {data.range.stats.filter((row) => !/chat|review|report/i.test(row.label)).map((row, index) => {
              const Icon = metricIcons[index % metricIcons.length];
              return (
              <div className="metric" key={row.label}>
                <div className="metric-label">{row.label}<span className="metric-icon"><Icon className="i" /></span></div>
                <div className="metric-value"><AnimatedNumber value={row.value} /></div>
                <div className="metric-note">{row.note}</div>
                {row.delta && <div className="metric-note"><span className={row.up ? 'up' : 'down'}>{row.delta}</span> vs the previous {data.range.label.replace(/^last /, '')}</div>}
              </div>
            );})}
          </section>

          <div className="row hero">
            <FoodOutcome data={outcomes.data} error={outcomes.error} loading={outcomes.loading} label={data.range.label} />
            <Panel title="Explore your workspace" className="workspace-shortcuts">
              <p className="panel-intro">The things that make Panzi, Panzi.</p>
              <Link to="/food"><span className="shortcut-icon"><Refrigerator className="i" /></span><span><b>Inside the pantry</b><small>Ingredients, categories & expiry dates</small></span><ArrowUpRight className="i" /></Link>
              <Link to="/recipes"><span className="shortcut-icon peach"><CookingPot className="i" /></span><span><b>What's cooking?</b><small>Saved recipes & cooking ratings</small></span><ArrowUpRight className="i" /></Link>
              <Link to="/users"><span className="shortcut-icon cream"><Users className="i" /></span><span><b>The Panzi community</b><small>Accounts, pantries & scan activity</small></span><ArrowUpRight className="i" /></Link>
            </Panel>
          </div>

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
                      return <tr key={row.label}><td className="cell-strong">{row.href ? <Link to={row.href}>{row.label}</Link> : row.label}</td><td>{row.value}</td><td><Status tone={tone}>{tone === 'good' ? 'Normal' : 'Check'}</Status></td></tr>;
                    })}
                    {alerts.data && (
                      <tr><td className="cell-strong" title={alerts.data.note}>AI alerts (24h)</td><td>{alerts.data.alerts.length}</td>
                        <td><Status tone={alerts.data.alerts.some((a) => a.severity === 'error') ? 'bad' : alerts.data.alerts.length ? 'warn' : 'good'}>{alerts.data.alerts.length ? 'Check' : 'Normal'}</Status></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          <div className="row half">
            <Panel title="Latest feedback" aside={<Link to="/feedback">{feedback.data ? `All open (${feedback.data.open.toLocaleString()})` : 'All feedback'}</Link>}>
              {feedback.loading && !feedback.data && <Loading label="Loading feedback" />}
              {feedback.error && <ErrorState message={feedback.error} onRetry={feedback.reload} />}
              {feedback.data && (feedback.data.feedback.length === 0 ? <Empty title="No open feedback">Everything people sent has been handled.</Empty> : (
                <ul className="todo">
                  {feedback.data.feedback.slice(0, 4).map((row) => (
                    <li key={row.id}><Link to="/feedback">
                      <span className="todo-icon warn" aria-hidden="true">{row.user.slice(0, 1).toUpperCase()}</span>
                      <span style={{ minWidth: 0 }}><b>{row.user}</b><small style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.message}</small></span>
                      <small className="go">{row.at}</small>
                    </Link></li>
                  ))}
                </ul>
              ))}
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

/** Conditions the server checks over the last 24 hours of AI requests. Only
 *  drawn when one holds, so its presence alone means something needs a look. */
function Alerts({ data }: { data: AlertsResponse }) {
  return (
    <section className="panel" aria-labelledby="alerts-title" style={{ marginBottom: 18 }}>
      <div className="panel-head"><h2 id="alerts-title">Needs attention</h2><span className="aside" title={data.note}>Last 24 hours</span></div>
      <ul className="todo" role="alert">
        {data.alerts.map((alert) => {
          const Icon = alert.severity === 'error' ? CircleX : TriangleAlert;
          return (
            <li key={alert.id}><Link to={alert.href}>
              <span className={`todo-icon ${alert.severity === 'error' ? 'bad' : 'warn'}`}><Icon className="i" aria-hidden="true" /></span>
              <span><b>{alert.title}</b><small>{alert.detail}</small></span>
              <span className="go">{alert.action} <ArrowUpRight className="i" aria-hidden="true" /></span>
            </Link></li>
          );
        })}
      </ul>
    </section>
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
              <div className="hero-figure"><AnimatedNumber value={rate} /><span>%</span></div>
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
            <div className="key"><i className="sw used" /><span>Used up</span><b style={{ gridColumn: 2 }}><AnimatedNumber value={used} /></b><p>Eaten or cooked</p></div>
            <div className="key"><i className="sw wasted" /><span>Thrown out</span><b style={{ gridColumn: 2 }}><AnimatedNumber value={wasted} /></b><p>Marked as thrown away</p></div>
            <div className="key"><i className="sw unknown" /><span>No reason given</span><b style={{ gridColumn: 2 }}><AnimatedNumber value={unknown} /></b><p>Deleted or cleared, so not counted as waste</p></div>
          </div>
        </>
      ) : (
        <p className="hint" style={{ marginTop: 20 }}>No pantry items were removed in this period.</p>
      )}
    </section>
  );
}
