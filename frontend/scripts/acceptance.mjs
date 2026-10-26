// Builds ACCEPTANCE.md from the real test results (Playwright JSON, pytest JUnit, Vitest JSON,
// Lighthouse). Nothing in the table is hand-written except which tests belong to which feature.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url).pathname;
const read = (p) => (existsSync(root + p) ? readFileSync(root + p, 'utf8') : null);

/* ---------- load results ---------- */
const results = [];

const pw = read('test-results/playwright-results.json');
if (pw) {
  const walk = (suite, trail) => {
    const here = suite.title && !/\.spec\.ts$/.test(suite.title) ? [...trail, suite.title] : trail;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const last = t.results?.[t.results.length - 1];
        const status =
          t.status === 'skipped'
            ? 'skipped'
            : t.status === 'expected' || t.status === 'flaky'
              ? 'passed'
              : 'failed';
        results.push({
          kind: 'e2e',
          title: [...here, spec.title].join(' > '),
          project: t.projectName,
          status,
          flaky: t.status === 'flaky',
          ms: last?.duration ?? 0,
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const s of JSON.parse(pw).suites) walk(s, []);
}

const junit = read('backend/junit.xml');
if (junit) {
  for (const m of junit.matchAll(
    /<testcase classname="([^"]*)" name="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g,
  )) {
    const body = m[4] ?? '';
    const status = /<failure|<error/.test(body)
      ? 'failed'
      : /<skipped/.test(body)
        ? 'skipped'
        : 'passed';
    results.push({
      kind: 'pytest',
      title: `${m[1].replace(/^tests\./, '')}::${m[2]}`,
      project: 'postgres',
      status,
    });
  }
}

const vt = read('test-results/vitest-results.json');
if (vt) {
  for (const f of JSON.parse(vt).testResults) {
    for (const a of f.assertionResults) {
      results.push({
        kind: 'vitest',
        title: `${f.name.split('/src/')[1].replace(/\.tsx?$/, '')}::${a.fullName}`,
        project: 'jsdom',
        status: a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'skipped',
      });
    }
  }
}

/* ---------- features -> evidence ---------- */
const E = (re) => ({ kind: 'e2e', re });
const P = (re) => ({ kind: 'pytest', re });
const V = (re) => ({ kind: 'vitest', re });

const features = [
  // ---- section 4: backend ----
  [
    '4 API',
    'Projects: list, get, create',
    [
      P(/test_projects_api::test_(create_and_get|get_404|create_validation)/),
      P(/test_list_filters::test_pagination/),
    ],
  ],
  [
    '4 API',
    'Projects: update (PATCH) incl. clearing dates to TBD',
    [
      P(/test_projects_api::test_patch_(updates|can_clear|rejects|without)/),
      P(/test_multi_field_patch/),
    ],
  ],
  [
    '4 API',
    'PATCH requires version; stale version returns 409 (also under concurrent writes)',
    [P(/test_patch_409|test_concurrent_patches|test_form_conflict/)],
  ],
  [
    '4 API',
    'Soft delete and restore',
    [P(/test_soft_delete_and_restore|test_restore_errors|test_delete_404/)],
  ],
  [
    '4 API',
    'List filters: category[], stage[], pic[], deadline_status[]',
    [P(/test_filter_(category|stage|pic|deadline_status)/)],
  ],
  [
    '4 API',
    'Search (name/description/notes, case-insensitive, wildcard-safe)',
    [P(/test_search_/), P(/test_column_text_filters/)],
  ],
  [
    '4 API',
    'Date range filter for every date field (incl. TBD)',
    [P(/date_range_and_tbd_filters_exist_for_every_date_field|effective_deadline_range/)],
  ],
  [
    '4 API',
    'Sort by any column; pagination',
    [
      P(
        /test_every_column_is_sortable|test_sort_results|test_sort_by_deadline_status_rank|test_pagination/,
      ),
    ],
  ],
  ['4 API', 'Persons CRUD', [P(/test_persons_crud|test_person_in_use/)]],
  ['4 API', 'Stages: list, create', [P(/test_stages_list_and_create/)]],
  ['4 API', 'GET /summary (categories, deadline statuses, PICs)', [P(/test_summary/)]],
  [
    '4 API',
    'GET /projects/{id}/activity, written in the same transaction',
    [P(/test_activity|test_failed_patch_rolls_back/)],
  ],
  [
    '4 API',
    'POST /import/csv with dry_run, per-row errors, all-or-nothing',
    [
      P(
        /test_import_export::test_(dry_run|real_import|bad_rows|existing_name|file_level|size_and|semicolon|quoted)/,
      ),
    ],
  ],
  [
    '4 API',
    'GET /export csv and xlsx with the list filters',
    [P(/test_export_/), P(/test_export_then_import/)],
  ],
  ['4 API', 'GET /health checks DB connectivity', [P(/test_health_/)]],
  [
    '4 API',
    'One error format; 400/404/409/422/500; no stack traces',
    [
      P(/test_error_format|test_unhandled_error|test_unexpected_integrity/),
      P(/test_create_validation_errors/),
    ],
  ],
  [
    '4 API',
    'Structured logging with request id; CORS from env',
    [P(/test_request_id_header_and_cors|test_unhandled_error/)],
  ],
  [
    '3 Rules',
    'Deadline status incl. boundaries (today, +7, +8, no dates, adjusted only, actual set)',
    [P(/test_deadline::/)],
  ],
  [
    '3 Rules',
    '"Today" from APP_TIMEZONE; changes at midnight Asia/Makassar',
    [P(/test_timezone_and_fmt::/)],
  ],
  [
    '3 Rules',
    'Stage Done defaults actual date; actual date never in the future; name trimmed',
    [P(/test_setting_stage_done|test_actual_date_today|test_create_and_get/), V(/schema.test/)],
  ],
  [
    '2 Data',
    'Unique name among non-deleted, DB constraints, idempotent seed with the sample data',
    [P(/test_duplicate_name|test_seed_/)],
  ],
  // ---- section 5: frontend ----
  [
    '5 Table',
    'Desktop table / tablet table / mobile cards render per breakpoint',
    [E(/dashboard renders the right layout/)],
  ],
  [
    '5 Table',
    'Filter on every column: multi-select (Category, Stage, PIC, Deadline Status)',
    [E(/column filters > (Category|Stage|PIC|Deadline Status)/)],
  ],
  [
    '5 Table',
    'Filter on every column: text (Project, Description, Notes)',
    [E(/column filters > Project, Description and Status Notes/)],
  ],
  [
    '5 Table',
    'Filter on every column: date range incl. "is TBD" (all 5 date columns)',
    [
      E(
        /column filters > (Plan Date|Adjusted Plan Date|Effective Deadline|Actual Date|Projected Start)/,
      ),
    ],
  ],
  ['5 Table', 'Global search, debounced 300 ms', [E(/search > is debounced/), V(/DebouncedInput/)]],
  [
    '5 Table',
    'Active filters as removable chips; Clear all filters',
    [E(/chips and URL state > active filters show as chips/), V(/view.test::.*chips/)],
  ],
  [
    '5 Table',
    'Tabs All / Current / Pending / Maintenance',
    [E(/tabs filter by category|tabs work with the keyboard/)],
  ],
  ['5 Table', 'Sort (any column)', [E(/sorting >/)]],
  [
    '5 Table',
    'Column show/hide and resize, saved in localStorage',
    [E(/columns > (show\/hide|columns can be resized|the last visible)/), V(/columnSettings/)],
  ],
  ['5 Table', 'Group by category, collapsible', [E(/grouping >/)]],
  [
    '5 Table',
    'Filters, sort, tab and open panel live in the URL (shareable, survive reload)',
    [E(/survive a reload|browser back closes/), V(/view.test::view <-> URL/)],
  ],
  ['5 Table', 'Long text truncated to 2 lines with expand', [E(/long text is cut/)]],
  [
    '5 Table',
    'Inline editing: dates (clear = TBD), stage, PIC multi-select; Enter saves, Esc cancels',
    [E(/inline editing > (date|every date|stage: choose|PIC)/)],
  ],
  [
    '5 Table',
    'Stage Done without actual date prompts (default today)',
    [E(/stage Done without an actual date|cancelling the Done prompt/)],
  ],
  [
    '5 Table',
    'Optimistic updates with rollback and a clear error',
    [E(/optimistic update is shown|network failure also rolls back/), V(/status.test::applyPatch/)],
  ],
  [
    '5 Table',
    'Conflict (409): show latest data, let the user re-apply',
    [E(/409 conflict/), E(/Discard my edits/)],
  ],
  [
    '5 Table',
    'Detail pop-up / sheet: all fields editable + activity history (from the Activity button)',
    [
      E(/all fields are editable in the detail view/),
      E(/the detail pop-up fills the screen|the pop-up is centred/),
    ],
  ],
  [
    '5 Table',
    'Create / edit form with validation next to the field',
    [E(/create > /), V(/ProjectForm|schema.test/)],
  ],
  [
    '5 Table',
    'Delete with confirmation and Undo (restore)',
    [E(/delete asks for confirmation|delete from the detail view|failed delete/)],
  ],
  [
    '5 Table',
    'Move category from the row menu',
    [E(/Move to category|row menu works with the keyboard/)],
  ],
  ['5 Table', 'Export current filtered view to CSV / Excel', [E(/export >/)]],
  ['5 Table', 'CSV import: upload -> preview with per-row errors -> confirm', [E(/import >/)]],
  [
    '5 Summary',
    'Summary bar counts; clicking a count applies the filter',
    [E(/summary count|summary counts match/)],
  ],
  ['5 States', 'Loading skeletons (not spinners)', [E(/shows skeletons shaped like/)]],
  ['5 States', 'Empty state with "Clear filters"', [E(/empty state offers/)]],
  [
    '5 States',
    'Error state with retry; summary retry',
    [E(/error state has a retry|server error shows the message|summary shows a retry/)],
  ],
  ['5 States', 'Error boundary (never a blank screen)', [E(/error boundary/), V(/ErrorBoundary/)]],
  [
    '5 A11y',
    'No serious axe violations; keyboard usable; visible focus; ARIA labels',
    [
      E(
        /serious accessibility violations|keyboard focus is visible|row menu works with the keyboard|focus stays inside/,
      ),
    ],
  ],
  [
    '5 A11y',
    'Colour is never the only signal (status text labels)',
    [E(/status always has a text label/), V(/Tag.test/)],
  ],
  ['5 A11y', 'Text contrast at least WCAG AA', [V(/contrast\.test::.*text contrast/)]],
  [
    '5 Mobile',
    'Cards show the specified fields; description/notes hidden; no inline editing',
    [E(/mobile cards show the specified fields/)],
  ],
  [
    '5 Mobile',
    'Tap card -> full-screen detail sheet',
    [E(/mobile card opens the full-screen sheet/)],
  ],
  [
    '5 Mobile',
    'Sticky header with search + Add (no FAB); scrollable tabs and summary',
    [E(/mobile header is sticky/)],
  ],
  [
    '5 Mobile',
    'Filter bottom sheet: all filters, sort dropdown, live count "Show N projects", Clear all',
    [
      E(/filter sheet \/ drawer > shows a live result count/),
      E(/filter sheet scrolls|filters (sort|by)/),
    ],
  ],
  [
    '5 Mobile',
    'Chip row scrolls horizontally; chips removable',
    [E(/chips row is horizontally scrollable/)],
  ],
  [
    '5 Mobile',
    'Row actions via a "More" button; "Load more" instead of page numbers',
    [E(/Load more. replaces page numbers/), E(/move category from the row menu/)],
  ],
  ['5 Mobile', 'Safe-area insets', [E(/safe-area insets/)]],
  [
    '5 Tablet',
    'ClickUp-style columns by default; sticky Project column; scroll inside the table container only',
    [E(/tablet specifics > ClickUp-style columns/)],
  ],
  [
    '5 Tablet',
    'Detail pop-up fills the screen with a 16px margin; filters in a side drawer; column chooser',
    [E(/tablet specifics > the detail pop-up fills/), E(/shows a live result count/)],
  ],
  [
    '5 Desktop',
    'Every column has a filter in the Filters panel; centred detail pop-up; dense rows',
    [E(/desktop specifics >/)],
  ],
  [
    '5 All sizes',
    'Touch targets >= 44x44 (pointer: coarse); inputs >= 16px',
    [E(/touch targets are at least 44x44/)],
  ],
  [
    '5 All sizes',
    'No horizontal page scroll down to 320px on every screen',
    [E(/page never scrolls horizontally/), E(/resizing across breakpoints/)],
  ],
  [
    '5 All sizes',
    'Rotation / resize keeps filters, scroll position and open panel',
    [E(/rotating keeps filters/), E(/resizing across breakpoints/)],
  ],
  [
    '5 All sizes',
    'Dialogs/sheets scroll; keyboard never covers the focused input; long names wrap',
    [E(/dialogs and sheets scroll|confirm dialog is scrollable|long project names wrap/)],
  ],
  [
    '4 API',
    'POST /projects/reorder: within a category, across categories, first/last, rebalancing, 409, activity log',
    [P(/test_reorder::test_(move|positions|repeated|stale|moving|reorder|anchor|failed)/)],
  ],
  [
    '2 Data',
    'position column (gaps of 1000), migration backfills the current order, new projects go last',
    [P(/test_reorder::test_(new_projects|migration|changing_category|restored|default_list)/)],
  ],
  [
    '2 Data',
    'Row number per category: stable under filters, ignores deleted rows',
    [P(/test_reorder::test_numbers_are_per_category/)],
  ],
  [
    '5 Table',
    'Column order and the "Schedule" group header (desktop and tablet defaults)',
    [E(/column order and the Schedule group/), V(/columnSettings/)],
  ],
  [
    '5 Table',
    'Row number (#): per category, same under filters, updates after a reorder, "3." on cards',
    [E(/row numbers/), V(/reorder.test/)],
  ],
  [
    '5 Table',
    'Drag and drop: mouse (desktop), long-press touch (phones, tablets), order survives reload',
    [
      E(/drag and drop > drag within a category/),
      E(/a quick swipe on the grip/),
      E(/dragging near the screen edge/),
    ],
  ],
  [
    '5 Table',
    'Drag preview and 2px accent drop line while dragging',
    [E(/a clean preview and a 2px accent drop line/)],
  ],
  [
    '5 Table',
    'Keyboard reorder (Space, arrows, Space, Esc) with screen-reader announcements',
    [E(/drag and drop > keyboard/)],
  ],
  [
    '5 Table',
    'Drag between categories changes the category and renumbers both groups; collapsed groups accept drops',
    [E(/drag into another category/), E(/collapsed group still accepts/)],
  ],
  [
    '5 Table',
    'Dragging with filters on places the row next to its visible neighbour',
    [E(/with filters on, the row lands next/)],
  ],
  [
    '5 Table',
    'Optimistic reorder with rollback; stale version refused with a message',
    [E(/failed reorder rolls back/), E(/stale version/)],
  ],
  [
    '5 Table',
    'Handles disabled when sorted by another column; "Manual order" switches back',
    [E(/manual order versus other sorting/)],
  ],
  [
    '5 Mobile',
    'Move up / Move down / Move to category... in the card menu',
    [E(/move up \/ move down/)],
  ],
  [
    '5 Table',
    'Schedule cells: empty = #FFF176 (no text), filled = #E4E4E4; row tints do not override; hover/focus; live update',
    [E(/schedule cell colours/), V(/contrast.test/)],
  ],
  [
    '6 Theme',
    'Dark is the default; Dark / Light / System toggle in the top bar, saved in localStorage',
    [
      E(/theme toggle > (dark is the default|Dark \/ Light \/ System)/),
      V(/theme\.test|ThemeToggle/),
    ],
  ],
  [
    '6 Theme',
    'System follows the OS setting (prefers-color-scheme), also live; an explicit choice ignores it',
    [E(/theme toggle > (System follows|an explicit choice)/)],
  ],
  [
    '6 Theme',
    'No flash of the wrong theme on load (theme set before React renders)',
    [E(/no flash of the wrong theme/)],
  ],
  [
    '6 Theme',
    'Palette values per theme and WCAG AA contrast of every text/background pair, both themes (unit)',
    [V(/contrast\.test/)],
  ],
  [
    '6 Theme',
    'axe: no contrast or serious violations on every main screen, dark and light',
    [E(/(dark|light) theme: accessibility and screenshots > no WCAG AA/)],
  ],
  [
    '6 Theme',
    'Schedule cell colours correct in both themes, live after editing, rows tints never override',
    [E(/schedule cell colours \((dark|light) theme\)/)],
  ],
  [
    '6 Theme',
    'Screenshots of every main screen at every viewport in both themes',
    [E(/screenshots of every main screen/)],
  ],
  [
    '6 Theme',
    'All colours come from CSS variables; no gradients, no #000 background, no #FFF text (unit + e2e)',
    [V(/no-hardcoded-colours/), E(/no gradients, no pure black/)],
  ],
  [
    '6 Theme',
    'One icon set (lucide, 16px, stroke 1.75); native pickers and scrollbars follow the theme; 6px/10px radius',
    [E(/icons are one set|native pickers and scrollbars|radius 6px/)],
  ],
  [
    '5 Shell',
    'Sidebar: 240px / 56px rail on desktop (remembered), rail + drawer on tablet, drawer on mobile',
    [E(/sidebar > (desktop|tablet|mobile)/)],
  ],
  [
    '5 Shell',
    'Sidebar counts match the data; clicking a category or a person filters the list',
    [E(/sidebar > (counts match|People)/)],
  ],
  [
    '5 Shell',
    'Top bar: breadcrumb, Filters (count), Sort, theme toggle, primary Add project',
    [E(/top bar >/)],
  ],
  [
    '5 Shell',
    'List view grouped by category: caret, pill, count, sticky header, collapsible, switch-off',
    [
      E(/group headers show a caret/),
      E(/pinned under the column header/),
      E(/grouped by category by default/),
    ],
  ],
  [
    '5 Shell',
    '"+ Add project" at the bottom of each group creates the project in that category',
    [E(/Add project" at the bottom of each group/), E(/Esc cancels, an empty name is refused/)],
  ],
  [
    '5 Shell',
    'PIC avatars (initials, +N, tooltip, empty = yellow); stage pill with coloured dot',
    [E(/PIC avatars/), E(/stage is a small pill/), V(/Avatar\.test|avatar\.test/)],
  ],
  [
    '5 Shell',
    'Grip and row menu appear on hover; always visible on touch and on keyboard focus',
    [E(/the grip and row menu show on hover/)],
  ],
  [
    '6 Design',
    'Exact palette, IBM Plex Sans/Mono, 14/13px, "Tue, Oct 06, 26" dates',
    [
      E(/IBM Plex fonts/),
      E(/show the date format everywhere/),
      V(/contrast.test::palette matches/),
      V(/dates.test::formatDate/),
    ],
  ],
  // ---- logins, attribution, priority (2026-10-26) ----
  [
    'Login',
    'Login required everywhere; back to the same view after logging in; one plain error, no lockout',
    [
      E(/login > without a session the app asks to log in/),
      E(/login > the API refuses every call/),
      P(
        /test_auth::test_(login|wrong_credentials|inactive_user|repeated_failures|every_endpoint|health)/,
      ),
      V(/LoginPage\.test::LoginPage/),
      V(/authSchema\.test::redirect after login/),
    ],
  ],
  [
    'Login',
    'First login forces a new password (same rules in the browser and the API); logout ends the session',
    [
      E(/first login forces a new password/),
      P(/test_auth::test_(first_login|password_rules|changing_the_password|logout)/),
      V(/ChangePasswordPage|change password form/),
    ],
  ],
  [
    'Login',
    'A session that ends while the app is open leads back to login, keeping the page; CSRF header on writes',
    [
      E(/a session that ends while the app is open/),
      P(
        /test_auth::test_(writes_without_the_csrf|expired_session|session_expiry_slides|inactive_users_sessions)/,
      ),
      V(/client\.test::api client/),
    ],
  ],
  [
    'Login',
    'Users screen (admins): add, reset password, make admin, deactivate; nobody can lock themselves out',
    [
      E(/users screen \(admins\) > add a user/),
      E(/people who are not admins have no Users screen/),
      P(/test_users::/),
      V(/UsersPage\.test::UsersPage/),
    ],
  ],
  [
    'Login',
    'Seed accounts (password = username, must change); make seed-users never touches projects',
    [P(/test_seed_is_idempotent|test_seed_users_only/)],
  ],
  [
    'Login',
    'Login, password and Users screens: both themes, axe, no horizontal scroll, screenshots',
    [
      E(/login, password and users screens in the light theme/),
      E(/without a session the app asks/),
    ],
  ],
  [
    'History',
    'Every change names who made it ("Unknown" before logins); "Created by" on projects and subtasks',
    [
      E(/who changed what > history and "Created by"/),
      P(/test_attribution::/),
      V(/ActivityList\.test|describe\.test::priority and who made the change/),
    ],
  ],
  [
    'Priority',
    'ClickUp priority (Urgent/High/Normal/Low/none): inline edit, pop-up and sheet, history',
    [
      E(/priority > set, change and clear a project priority/),
      P(/test_priority::test_(new_projects|create_set|same_priority|invalid_priority)/),
      V(
        /PriorityFlag\.test|priority\.test|schema\.test::(project priority|subtask form > sends priority)/,
      ),
    ],
  ],
  [
    'Priority',
    'Priority filter (incl. "No priority"), chips and URL; sort with no priority last; Group: Priority',
    [
      E(/priority > filter by priority/),
      E(/priority > sort by priority/),
      E(/priority > Group: Priority/),
      P(/test_priority::test_(filter|bad_priority_filter|sort)/),
      V(/view\.test::priority/),
    ],
  ],
  [
    'Priority',
    'Subtask priority; CSV import / export column',
    [E(/subtasks have a priority too/), P(/test_priority::test_(subtask|export|import)/)],
  ],
  [
    'Priority',
    'Flag colours in both themes (3:1 as a graphic) and the level always written',
    [E(/flag colours in the (dark|light) theme/), V(/contrast\.test::.*priority flag/)],
  ],
  // ---- subtasks (PR #1 / #2) ----
  [
    'Subtasks',
    'Add (top level and nested), tick done, progress on the project row',
    [E(/subtasks > add subtasks/), P(/test_tasks::/)],
  ],
  [
    'Subtasks',
    'Subtask rows in the list: show / hide, edit in place, remembered, "Subtasks" toolbar button',
    [E(/subtasks > subtask rows in the list/)],
  ],
  [
    'Subtasks',
    'Subtask view: fields, Markdown notes, priority, history',
    [
      E(/subtasks > open a subtask/),
      V(/MarkdownEditor\.test|livePreview\.test|tablePreview\.test/),
    ],
  ],
  [
    'Subtasks',
    'Move up / down, indent / outdent (menu) and keyboard reorder; delete with Undo; search finds subtasks',
    [
      E(/subtasks > menu moves/),
      E(/subtasks > keyboard reorder/),
      E(/subtasks > delete asks first/),
      E(/subtasks > search finds a subtask/),
    ],
  ],
];

/* ---------- evaluate ---------- */
for (const r of results) if (r.kind === 'e2e') r.project = r.project.replace(/^order-/, '');
const VIEWPORTS = [...new Set(results.filter((r) => r.kind === 'e2e').map((r) => r.project))];
const rows = [];
let anyFailed = false;
let uncovered = false;
const countBy = { pytest: 0, vitest: 0, e2e: 0 };
for (const [area, name, evidence] of features) {
  const matched = [];
  for (const ev of evidence)
    matched.push(...results.filter((r) => r.kind === ev.kind && ev.re.test(r.title)));
  const ran = matched.filter((r) => r.status !== 'skipped');
  const failed = ran.filter((r) => r.status === 'failed');
  const passedViewports = new Set(
    ran.filter((r) => r.kind === 'e2e' && r.status === 'passed').map((r) => r.project),
  );
  const kinds = [...new Set(ran.map((r) => r.kind))];
  for (const r of ran) countBy[r.kind]++;
  const result = ran.length === 0 ? 'NOT RUN' : failed.length ? `FAIL (${failed.length})` : 'PASS';
  if (ran.length === 0) uncovered = true;
  if (failed.length) anyFailed = true;
  const viewports = passedViewports.size
    ? passedViewports.size === VIEWPORTS.length
      ? `all ${VIEWPORTS.length}`
      : [...passedViewports]
          .map((v) => v.replace(/^(phone|tablet|desktop)-/, ''))
          .sort()
          .join(', ') + ` (${passedViewports.size}/${VIEWPORTS.length}; others n/a by design)`
    : kinds.includes('e2e')
      ? 'none'
      : '-';
  const tests = `${ran.length} ${kinds.join('+')}`;
  rows.push({ area, name, tests, viewports, result });
}

const total = (kind) => results.filter((r) => r.kind === kind);
const sum = (kind) => {
  const all = total(kind);
  return `${all.filter((r) => r.status === 'passed').length} passed, ${all.filter((r) => r.status === 'failed').length} failed, ${all.filter((r) => r.status === 'skipped').length} skipped`;
};

let lighthouse = '_not run_';
const lh = read('test-results/lighthouse/summary.json');
if (lh) {
  lighthouse = JSON.parse(lh)
    .map(
      (r) =>
        `| ${r.page} | ${r.performance} | ${r.accessibility} | ${r.bestPractices} | ${r.lcp} | ${r.formFactor} |`,
    )
    .join('\n');
}

const md = `# Final acceptance checklist

Generated by \`frontend/scripts/acceptance.mjs\` from the real test results (Playwright JSON, pytest JUnit,
Vitest JSON, Lighthouse). "n/a by design" means the feature does not exist on that layout
(for example inline cell editing is not offered on phones; editing happens in the sheet).

## Totals

| Suite | Result |
| --- | --- |
| Backend pytest (real PostgreSQL 16) | ${sum('pytest')} |
| Frontend Vitest | ${sum('vitest')} |
| Playwright E2E (${VIEWPORTS.length} viewports) | ${sum('e2e')} |

Viewports: ${VIEWPORTS.sort().join(', ')}

## Lighthouse (mobile emulation, production build)

| Page | Performance | Accessibility | Best practices | LCP | Form factor |
| --- | --- | --- | --- | --- | --- |
${lighthouse}

Thresholds: Accessibility >= 95, Performance >= 85.

## Features

| Area | Feature | Tests | Viewports tested (E2E) | Result |
| --- | --- | --- | --- | --- |
${rows.map((r) => `| ${r.area} | ${r.name} | ${r.tests} | ${r.viewports} | ${r.result} |`).join('\n')}

${anyFailed ? '**Some features FAIL.**' : uncovered ? '**Some features have no test run.**' : `All ${rows.length} features pass.`}
`;
writeFileSync(root + 'ACCEPTANCE.md', md);
console.log(md.split('## Features')[0]);
console.log(
  `${rows.length} features: ${rows.filter((r) => r.result === 'PASS').length} pass, ${rows.filter((r) => r.result.startsWith('FAIL')).length} fail, ${rows.filter((r) => r.result === 'NOT RUN').length} not run`,
);
for (const r of rows.filter((r) => r.result !== 'PASS'))
  console.log(' -', r.area, r.name, r.result);
if (anyFailed || uncovered) process.exit(1);
