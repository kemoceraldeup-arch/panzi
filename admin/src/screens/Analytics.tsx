import { useCallback, useState } from 'react';
import { getAnalytics } from '../api';
import type { RangeKey, ScannerAccuracy } from '../api/types';
import { Empty, ErrorState, Loading, Notice, PageHead, Panel, RANGE_OPTIONS, Segmented, StackedChart } from '../components/pz';
import { downloadCsv } from '../lib/csv';
import { useResource } from '../lib/useResource';

const pct = (value: number | null) => (value === null ? 'No data' : `${value}%`);

export function Analytics() {
  const [range, setRange] = useState<RangeKey>('30d');
  const { data, error, loading, reload, updatedAt } = useResource(useCallback(() => getAnalytics(range), [range]), [range]);

  const exportRows = () => data && downloadCsv(`panzi-food-outcomes-${range}.csv`, ['Period', 'Used up', 'Thrown out'],
    data.chart.map((bar) => [bar.label, bar.saved, bar.wasted]));

  return (
    <>
      <PageHead
        title="Food outcomes"
        text="Only items people marked as used up or thrown out count toward the waste rate. Items removed without a reason are counted separately."
        updatedAt={updatedAt}
        tools={<>
          <Segmented label="Date range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
          <button className="btn" type="button" onClick={exportRows} disabled={!data}>Export CSV</button>
        </>}
      />
      {loading && !data && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <div className={loading ? 'is-busy' : ''}>
          {data.note && <Notice title="About these numbers">{data.note}</Notice>}
          <section className={`panel strip${data.stats.length === 5 ? ' five' : ''}`} aria-label="Totals">
            {data.stats.map((row) => (
              <div className="metric" key={row.label}>
                <div className="metric-label">{row.label}</div>
                <div className="metric-value">{row.value}</div>
                <div className="metric-note">{row.note}</div>
              </div>
            ))}
          </section>

          {data.removals === 0 ? (
            <Panel title="Used up and thrown out"><Empty title="No removals recorded yet">This fills in the first time someone marks food as used up or deletes it from their pantry.</Empty></Panel>
          ) : (
            <div className="row two">
              <Panel title="Used up and thrown out" aside="Items">
                <div className="panel-body">
                  <div className="legend"><span><i className="sw used" />Used up</span><span><i className="sw wasted" />Thrown out</span></div>
                  <StackedChart rows={data.chart.map((bar) => ({ label: bar.label, used: bar.saved, wasted: bar.wasted }))} />
                </div>
              </Panel>
              <Panel title="Thrown out most often" aside="Items">
                <div className="panel-body">
                  {data.wasted.length === 0 ? <Empty title="Nothing was marked as thrown out" /> : data.wasted.map((row, i) => (
                    <div className="hbar" key={row.name}>
                      <span>{row.name}</span>
                      <span className="hbar-track"><span className="hbar-fill" style={{ display: 'block', width: `${row.w}%`, ['--i' as string]: i }} /></span>
                      <b className="num">{row.n}</b>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          )}

          <div className="row half">
            {data.accuracy && <ScannerCard accuracy={data.accuracy} />}
            {data.locations && data.locations.length > 0 && (
              <Panel title="Where food is kept" aside="Current pantry items">
                <div className="panel-body">
                  {data.locations.map((row, i) => (
                    <div className="hbar" key={row.label}>
                      <span>{row.label}</span>
                      <span className="hbar-track"><span className="hbar-fill" style={{ display: 'block', width: `${row.pct}%`, background: 'var(--ink-2)', ['--i' as string]: i }} /></span>
                      <b className="num">{row.n.toLocaleString()}</b>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ScannerCard({ accuracy }: { accuracy: ScannerAccuracy }) {
  const rows = [
    ['Items the scanner found', pct(accuracy.readShare), `${accuracy.read.toLocaleString()} found, ${accuracy.handAdded.toLocaleString()} typed in by hand`],
    ['Names people changed', pct(accuracy.name.correctedPct), `${accuracy.name.corrected} changed, ${accuracy.name.confirmed} kept, ${accuracy.name.untouched} never checked`],
    ['Dates people changed', pct(accuracy.date.correctedPct), `${accuracy.date.corrected} changed, ${accuracy.date.confirmed} kept, ${accuracy.date.untouched} never checked`],
    ['Items with no date found', pct(accuracy.date.absentPct), `${accuracy.date.absent} of ${accuracy.read} items`],
  ];
  return (
    <Panel title="How the scanner did" aside={`${accuracy.scans.toLocaleString()} scans`}>
      <div className="panel-flush">
        <table>
          <thead><tr><th>Measure</th><th className="r">Share</th><th>Detail</th></tr></thead>
          <tbody>{rows.map(([label, value, note]) => <tr key={label}><td className="cell-strong">{label}</td><td className="r">{value}</td><td style={{ color: 'var(--ink-3)', fontSize: 13 }}>{note}</td></tr>)}</tbody>
        </table>
        {accuracy.note && <p className="hint" style={{ padding: '10px 18px 14px', margin: 0 }}>{accuracy.note}</p>}
      </div>
    </Panel>
  );
}
