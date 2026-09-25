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
        title="Pantry insights"
        text="What people keep in their pantries, and where each expiry date came from. This is a summary of stored items, not a food list you can edit."
        updatedAt={updatedAt}
        tools={<button className="btn" type="button" onClick={exportRows} disabled={!foods.length}>Export CSV</button>}
      />
      {data?.note && <Notice>{data.note}</Notice>}
      <div className="toolbar">
        <SearchField label="Search foods" value={query} onChange={setQuery} placeholder="Food name" />
        {data && data.categories.length > 0 && (
          <label className="field-wrap" style={{ width: 'auto' }}>
            <span className="sr-only">Category</span>
            <select className="field-input" style={{ paddingLeft: 12 }} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="All">All categories</option>
              {data.categories.map((c) => <option key={c.label} value={c.label}>{c.label} ({c.n})</option>)}
            </select>
          </label>
        )}
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <section className="panel">
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
