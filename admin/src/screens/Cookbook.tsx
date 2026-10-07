import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { CookingPot, ImagePlus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { createCookbookRecipe, deleteCookbookRecipe, getCookbook, updateCookbookRecipe } from '../api';
import { ApiError } from '../api/client';
import type { CookbookCategory, CookbookInput, CookbookRecipe } from '../api/types';
import { Drawer, Empty, ErrorState, Loading, Notice, PageHead, SearchField, Segmented, useToast } from '../components/pz';
import { matches } from '../lib/format';
import { useResource } from '../lib/useResource';

// The cookbook on the app's Recipes screen: the one page in the console that
// changes what people see in the app. Create and Update share the side
// panel's form; Delete asks once, in the row, before anything is removed.
// The server checks every save again (server/src/cookbook.ts), so the form
// only catches what it can say sooner.

export const CATEGORY_WORD: Record<CookbookCategory, string> = { ulam: 'Main Dish', quick: 'Quick and Easy', merienda: 'Snacks' };
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'ulam', label: 'Main Dish' },
  { value: 'quick', label: 'Quick and Easy' },
  { value: 'merienda', label: 'Snacks' },
] as const;
type Filter = (typeof FILTERS)[number]['value'];

/** An uploaded photo first, then the dish photo the console ships for the
 *  app's own dishes, then a plain placeholder. */
function Thumb({ recipe, size = 40 }: { recipe: Pick<CookbookRecipe, 'photoUrl' | 'dishKey'>; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = recipe.photoUrl ?? (recipe.dishKey !== 'other' ? `${import.meta.env.BASE_URL}recipes/${recipe.dishKey}.jpg` : null);
  const style = { width: size, height: size };
  if (src && !failed) return <img className="cookbook-thumb" style={style} src={src} alt="" onError={() => setFailed(true)} />;
  return <span className="cookbook-thumb blank" style={style} aria-hidden="true"><CookingPot className="i" /></span>;
}

type Editing = { mode: 'create' } | { mode: 'edit'; recipe: CookbookRecipe };

export function Cookbook() {
  const toast = useToast();
  const { data, error, loading, reload, updatedAt } = useResource(useCallback(() => getCookbook(), []), []);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const all = data?.recipes ?? [];
  const rows = useMemo(
    () => all.filter((r) => (filter === 'all' || r.category === filter) && matches(query, `${r.title} ${r.description} ${r.ingredients.map((i) => i.name).join(' ')}`)),
    [all, filter, query]
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length, ulam: 0, quick: 0, merienda: 0 };
    for (const r of all) c[r.category]++;
    return c;
  }, [all]);
  const filters = FILTERS.map((f) => ({ value: f.value, label: data ? `${f.label} (${counts[f.value]})` : f.label }));

  async function remove(recipe: CookbookRecipe) {
    setDeleting(true);
    setProblem(null);
    try {
      await deleteCookbookRecipe(recipe.id);
      toast(`Deleted ${recipe.title}. It is gone from the app.`);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
      setConfirmId(null);
      reload();
    }
  }

  return (
    <>
      <PageHead
        title="Cookbook"
        text="The recipes people see on the app's Recipes screen. Add, edit or delete a dish here, and the app shows the change the next time someone opens or pulls down that screen."
        updatedAt={updatedAt}
        tools={<>
          <button className="btn" type="button" onClick={reload}>Refresh</button>
          <button className="btn primary" type="button" onClick={() => setEditing({ mode: 'create' })}><Plus className="i" aria-hidden="true" />Add recipe</button>
        </>}
      />
      <div className="toolbar">
        <SearchField label="Search the cookbook" value={query} onChange={setQuery} placeholder="Dish, description or ingredient" />
        <Segmented label="Category" options={filters} value={filter} onChange={setFilter} />
      </div>
      {problem && <Notice tone="warn">{problem}</Notice>}
      {loading && !data && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <section className="panel">
          {rows.length === 0 ? (
            <Empty title={all.length === 0 ? 'The cookbook is empty' : 'No recipe matches'}>
              {all.length === 0
                ? 'Add the first recipe, or run "npm run seed:cookbook" in the server folder to copy in the dishes built into the app.'
                : 'Try another word or category.'}
            </Empty>
          ) : (
            <div className="table-wrap" role="region" aria-label="Cookbook recipes" tabIndex={0}>
              <table className="cookbook-table">
                <thead><tr><th>Dish</th><th>Category</th><th className="r">Minutes</th><th className="r">Serves</th><th className="r">Ingredients</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {rows.map((r) => r.id === confirmId ? (
                    <tr key={r.id} className="cookbook-confirm">
                      <td colSpan={6}>
                        <div className="confirm">
                          <p>Delete <b>{r.title}</b>? It disappears from everyone's app. This cannot be undone.</p>
                          <div className="detail-actions">
                            <button className="btn" type="button" onClick={() => setConfirmId(null)} disabled={deleting} autoFocus>Cancel</button>
                            <button className="btn primary danger-fill" type="button" onClick={() => void remove(r)} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete recipe'}</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={r.id}>
                      <td>
                        <div className="cookbook-dish">
                          <Thumb recipe={r} />
                          <div><span className="cell-strong">{r.title}</span><span className="cell-sub">{r.description || 'No description'}</span></div>
                        </div>
                      </td>
                      <td><span className="chip">{CATEGORY_WORD[r.category]}</span></td>
                      <td className="r">{r.minutes}</td>
                      <td className="r">{r.servings}</td>
                      <td className="r">{r.ingredients.length}</td>
                      <td>
                        <div className="cookbook-actions">
                          <button className="btn small" type="button" onClick={() => { setProblem(null); setEditing({ mode: 'edit', recipe: r }); }} aria-label={`Edit ${r.title}`}><Pencil className="i" aria-hidden="true" />Edit</button>
                          <button className="btn small danger" type="button" onClick={() => { setProblem(null); setConfirmId(r.id); }} aria-label={`Delete ${r.title}`}><Trash2 className="i" aria-hidden="true" />Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {editing && (
        <RecipeForm
          key={editing.mode === 'edit' ? editing.recipe.id : 'new'}
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={(recipe, created) => {
            toast(created ? `Added ${recipe.title}. It is now in the app.` : `Saved ${recipe.title}. The app shows the change.`);
            setEditing(null);
            reload();
          }}
          onConflict={reload}
        />
      )}
    </>
  );
}

/* ── Form (Create and Update) ───────────────── */

type IngredientRow = { amount: string; name: string };

/** Shrinks a picked photo to at most 1000px on its long side, as JPEG, and
 *  returns the base64 without its data: prefix. Phones take 4000px photos; a
 *  recipe card needs nowhere near that, and the server caps the size. */
async function shrinkToJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That file is not a picture this browser can open.'));
      img.src = url;
    });
    const scale = Math.min(1, 1000 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

function RecipeForm({ editing, onClose, onSaved, onConflict }: {
  editing: Editing;
  onClose: () => void;
  onSaved: (recipe: CookbookRecipe, created: boolean) => void;
  onConflict: () => void;
}) {
  const start = editing.mode === 'edit' ? editing.recipe : null;
  const [title, setTitle] = useState(start?.title ?? '');
  const [category, setCategory] = useState<CookbookCategory>(start?.category ?? 'ulam');
  const [minutes, setMinutes] = useState(start ? String(start.minutes) : '');
  const [servings, setServings] = useState(start ? String(start.servings) : '');
  const [description, setDescription] = useState(start?.description ?? '');
  const [ingredients, setIngredients] = useState<IngredientRow[]>(start?.ingredients.length ? start.ingredients.map((i) => ({ ...i })) : [{ amount: '', name: '' }]);
  const [steps, setSteps] = useState<string[]>(start?.steps.length ? [...start.steps] : ['']);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const shownPhoto = photoBase64 ? `data:image/jpeg;base64,${photoBase64}` : removePhoto ? null : start?.photoUrl ?? null;

  const setIngredient = (index: number, field: keyof IngredientRow, value: string) =>
    setIngredients((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  const setStep = (index: number, value: string) => setSteps((rows) => rows.map((row, i) => (i === index ? value : row)));

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    try {
      setPhotoBase64(await shrinkToJpeg(file));
      setRemovePhoto(false);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: CookbookInput = {
      title: title.trim(),
      category,
      minutes: Number(minutes),
      servings: Number(servings),
      description: description.trim(),
      ingredients: ingredients.filter((i) => i.name.trim() || i.amount.trim()),
      steps: steps.map((s) => s.trim()).filter(Boolean),
      ...(photoBase64 ? { photoBase64 } : {}),
      ...(removePhoto ? { removePhoto: true } : {}),
    };
    // The few things worth saying before a round trip. Everything else the
    // server checks and explains.
    if (!input.title) return setProblem('Give the recipe a name.');
    if (!minutes || !servings) return setProblem('Fill in minutes and how many it serves.');
    if (!input.ingredients.length) return setProblem('Add at least one ingredient.');
    if (!input.steps.length) return setProblem('Add at least one step.');

    setSaving(true);
    setProblem(null);
    try {
      const { recipe } = editing.mode === 'edit'
        ? await updateCookbookRecipe(editing.recipe.id, editing.recipe.revision, input)
        : await createCookbookRecipe(input);
      onSaved(recipe, editing.mode === 'create');
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'cookbook-conflict' || err.code === 'not-found')) onConflict();
      setProblem(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={editing.mode === 'edit' ? `Edit ${editing.recipe.title}` : 'Add a recipe'}
      subtitle={editing.mode === 'edit' ? 'Changes show in the app after you save.' : 'It appears at the top of its category in the app.'}
      onClose={onClose}
    >
      <form className="cookbook-form" onSubmit={(e) => void submit(e)} noValidate>
        <div className="field">
          <label htmlFor="cb-title">Recipe name</label>
          <input id="cb-title" className="field-input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pork barbecue" />
        </div>

        <div className="cookbook-row3">
          <div className="field">
            <label htmlFor="cb-category">Category</label>
            <select id="cb-category" className="field-input" value={category} onChange={(e) => setCategory(e.target.value as CookbookCategory)}>
              {(Object.keys(CATEGORY_WORD) as CookbookCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_WORD[c]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cb-minutes">Minutes</label>
            <input id="cb-minutes" className="field-input" type="number" inputMode="numeric" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="cb-servings">Serves</label>
            <input id="cb-servings" className="field-input" type="number" inputMode="numeric" min={1} max={30} value={servings} onChange={(e) => setServings(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <span className="label">Photo</span>
          <div className="cookbook-photo">
            {shownPhoto ? <img src={shownPhoto} alt="" /> : start ? <Thumb recipe={{ photoUrl: null, dishKey: start.dishKey }} size={72} /> : <span className="cookbook-thumb blank" style={{ width: 72, height: 72 }} aria-hidden="true"><CookingPot className="i" /></span>}
            <div className="cookbook-photo-actions">
              <label className="btn small" htmlFor="cb-photo"><ImagePlus className="i" aria-hidden="true" />{shownPhoto ? 'Change photo' : 'Upload photo'}</label>
              <input id="cb-photo" className="sr-only" type="file" accept="image/*" onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
              {shownPhoto && <button className="btn small" type="button" onClick={() => { setPhotoBase64(null); setRemovePhoto(Boolean(start?.photoUrl)); }}>Remove photo</button>}
              <span className="hint">{shownPhoto ? 'Shown on the recipe card in the app.' : start && start.dishKey !== 'other' ? 'Using the photo built into the app.' : 'Without a photo the app shows a colored tile.'}</span>
            </div>
          </div>
        </div>

        <div className="field">
          <label htmlFor="cb-description">Short description</label>
          <textarea id="cb-description" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} placeholder="What the dish is, in one sentence." style={{ minHeight: 64 }} />
        </div>

        <fieldset className="cookbook-list">
          <legend>Ingredients</legend>
          {ingredients.map((row, i) => (
            <div className="cookbook-ingredient" key={i}>
              <input className="field-input" aria-label={`Amount for ingredient ${i + 1}`} placeholder="Amount" value={row.amount} maxLength={40} onChange={(e) => setIngredient(i, 'amount', e.target.value)} />
              <input className="field-input" aria-label={`Ingredient ${i + 1}`} placeholder="Ingredient" value={row.name} maxLength={80} onChange={(e) => setIngredient(i, 'name', e.target.value)} />
              <button className="icon-btn" type="button" aria-label={`Remove ingredient ${i + 1}`} disabled={ingredients.length === 1} onClick={() => setIngredients((rows) => rows.filter((_, j) => j !== i))}><X className="i" aria-hidden="true" /></button>
            </div>
          ))}
          <button className="btn small" type="button" onClick={() => setIngredients((rows) => [...rows, { amount: '', name: '' }])} disabled={ingredients.length >= 40}><Plus className="i" aria-hidden="true" />Add ingredient</button>
        </fieldset>

        <fieldset className="cookbook-list">
          <legend>Steps</legend>
          {steps.map((step, i) => (
            <div className="cookbook-step" key={i}>
              <span className="cookbook-step-n" aria-hidden="true">{i + 1}</span>
              <textarea aria-label={`Step ${i + 1}`} value={step} maxLength={500} onChange={(e) => setStep(i, e.target.value)} placeholder="What to do" />
              <button className="icon-btn" type="button" aria-label={`Remove step ${i + 1}`} disabled={steps.length === 1} onClick={() => setSteps((rows) => rows.filter((_, j) => j !== i))}><X className="i" aria-hidden="true" /></button>
            </div>
          ))}
          <button className="btn small" type="button" onClick={() => setSteps((rows) => [...rows, ''])} disabled={steps.length >= 30}><Plus className="i" aria-hidden="true" />Add step</button>
        </fieldset>

        {problem && <Notice tone="warn">{problem}</Notice>}
        <div className="detail-actions cookbook-submit">
          <button className="btn" type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" type="submit" disabled={saving}>{saving ? 'Saving…' : editing.mode === 'edit' ? 'Save changes' : 'Add recipe'}</button>
        </div>
      </form>
    </Drawer>
  );
}
