// src/theme/dishPhotos.ts
//
// Real photographs, for the dishes we have one of.
//
// The problem with photos on a recipe card is not finding them, it is matching
// them. Matching on the title fails the moment the model writes "Filipino
// spaghetti" one night and "Sweet Filipino spaghetti with hotdogs" the next,
// and a near-miss that shows the wrong food is worse than showing none —
// the user believes the picture.
//
// So the model names the dish from the fixed list below instead of describing
// it. A key either resolves to a photo we chose on purpose or it resolves to
// nothing, and nothing falls back to the gradient tile in dishLooks.ts. There
// is no fuzzy middle where a wrong picture can appear.
//
// The list is Filipino home cooking's common core, not a complete cuisine.
// Anything outside it comes back as `other` and gets a tile, which is a fine
// outcome — the tile was the whole design before photos existed.

import { ImageSourcePropType } from 'react-native';

export const DISH_KEYS = [
  // Ulam — meat
  'adobo',
  'sinigang',
  'tinola',
  'nilaga',
  'bulalo',
  'kare_kare',
  'menudo',
  'afritada',
  'kaldereta',
  'pochero',
  'sisig',
  'lechon_kawali',
  'crispy_pata',
  'pork_bbq',
  'longganisa',
  'tocino',
  'tapa',
  'bistek',
  'fried_chicken',
  'chicken_curry',
  'ginataang_manok',
  // Ulam — fish
  'paksiw',
  'inihaw_na_isda',
  'daing',
  'fried_fish',
  // Gulay
  'pinakbet',
  'chopsuey',
  'laing',
  'ginisang_munggo',
  'ginisang_gulay',
  'tortang_talong',
  // Pancit and pasta
  'pancit_canton',
  'pancit_bihon',
  'lomi',
  'spaghetti',
  'carbonara',
  // Rice and almusal
  'sinangag',
  'silog',
  'arroz_caldo',
  'lugaw',
  'goto',
  'champorado',
  // Merienda
  'lumpiang_shanghai',
  'empanada',
  'siomai',
  'turon',
  'banana_cue',
  'bibingka',
  'puto',
  'pandesal',
  // Panghimagas
  'leche_flan',
  'halo_halo',
  // Nothing on the list fits.
  'other',
] as const;

export type DishKey = (typeof DISH_KEYS)[number];

/**
 * The photo for a dish, when there is one.
 *
 * `require` paths must be literal — the bundler resolves them at build time, so
 * this cannot be built from a loop or a template string, and a `require` of a
 * file that is not there is a **build error**, not a blank image. Add the file
 * to assets/dishes/ first, then uncomment its line. See the README in that
 * folder.
 *
 * Every key is listed and commented out rather than left absent, so adding a
 * photo is deleting two slashes rather than remembering the exact path.
 */
const PHOTOS: Partial<Record<DishKey, ImageSourcePropType>> = {
  // adobo: require('../../assets/dishes/adobo.jpg'),
  // sinigang: require('../../assets/dishes/sinigang.jpg'),
  // tinola: require('../../assets/dishes/tinola.jpg'),
  // nilaga: require('../../assets/dishes/nilaga.jpg'),
  // bulalo: require('../../assets/dishes/bulalo.jpg'),
  // kare_kare: require('../../assets/dishes/kare_kare.jpg'),
  // menudo: require('../../assets/dishes/menudo.jpg'),
  // afritada: require('../../assets/dishes/afritada.jpg'),
  // kaldereta: require('../../assets/dishes/kaldereta.jpg'),
  // pochero: require('../../assets/dishes/pochero.jpg'),
  // sisig: require('../../assets/dishes/sisig.jpg'),
  // lechon_kawali: require('../../assets/dishes/lechon_kawali.jpg'),
  // crispy_pata: require('../../assets/dishes/crispy_pata.jpg'),
  // pork_bbq: require('../../assets/dishes/pork_bbq.jpg'),
  // longganisa: require('../../assets/dishes/longganisa.jpg'),
  // tocino: require('../../assets/dishes/tocino.jpg'),
  // tapa: require('../../assets/dishes/tapa.jpg'),
  // bistek: require('../../assets/dishes/bistek.jpg'),
  // fried_chicken: require('../../assets/dishes/fried_chicken.jpg'),
  // chicken_curry: require('../../assets/dishes/chicken_curry.jpg'),
  // ginataang_manok: require('../../assets/dishes/ginataang_manok.jpg'),
  // paksiw: require('../../assets/dishes/paksiw.jpg'),
  // inihaw_na_isda: require('../../assets/dishes/inihaw_na_isda.jpg'),
  // daing: require('../../assets/dishes/daing.jpg'),
  // fried_fish: require('../../assets/dishes/fried_fish.jpg'),
  // pinakbet: require('../../assets/dishes/pinakbet.jpg'),
  // chopsuey: require('../../assets/dishes/chopsuey.jpg'),
  // laing: require('../../assets/dishes/laing.jpg'),
  // ginisang_munggo: require('../../assets/dishes/ginisang_munggo.jpg'),
  // ginisang_gulay: require('../../assets/dishes/ginisang_gulay.jpg'),
  // tortang_talong: require('../../assets/dishes/tortang_talong.jpg'),
  // pancit_canton: require('../../assets/dishes/pancit_canton.jpg'),
  // pancit_bihon: require('../../assets/dishes/pancit_bihon.jpg'),
  // lomi: require('../../assets/dishes/lomi.jpg'),
  // spaghetti: require('../../assets/dishes/spaghetti.jpg'),
  // carbonara: require('../../assets/dishes/carbonara.jpg'),
  // sinangag: require('../../assets/dishes/sinangag.jpg'),
  // silog: require('../../assets/dishes/silog.jpg'),
  // arroz_caldo: require('../../assets/dishes/arroz_caldo.jpg'),
  // lugaw: require('../../assets/dishes/lugaw.jpg'),
  // goto: require('../../assets/dishes/goto.jpg'),
  // champorado: require('../../assets/dishes/champorado.jpg'),
  // lumpiang_shanghai: require('../../assets/dishes/lumpiang_shanghai.jpg'),
  // empanada: require('../../assets/dishes/empanada.jpg'),
  // siomai: require('../../assets/dishes/siomai.jpg'),
  // turon: require('../../assets/dishes/turon.jpg'),
  // banana_cue: require('../../assets/dishes/banana_cue.jpg'),
  // bibingka: require('../../assets/dishes/bibingka.jpg'),
  // puto: require('../../assets/dishes/puto.jpg'),
  // pandesal: require('../../assets/dishes/pandesal.jpg'),
  // leche_flan: require('../../assets/dishes/leche_flan.jpg'),
  // halo_halo: require('../../assets/dishes/halo_halo.jpg'),
};

/** Validates whatever the model or an old cached suggestion sent. */
export function dishKeyFor(value: unknown): DishKey {
  return DISH_KEYS.includes(value as DishKey) ? (value as DishKey) : 'other';
}

/** The photo for a dish, or null when we don't have one yet. Null is the
 *  normal case until the folder is filled, and the tile handles it. */
export function dishPhoto(value: unknown): ImageSourcePropType | null {
  return PHOTOS[dishKeyFor(value)] ?? null;
}
