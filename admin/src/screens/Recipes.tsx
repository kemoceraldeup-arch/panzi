import { AnimatedNumber } from '../components/AnimatedNumber';
import { useCallback, useMemo, useState } from 'react';
import { Bookmark, CookingPot, Star } from 'lucide-react';
import { getRecipes } from '../api';
import { Empty, ErrorState, Loading, Notice, PageHead, SearchField } from '../components/pz';
import { downloadCsv } from '../lib/csv';
import { matches } from '../lib/format';
import { useResource } from '../lib/useResource';

/** The photo the app shows: an uploaded or generated one by URL, else the
 *  app's own dish photo (shipped here in public/recipes, keyed like the app's
 *  assets). A dish without either, or one that fails to load, gets a plain
 *  placeholder. */
function Thumb({ photo, photoUrl }: { photo?: string; photoUrl?: string | null }) {
  const [failed, setFailed] = useState(false);
  const src = photoUrl ?? (photo ? `${import.meta.env.BASE_URL}recipes/${photo}.jpg` : null);
  if (src && !failed) return <img className="recipe-thumb" src={src} alt="" onError={() => setFailed(true)} />;
  return <span className="recipe-thumb blank" aria-hidden="true"><CookingPot className="i" /></span>;
}

export function Recipes() {
  const { data, error, loading, reload, updatedAt } = useResource(useCallback(() => getRecipes(), []), []);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('saved');
  const recipes = useMemo(() => (data?.recipes ?? []).filter((r) => matches(query, r.name)).sort((a, b) => sort === 'rating' ? (b.stars ?? -1) - (a.stars ?? -1) : sort === 'name' ? a.name.localeCompare(b.name) : b.saves - a.saves), [data, query, sort]);

  const exportRows = () => downloadCsv('panzi-recipes.csv', ['Dish', 'Ingredients', 'Saved', 'Ratings', 'Average stars', 'Last activity'],
    recipes.map((r) => [r.name, r.ing, r.saves, r.rated, r.stars ?? '', r.lastAt ?? '']));

  return (
    <>
      <PageHead
        title="Recipes"
        text="From pantry staples to favorite meals. Explore the dishes people save and rate after cooking."
        updatedAt={updatedAt}
        tools={<button className="btn" type="button" onClick={exportRows} disabled={!recipes.length}>Export CSV</button>}
      />
      {data?.note && <Notice>{data.note}</Notice>}
      {data && <section className="panel strip" aria-label="Recipe summary">
        <div className="metric"><div className="metric-label">Dishes in the collection</div><div className="metric-value"><AnimatedNumber value={data.recipes.length.toLocaleString()} /></div><div className="metric-note">Saved or rated by the community</div></div>
        <div className="metric"><div className="metric-label">Total saves</div><div className="metric-value"><AnimatedNumber value={data.recipes.reduce((sum, r) => sum + r.saves, 0).toLocaleString()} /></div><div className="metric-note">Across these dishes</div></div>
        <div className="metric"><div className="metric-label">Cooking ratings</div><div className="metric-value"><AnimatedNumber value={data.recipes.reduce((sum, r) => sum + r.rated, 0).toLocaleString()} /></div><div className="metric-note">Feedback after cooking</div></div>
      </section>}
      <div className="toolbar"><SearchField label="Search dishes" value={query} onChange={setQuery} placeholder="Find a recipe…" /><label className="field-wrap"><span className="sr-only">Sort recipes</span><select className="field-input" value={sort} onChange={e => setSort(e.target.value)}><option value="saved">Most saved</option><option value="rating">Highest rated</option><option value="name">Name: A to Z</option></select></label></div>
      {loading && !data && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <section aria-label="Recipe collection">
          {recipes.length === 0 ? <Empty title={data.recipes.length ? 'No dish matches that search' : 'No saved or rated dishes yet'} /> : (
            <div className="recipe-grid">
                  {recipes.map((r) => (
                    <article className="recipe-card" key={r.id}>
                      <div className="recipe-photo"><Thumb photo={r.photo} photoUrl={r.photoUrl} /><span className="recipe-rating"><Star className="i" aria-hidden="true" />{r.stars === null ? 'Not rated' : `${r.stars.toFixed(1)} / 5`}</span></div>
                      <div className="recipe-content"><h2>{r.name}</h2><p>{r.ing} ingredients{r.version ? ` · ${r.version}` : ''}</p>
                        <div className="recipe-numbers"><span><Bookmark className="i" /><b>{r.saves}</b> saves</span><span><CookingPot className="i" /><b>{r.rated}</b> ratings</span></div>
                        <div className="recipe-date">Last activity · {r.lastAt ? new Date(r.lastAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'No activity yet'}</div>
                      </div>
                    </article>
                  ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
