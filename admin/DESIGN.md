# Panzi admin design guide

The workspace helps administrators find information, review activity, and act with confidence. Keep the login's food imagery and expressive typography on the sign-in page; use calm surfaces and direct language inside the console.

## Shared foundation

- `src/styles/admin.css` owns the workspace theme. It is scoped to `.shell` so login styling remains independent.
- Use `PageHeader` for page titles, explanations, date ranges, and exports. Show an export action only when data is available to export.
- Use `MetricCard` for summary numbers, `SearchInput` for search, and `FilterPills` for filters. Keep selected states visible and accessible.
- Navigation is grouped into Overview, Manage, and Administration. Keep labels consistent with page titles.
- Keep the existing authentication and API contracts. Mark example data clearly and distinguish missing data from zero activity.

## Typography and spacing

- Page titles: 28–30 px. Card titles: 17 px. Body text and controls: 13–15 px. Compact captions: 12 px.
- Prefer sentence case. Reserve uppercase for short navigation group labels.
- Put a short explanation below a heading, not inside the heading. State what a number measures and what period it covers.
- Use 16–24 px panel padding, 18–22 px gaps between panels, and shared border radii. Avoid squeezing extra fields into dense rows.
- Use green for selected states and primary actions. Use warning and error colors only when they carry meaning. Include words with every status color.

## Responsive and accessible behavior

- At widths up to 820 px, use the mobile navigation drawer. Do not hide the only route to another screen.
- Reflow cards into fewer columns. Keep wide tables in their own scrollable, labelled region so the whole page stays within the viewport.
- Give search fields accessible names and selectable filters a programmatic selected state. Keep focus outlines visible.
- Dialogs support Escape, contain keyboard focus, prevent background scrolling, and return focus to the initiating control.
- Respect reduced motion. Keep workspace animations brief and related to a change in state.
- Aim for at least 4.5:1 contrast for normal text, following [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Check narrow layouts against [W3C reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

## Theme and data transitions

- The workspace toggle switches between light and dark mode. Follow the system preference until a user chooses a theme; persist that choice in `panzi.admin.theme` and synchronize it across tabs.
- Define dark colors on `.shell[data-theme="dark"]`. Use surface, text, status, and action tokens in tables and dialogs. Primary buttons use separate action colors so their labels stay readable in both themes.
- Use `AnimatedNumber` for summary values. Animate toward returned data, preserve currency, decimal places, percentages, and compact units, and leave missing-value placeholders intact. Assistive technology receives the final value without every intermediate frame.
- Use `AnimatedBar` for vertical chart columns and `ProgressBar` for horizontal values. Keep transitions under one second, interrupt them when newer values arrive, and show final values immediately when reduced motion is enabled.
- Date filters request the existing API data. Keep previous values while loading; never invent changes just to trigger an animation.

## Verification

Run `npm run build` from `admin/`. Review all nine routes with populated and empty states. Verify desktop, tablet, and phone layouts; search and filtering; CSV exports; date ranges; keyboard dialog operation; and mobile navigation. Automated accessibility checks help identify issues but do not replace manual review or establish complete WCAG conformance.

Use sample mode or browser-only fixtures for visual QA. Do not grant permissions or modify real accounts to test the interface.


## Connected workflows

Keep Recipes out of the navigation until a shared recipe workflow exists. Use Pantry insights and Conversations as page labels. Keep technical configuration in the Settings disclosure.

Review cards show a persisted status, a labelled status selector, and an internal note with an explicit Save action. Show errors without clearing the draft. Keep status filters, pagination, and export scope visible. A resolved review never implies that a user pantry item was edited.

Display the last successful refresh time, not the time a request began. Unknown food outcomes remain separate from confirmed consumption and waste. Raw chart values belong in tooltips and exports; normalized percentages only control geometry.


Use shared DateFilter and Pagination controls on record lists. Label the date being filtered (Joined, Last activity, or Submitted) and make CSV page scope explicit. Place operational alerts below the Dashboard summary cards; include the measurement window, an explanatory sentence, and a relevant destination. Keep no-data and no-alert states distinct. The defense setup uses the configured administrator account without prompts to add individual accounts.
