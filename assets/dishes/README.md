# Dish photos

One photo per dish, named after its key in `src/theme/dishPhotos.ts`.

Empty right now, and the app works fine that way — every dish without a photo
falls back to the gradient tile. Fill this folder at your own pace; each photo
lights up on its own.

## Adding one

1. Save the image here as `<key>.jpg` — exactly the key from `DISH_KEYS`, e.g.
   `adobo.jpg`, `pancit_canton.jpg`, `tortang_talong.jpg`.
2. Open `src/theme/dishPhotos.ts` and uncomment that dish's line in `PHOTOS`.
3. Restart the bundler. Metro caches the asset list, so a new file added while
   it is running will not be picked up.

**A `require` pointing at a file that is not here is a build error, not a blank
image.** Uncomment the line only after the file exists.

## What the photos should be

- **Landscape**, roughly 3:2. The tiles are wide and short; a portrait photo
  gets cropped through the middle of the dish.
- **About 900 px wide** and re-saved as JPEG at quality ~80. That lands near
  80 KB. Fifty of those is about 4 MB of app, which is fine; fifty untouched
  phone photos is 200 MB, which is not.
- **The food filling the frame**, shot from above or at a slight angle. These
  render as small as 64 px on the mini cards, so a plate lost in a wide table
  shot turns into a beige square.
- **Darker or busier at the bottom is fine** — text sits over the lower third
  with a scrim behind it.

## Where to get them, legally

You cannot use a photo pulled off a food blog or a Google image search. Those
are someone's copyrighted work, and a school project is still publication.

Three sources that are actually safe:

- **Your own camera.** Best option by a distance. Real photos of the food your
  household actually cooks will look better than stock and are unambiguously
  yours. Filipino dishes are also badly served by stock libraries, so this is
  often the only way to get an accurate picture of, say, ginisang munggo.
- **Wikimedia Commons** — good coverage of Filipino dishes. Check each file's
  licence: CC0 needs nothing, CC-BY needs credit. Keep a note of which is which.
- **Pexels / Unsplash** — free for commercial use, no attribution required.
  Coverage of Filipino food is thin, so expect to find spaghetti and fried
  chicken and not much else.

If a photo needs attribution, record it in `CREDITS.md` next to this file as you
add it. Reconstructing that list later from fifty files is miserable.
