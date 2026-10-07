import { pantryCovers, pantryHasIngredient } from '../ingredientMatch';

describe('pantryCovers', () => {
  it.each([
    ['chicken', 'chicken thighs and legs'],
    ['Chicken', 'chicken, cut into pieces'],
    ['chicken thighs', 'chicken thighs and legs'],
    ['beef', 'beef tenderloin'],
    ['beef', 'beef sirloin, thinly sliced'],
    ['pork', 'ground pork'],
    ['pork', 'chicken or pork, sliced'],
    ['chicken thighs', 'chicken'],
    ['Eggs', 'egg, beaten'],
    ['tomatoes', 'tomato, chopped'],
    ['garlic', 'garlic, minced'],
    ['onion', 'garlic and onion, minced'],
    ['bangus', 'bangus or tilapia'],
    ['kalabasa', 'kalabasa (squash), cubed'],
    ['beef', 'oxtail'],
    ['chicken thighs', 'chicken pieces'],
    ['chicken thighs', 'chicken breast'],
    ['Chicken Thighs', 'chicken, cut into pieces'],
    ['chicken thighs', 'bone-in chicken legs'],
    ['oxtail', 'beef brisket'],
    ['pork belly', 'pork shoulder, cubed'],
    ['beef', 'beef oxtail'],
    ['oxtail', 'beef'],
    ['oxtail', 'beef oxtail'],
    ['pork', 'liempo'],
    ['pork', 'pork leg (pata)'],
    ['chicken', 'thighs'],
    ['fish', 'bangus or tilapia'],
    ['fish', 'tilapia or galunggong'],
    ['milkfish', 'bangus, butterflied'],
    ['Milk Fish', 'whole bangus or tilapia'],
    ['bangus', 'milkfish'],
    ['tilapia', 'tilapia or galunggong'],
    ['tilapia', 'fish'],
    ['fish', 'bangus, butterflied'],
  ])('%s covers %s', (pantry, ingredient) => {
    expect(pantryCovers(pantry, ingredient)).toBe(true);
  });

  it.each([
    ['chicken', 'chicken broth'],
    ['chicken broth', 'chicken'],
    ['beef', 'beef tapa'],
    ['milk', 'coconut milk'],
    ['coconut', 'coconut milk'],
    ['tomato', 'tomato sauce'],
    ['garlic', 'garlic powder'],
    ['rice', 'rice noodles (bihon)'],
    ['egg', 'eggplant'],
    ['egg', 'quail eggs, boiled (optional)'],
    ['onion', 'green onion'],
    ['pork', 'pork liver'],
    ['pork', 'oxtail'],
    ['fish', 'fish sauce'],
    ['chicken thighs', 'chicken liver'],
    ['chicken thighs', 'chicken broth'],
    ['pork belly', 'beef chuck'],
    ['green beans', 'green papaya'],
    ['milkfish', 'milk'],
    ['milkfish', 'tilapia or galunggong'],
    ['bangus', 'tilapia or galunggong'],
    ['tilapia', 'bangus, butterflied'],
  ])('%s does not cover %s', (pantry, ingredient) => {
    expect(pantryCovers(pantry, ingredient)).toBe(false);
  });
});

describe('pantryHasIngredient', () => {
  it('looks across the whole shelf', () => {
    expect(pantryHasIngredient('beef chuck, cubed', ['chicken thighs', 'beef'])).toBe(true);
    expect(pantryHasIngredient('soy sauce', ['chicken thighs', 'beef'])).toBe(false);
  });
});
