# Panzi admin design

The authenticated workspace follows the Panzi mobile app in the supplied handoff. The login, authentication behavior, and global login stylesheet are unchanged.

## Brand and layout

- src/styles/workspace.css adapts the app's warm cream (#FFF8E8), pantry green (#3E7D2A), fresh green (#6CBF3F), and peach accents. Dark mode uses the app's warm charcoal surfaces.
- Locally hosted Nunito is the body font; Baloo 2 is used for headings. Private font-family names keep the login unchanged.
- Reuse PageHead, Panel, Segmented, SearchField, Pager, Drawer, and charts from components/pz.tsx. New styles are scoped to .pz.
- Eight screens: Dashboard, Pantry, Recipes, Users, Food outcomes, API costs, System logs, and Settings. Conversations and Needs review have no screen, navigation item, command-search result, or dashboard link. Previous URLs fall back to Dashboard.
- The dashboard uses the mobile app's pantry mascot. Recipe cards use dish photos with a neutral fallback when unavailable.
- The sidebar companion sits above Settings, replacing the mission card. It uses Panzi sprite sheets (drawn with Gemini from the page-mascot prompts, sources in `characters/panzi/`) packed into `public/mascot/panzi-directions.webp` and `panzi-reactions.webp`, driven the nilbuild/page-mascot (MIT) way: the head turns toward the cursor (8 directions plus a centre dead zone), and a click shows an aligned front-facing heart or star-eyed expression, or dizzy after four quick clicks. Side-facing reaction frames are excluded to prevent a leftward flash. Both sheets fade at the bottom to soften the cropped apron. Repeated taps replace the current squash animation. It offers a relevant shortcut for each route. Tracking can be paused (stored locally), stops when hidden, offscreen, or collapsed, and pausing or reduced motion disables tracking, sprite reactions, and the squash animation while keeping the greeting available.

## Data and controls

Keep API contracts and auth enforcement intact. Development sample mode is labeled. Summary figures state their scope: account summaries are for the current page/filter; missing pricing remains unknown, and expiry estimates retain their provenance.

Pantry category chips filter ingredients. Recipe sorting supports most saved, highest rated, and name. Users and logs retain search, filters, pagination, and CSV export of the current page. Period selectors request data from the API.

## Responsive behavior

The sidebar collapses to a desktop rail and becomes a navigation drawer below 861px. Cards reflow; wide tables scroll within labelled regions. Preserve keyboard focus, selected filter states, Escape dismissal, and reduced-motion support. Light/dark preference persists using the existing theme setting.

## Verification

Run npm run build in admin. Check all eight routes at desktop and phone widths, searches, filters, recipe ordering, account drawers, period changes, exports, and removed-route redirects. Set VITE_SAMPLE_DATA=true and VITE_SKIP_AUTH=true only for a local preview process. Production builds retain sign-in and API access. Live data verification requires a signed-in administrator and the shared API.
