import { AnimatedNumber } from '../components/AnimatedNumber';
import { useCallback, useMemo, useState } from 'react';
import { getFoods } from '../api';
import { Empty, ErrorState, Loading, Notice, PageHead, SearchField } from '../components/pz';
import { downloadCsv } from '../lib/csv';
import { matches } from '../lib/format';
import { useResource } from '../lib/useResource';

// Six date sources, grouped into three so the legend stays readable:
// known (printed or typed), guessed (rough pick or Panzi's estimate), and
// missing (the person said they don't know, or nothing was recorded).
export function FoodDatabase() {
  const { data, error, loading, reload, updatedAt } = useResource(useCallback(() => getFoods(), []), []);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const foods = useMemo(() => (data?.foods ?? []).filter((f) => (category === 'All' || f.cat === category) && matches(query, f.name)), [data, query, category]);

  const exportRows = () => downloadCsv('panzi-pantry-insights.csv',
    ['Food', 'Category', 'Pantries', 'Items', 'Dated %', 'Printed %', 'Typed %', 'Rough %', 'Estimated %', 'Unknown %', 'None %', 'Typical shelf life'],
    foods.map((f) => [f.name, f.cat, f.pantries, f.items, f.dated, f.sources.printed, f.sources.typed, f.sources.rough, f.sources.estimated, f.sources.unknown, f.sources.none, f.shelf]));

  return (
    <>
      <PageHead
        title="Inside the pantry"
        text="A closer look at what people keep, how long it lasts, and where its expiry date came from."
        updatedAt={updatedAt}
        tools={<button className="btn" type="button" onClick={exportRows} disabled={!foods.length}>Export CSV</button>}
      />
      {data?.note && <Notice>{data.note}</Notice>}
      {data && <section className="panel strip" aria-label="Pantry summary">
        <div className="metric"><div className="metric-label">Pantry items</div><div className="metric-value"><AnimatedNumber value={data.totalItems.toLocaleString()} /></div><div className="metric-note">Stored across the community</div></div>
        <div className="metric"><div className="metric-label">Foods in this view</div><div className="metric-value"><AnimatedNumber value={data.foods.length.toLocaleString()} /></div><div className="metric-note">Grouped by ingredient</div></div>
        <div className="metric"><div className="metric-label">Food categories</div><div className="metric-value"><AnimatedNumber value={data.categories.length} /></div><div className="metric-note">From produce to pantry staples</div></div>
      </section>}
      {data && <div className="category-tabs" role="group" aria-label="Food category"><button type="button" aria-pressed={category === 'All'} onClick={() => setCategory('All')}>All foods</button>{data.categories.map(c => <button type="button" key={c.label} aria-pressed={category === c.label} onClick={() => setCategory(c.label)}>{c.label}<span>{c.n}</span></button>)}</div>}
      <div className="toolbar">
        <SearchField label="Search foods" value={query} onChange={setQuery} placeholder="Find an ingredient…" />
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <section className="panel">
          <div className="table-heading"><h2>What's on the shelves</h2><span>{foods.length} foods shown</span></div>
          <div className="panel-body" style={{ paddingBottom: 4 }}>
            <div className="legend">
              <span data-tip="Printed on the pack, or typed in by the person"><i className="sw" style={{ background: 'var(--ink-2)' }} />Date known</span>
              <span data-tip="A rough pick like “about a week”, or Panzi’s own estimate"><i className="sw" style={{ background: 'var(--line-2)' }} />Date guessed</span>
              <span data-tip="The person didn’t know, or nothing was recorded"><i className="sw unknown" />No date</span>
            </div>
          </div>
          {foods.length === 0 ? <Empty title={data.foods.length ? 'No food matches that search' : 'No pantry items yet'} /> : (
            <div className="table-wrap" role="region" aria-label="Foods in pantries" tabIndex={0}>
              <table>
                <thead><tr><th>Food</th><th>Category</th><th className="r">Pantries</th><th className="r">Items</th><th>Typical shelf life</th><th>Expiry dates</th></tr></thead>
                <tbody>
                  {foods.map((f) => {
                    const known = f.sources.printed + f.sources.typed;
                    const guessed = f.sources.rough + f.sources.estimated;
                    const missing = f.sources.unknown + f.sources.none;
                    const tip = `${f.name}\nPrinted ${f.sources.printed}%, typed ${f.sources.typed}%\nRough ${f.sources.rough}%, estimated ${f.sources.estimated}%\nUnknown ${f.sources.unknown}%, none ${f.sources.none}%`;
                    return (
                      <tr key={f.id}>
                        <td className="cell-strong">{f.name}</td>
                        <td>{f.cat || 'Uncategorized'}</td>
                        <td className="r">{f.pantries}</td>
                        <td className="r">{f.items}</td>
                        <td>{f.shelf}</td>
                        <td>
                          <div className="prov" tabIndex={0} data-tip={tip} role="img" aria-label={`Known ${known}%, guessed ${guessed}%, no date ${missing}%`}>
                            {known > 0 && <i className="p-known" style={{ width: `${known}%` }} />}
                            {guessed > 0 && <i className="p-guessed" style={{ width: `${guessed}%` }} />}
                            {missing > 0 && <i className="p-missing" style={{ width: `${missing}%` }} />}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
