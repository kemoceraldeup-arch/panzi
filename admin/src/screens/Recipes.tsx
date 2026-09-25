import { useCallback, useMemo, useState } from 'react';
import { CookingPot, Star } from 'lucide-react';
import { getRecipes } from '../api';
import { Empty, ErrorState, Loading, Notice, PageHead, SearchField } from '../components/pz';
import { downloadCsv } from '../lib/csv';
import { matches } from '../lib/format';
import { useResource } from '../lib/useResource';

/** Dish photos ship in public/recipes, keyed like the app's assets. A dish
 *  without one, or a photo that fails to load, gets a plain placeholder. */
function Thumb({ photo }: { photo?: string }) {
  const [failed, setFailed] = useState(false);
  if (photo && !failed) return <img className="recipe-thumb" src={`${import.meta.env.BASE_URL}recipes/${photo}.jpg`} alt="" onError={() => setFailed(true)} />;
  return <span className="recipe-thumb blank" aria-hidden="true"><CookingPot className="i" /></span>;
}

export function Recipes() {
  const { data, error, loading, reload, updatedAt } = useResource(useCallback(() => getRecipes(), []), []);
  const [query, setQuery] = useState('');
  const recipes = useMemo(() => (data?.recipes ?? []).filter((r) => matches(query, r.name)), [data, query]);

  const exportRows = () => downloadCsv('panzi-recipes.csv', ['Dish', 'Ingredients', 'Saved', 'Ratings', 'Average stars', 'Last activity'],
    recipes.map((r) => [r.name, r.ing, r.saves, r.rated, r.stars ?? '', r.lastAt ?? '']));

  return (
    <>
      <PageHead
        title="Recipes"
        text="Dishes people saved, and how they rated them after cooking. Each dish is written by the model when it is suggested, so the title is its only identity."
        updatedAt={updatedAt}
        tools={<button className="btn" type="button" onClick={exportRows} disabled={!recipes.length}>Export CSV</button>}
      />
      {data?.note && <Notice>{data.note}</Notice>}
      <div className="toolbar"><SearchField label="Search dishes" value={query} onChange={setQuery} placeholder="Dish name" /></div>
      {loading && !data && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <section className="panel">
          {recipes.length === 0 ? <Empty title={data.recipes.length ? 'No dish matches that search' : 'No saved or rated dishes yet'} /> : (
            <div className="table-wrap" role="region" aria-label="Recipes" tabIndex={0}>
              <table>
                <thead><tr><th>Dish</th><th className="r">Ingredients</th><th className="r">Saved by</th><th className="r">Ratings</th><th>Average rating</th><th>Last activity</th></tr></thead>
                <tbody>
                  {recipes.map((r) => (
                    <tr key={r.id}>
                      <td><div className="person"><Thumb photo={r.photo} /><span><span className="cell-strong">{r.name}</span>{r.version && <span className="cell-sub" title="A different recipe with the same name, told apart by its ingredients">{r.version}</span>}</span></div></td>
                      <td className="r">{r.ing}</td>
                      <td className="r">{r.saves}</td>
                      <td className="r">{r.rated}</td>
                      <td>{r.stars === null ? <span className="chip">No ratings yet</span>
                        : <span aria-label={`${r.stars} out of 5`} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Star className="i" aria-hidden="true" style={{ width: 15, height: 15 }} />{r.stars.toFixed(1)}</span>}</td>
                      <td>{r.lastAt ? new Date(r.lastAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'No activity'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
