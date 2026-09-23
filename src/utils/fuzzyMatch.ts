// src/utils/fuzzyMatch.ts
//
// Typo-tolerant text matching for the Recipes search bar. Plain substring
// matching (what ListScreen's pantry search already does) is the right
// choice when the user is scanning their own kitchen and knows exactly what
// they typed in — a pantry item's name doesn't have "the right spelling" to
// get wrong. A dish name is different: "adboo", "sinigan", "cadereta" are
// real typing mistakes a user makes reaching for a Filipino dish name from
// memory, and a search that goes silent on the first misspelled letter reads
// as broken, not strict.
//
// The approach: split the query into words, and for each query word accept
// either a substring hit anywhere in the target text, or a whole target word
// within a small edit-distance budget that scales with the query word's own
// length (typo tolerance for "kaldereta" should not also tolerate "cake"
// matching "bake" — a 1-letter typo on a 4-letter word is a different word,
// not a misspelling). Every query word must find some match for the
// candidate to pass at all, so "beef adboo" still requires both "beef" and
// something close to "adobo" to appear.

/** Iterative Damerau-Levenshtein distance — single-character edits (insert,
 *  delete, substitute) plus adjacent transposition counted as one edit, not
 *  two. Transposing a pair of letters ("adboo" for "adobo") is one of the
 *  most common ways real typing mistakes happen, and counting it as two
 *  plain substitutions was pushing exactly that kind of typo outside a
 *  5-letter word's 1-edit budget. Small inputs only (query words and single
 *  dish-name words), so the full O(n*m) table is plenty fast. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const alen = a.length;
  const blen = b.length;
  if (alen === 0) return blen;
  if (blen === 0) return alen;

  // Needs the previous two rows (not one) to price a transposition, so this
  // keeps the full table rather than the two-row rolling version above.
  const d: number[][] = Array.from({ length: alen + 1 }, () => new Array(blen + 1).fill(0));
  for (let i = 0; i <= alen; i++) d[i][0] = i;
  for (let j = 0; j <= blen; j++) d[0][j] = j;

  for (let i = 1; i <= alen; i++) {
    for (let j = 1; j <= blen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        d[i - 1][j] + 1, // deletion
        d[i][j - 1] + 1, // insertion
        d[i - 1][j - 1] + cost // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2][j - 2] + 1); // adjacent transposition
      }
      d[i][j] = best;
    }
  }
  return d[alen][blen];
}

/** How many typo'd characters a word of this length is allowed before it no
 *  longer counts as "the same word" — short words have almost no slack (a
 *  3-letter word one edit away from another 3-letter word is often just a
 *  different word), longer ones can absorb a couple of real mistakes. */
function typoBudget(wordLength: number): number {
  if (wordLength <= 3) return 0;
  if (wordLength <= 5) return 1;
  return 2;
}

const WORD_SPLIT = /[^a-z0-9]+/;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(WORD_SPLIT)
    .filter((w) => w.length > 0);
}

/** Whether a single query word is satisfied somewhere in the candidate's
 *  words — an exact substring anywhere (covers "adob" -> "adobo", plurals,
 *  partial typing as the user is still typing) or a whole candidate word
 *  within that query word's typo budget. */
function queryWordMatches(queryWord: string, candidateWords: string[], candidateText: string): boolean {
  if (candidateText.includes(queryWord)) return true;
  const budget = typoBudget(queryWord.length);
  if (budget === 0) return false;
  return candidateWords.some((w) => Math.abs(w.length - queryWord.length) <= budget && editDistance(queryWord, w) <= budget);
}

/**
 * True when every word in `query` is satisfied — by substring or typo-
 * tolerant whole-word match — somewhere in `text`. Empty query always
 * matches (nothing to filter on yet).
 */
export function fuzzyMatches(query: string, text: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const queryWords = words(q);
  if (queryWords.length === 0) return true;

  const candidateText = text.toLowerCase();
  const candidateWords = words(candidateText);

  return queryWords.every((qw) => queryWordMatches(qw, candidateWords, candidateText));
}

/**
 * Same test as fuzzyMatches, but against several fields at once (title,
 * description, ingredient names, ...) — true as soon as any one field alone
 * satisfies the whole query, so "adobo" matching only the title is enough
 * without also needing to appear in the description.
 */
export function fuzzyMatchesAny(query: string, fields: string[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((field) => fuzzyMatches(q, field));
}
