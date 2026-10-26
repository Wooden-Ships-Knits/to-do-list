import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');

type Rgba = [number, number, number, number];
type Tokens = Record<string, string>;

/** The declarations of one theme block of tokens.css. */
function block(selector: RegExp): Tokens {
  const m = selector.exec(css);
  if (!m) throw new Error(`theme block not found: ${selector}`);
  const body = css.slice(m.index + m[0].length, css.indexOf('\n}', m.index + m[0].length));
  const out: Tokens = {};
  for (const line of body.split('\n')) {
    const d = /^\s*--([a-z0-9-]+):\s*([^;]+);/.exec(line);
    if (d) out[d[1] as string] = (d[2] as string).trim();
  }
  return out;
}

const shared = block(/:root \{\n/);
const dark: Tokens = { ...shared, ...block(/:root,\n:root\[data-theme='dark'\] \{\n/) };
const light: Tokens = { ...shared, ...block(/:root\[data-theme='light'\] \{\n/) };
const THEMES: [string, Tokens][] = [
  ['dark', dark],
  ['light', light],
];

function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1] as string, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(value);
  if (rgba)
    return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] ? Number(rgba[4]) : 1];
  throw new Error(`cannot parse colour "${value}"`);
}

const over = (top: Rgba, bottom: Rgba): Rgba => [
  Math.round(top[0] * top[3] + bottom[0] * (1 - top[3])),
  Math.round(top[1] * top[3] + bottom[1] * (1 - top[3])),
  Math.round(top[2] * top[3] + bottom[2] * (1 - top[3])),
  1,
];

const lin = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (c: Rgba): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: Rgba, b: Rgba): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** Colour of `token` as seen on top of the (possibly translucent) `base` tokens. */
function colour(t: Tokens, token: string, ...bases: string[]): Rgba {
  let result = parse(t[token] as string);
  for (const base of bases) result = over(result, parse(t[base] as string));
  return result;
}

describe('palette: dark theme uses the exact values of the design brief', () => {
  it.each([
    ['bg', '#1a1b1e'],
    ['sidebar', '#151619'],
    ['surface', '#212226'],
    ['surface-alt', '#26272b'],
    ['surface-raised', '#2c2d32'],
    ['border', '#34353a'],
    ['text', '#e6e6e8'],
    ['text-muted', '#9a9ba1'],
    ['accent', '#7b68ee'],
    ['tag-current-fg', '#6fcf97'],
    ['tag-pending-fg', '#e2b657'],
    ['tag-maintenance-fg-spec', '#6fa8dc'],
    ['st-overdue-fg-spec', '#f07a70'],
    ['st-due-soon-fg', '#e8a33d'],
    ['st-on-track-fg', '#5fbf8a'],
    ['st-done-fg', '#5fbf8a'],
    ['st-no-deadline-fg-spec', '#9a9ba1'],
    ['cell-empty', '#e8d44d'],
    ['cell-filled', '#3a3b40'],
    ['cell-filled-text', '#e6e6e8'],
    ['adjusted-date', '#8ab4f8'],
    ['overdue-border', '#f07a70'],
  ])('--%s is %s', (name, value) => {
    expect((dark[name] ?? '').toLowerCase()).toBe(value);
  });

  it.each([
    ['tag-current-bg', 'rgba(111, 207, 151, 0.14)'],
    ['tag-pending-bg', 'rgba(226, 182, 87, 0.14)'],
    ['tag-maintenance-bg', 'rgba(111, 168, 220, 0.14)'],
    ['st-overdue-bg', 'rgba(240, 122, 112, 0.15)'],
    ['st-due-soon-bg', 'rgba(232, 163, 61, 0.15)'],
    ['st-on-track-bg', 'rgba(95, 191, 138, 0.14)'],
    ['st-done-bg', 'rgba(95, 191, 138, 0.14)'],
    ['st-no-deadline-bg', 'rgba(154, 155, 161, 0.14)'],
    ['overdue-tint', 'rgba(240, 122, 112, 0.06)'],
  ])('--%s is %s', (name, value) => {
    expect(dark[name]).toBe(value);
  });

  it('is a dark theme: no pure black background and no pure white text', () => {
    for (const name of ['bg', 'sidebar', 'surface', 'surface-alt', 'surface-raised']) {
      expect(dark[name]?.toLowerCase()).not.toBe('#000000');
    }
    for (const name of ['text', 'text-muted', 'on-primary', 'cell-filled-text', 'toast-fg']) {
      expect(dark[name]?.toLowerCase()).not.toBe('#ffffff');
    }
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/gradient/i);
  });
});

describe('palette: light theme keeps the earlier values', () => {
  it.each([
    ['bg', '#f7f5f1'],
    ['surface', '#ffffff'],
    ['surface-alt', '#fbfaf7'],
    ['border', '#e6e1d8'],
    ['text', '#2c2b28'],
    ['text-muted', '#78736a'],
    ['accent', '#5b7a6a'],
    ['tag-current-bg', '#e3ece5'],
    ['tag-current-fg', '#3f6650'],
    ['tag-maintenance-bg', '#e1e7ee'],
    ['st-overdue-bg', '#f5e3e0'],
    ['st-overdue-fg', '#9a3f35'],
    ['st-done-fg', '#3f6650'],
    ['cell-empty', '#fff176'],
    ['cell-filled', '#e4e4e4'],
    ['adjusted-date', '#4a6a96'],
    ['overdue-border', '#c9867c'],
    ['overdue-tint', '#fcf5f3'],
  ])('--%s is %s', (name, value) => {
    expect((light[name] ?? '').toLowerCase()).toBe(value);
  });
});

describe.each(THEMES)('%s theme: text contrast is at least WCAG AA (4.5:1)', (_name, t) => {
  const surfaces = ['bg', 'sidebar', 'surface', 'surface-alt', 'surface-raised'];

  it.each(surfaces)('text and muted text on %s', (surface) => {
    expect(ratio(colour(t, 'text'), colour(t, surface))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(colour(t, 'text-muted-aa'), colour(t, surface))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['bg', 'sidebar', 'surface', 'surface-raised'])('link text on %s', (surface) => {
    expect(ratio(colour(t, 'accent-text'), colour(t, surface))).toBeGreaterThanOrEqual(4.5);
  });

  it('primary button label and danger button label', () => {
    expect(ratio(colour(t, 'on-primary'), colour(t, 'primary-bg'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(colour(t, 'on-primary'), colour(t, 'primary-bg-hover'))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(ratio(colour(t, 'on-danger'), colour(t, 'danger-solid'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(colour(t, 'on-danger'), colour(t, 'danger-solid-hover'))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  const pills: [string, string][] = [
    ['tag-current-fg', 'tag-current-bg'],
    ['tag-pending-fg', 'tag-pending-bg'],
    ['tag-maintenance-fg', 'tag-maintenance-bg'],
    ['st-overdue-fg', 'st-overdue-bg'],
    ['st-due-soon-fg', 'st-due-soon-bg'],
    ['st-on-track-fg', 'st-on-track-bg'],
    ['st-done-fg', 'st-done-bg'],
    ['st-no-deadline-fg', 'st-no-deadline-bg'],
  ];
  it.each(pills)('pill text %s on %s over every row state', (fg, bg) => {
    // rows sit on the page background (ClickUp-style list), surface on hover
    for (const row of ['bg', 'surface', 'surface-alt', 'surface-raised']) {
      expect(ratio(colour(t, fg), colour(t, bg, row))).toBeGreaterThanOrEqual(4.5);
    }
    // the overdue row: tint over surface, then the pill over that
    const tinted = over(parse(t['overdue-tint'] as string), parse(t['surface'] as string));
    expect(ratio(colour(t, fg), over(parse(t[bg] as string), tinted))).toBeGreaterThanOrEqual(4.5);
  });

  it('text on the overdue and done rows', () => {
    const tinted = over(parse(t['overdue-tint'] as string), parse(t['surface'] as string));
    expect(ratio(colour(t, 'text'), tinted)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(colour(t, 'text-muted-aa'), tinted)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(colour(t, 'done-text'), colour(t, 'surface'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(colour(t, 'done-text'), colour(t, 'bg'))).toBeGreaterThanOrEqual(4.5);
    const tintedBg = over(parse(t['overdue-tint'] as string), parse(t['bg'] as string));
    expect(ratio(colour(t, 'text'), tintedBg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(colour(t, 'done-text'), colour(t, 'surface-alt'))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['urgent', 'high', 'normal', 'low'])(
    'priority flag %s stands out as a graphic (3:1) on every row background',
    (level) => {
      for (const row of ['bg', 'surface', 'surface-alt', 'surface-raised']) {
        expect(ratio(colour(t, `priority-${level}`), colour(t, row))).toBeGreaterThanOrEqual(3);
      }
      const tinted = over(parse(t['overdue-tint'] as string), parse(t['bg'] as string));
      expect(ratio(colour(t, `priority-${level}`), tinted)).toBeGreaterThanOrEqual(3);
    },
  );

  it('schedule cells: filled text, adjusted date and labels, in rest and hover states', () => {
    for (const cell of ['cell-filled', 'cell-filled-hover']) {
      expect(ratio(colour(t, 'cell-filled-text'), colour(t, cell))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(colour(t, 'adjusted-date-on-grey'), colour(t, cell))).toBeGreaterThanOrEqual(
        4.5,
      );
    }
    expect(ratio(colour(t, 'text-label-strong'), colour(t, 'cell-filled'))).toBeGreaterThanOrEqual(
      4.5,
    );
    for (const cell of ['cell-empty', 'cell-empty-hover']) {
      expect(ratio(colour(t, 'cell-empty-label'), colour(t, cell))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('error, warning and toast text', () => {
    expect(ratio(colour(t, 'danger'), colour(t, 'danger-bg', 'surface'))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(ratio(colour(t, 'danger'), colour(t, 'surface'))).toBeGreaterThanOrEqual(4.5);
    expect(
      ratio(colour(t, 'warning-fg'), colour(t, 'warning-bg', 'surface')),
    ).toBeGreaterThanOrEqual(4.5);
    expect(ratio(colour(t, 'toast-fg'), colour(t, 'toast-bg'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(colour(t, 'toast-fg'), colour(t, 'toast-error-bg'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(colour(t, 'toast-link'), colour(t, 'toast-bg'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(colour(t, 'toast-link'), colour(t, 'toast-error-bg'))).toBeGreaterThanOrEqual(4.5);
  });

  it('subtasks: a matching name, the progress badge, Markdown code and selected text', () => {
    for (const row of ['surface', 'surface-alt']) {
      expect(ratio(colour(t, 'text'), colour(t, 'match-bg', row))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(colour(t, 'st-done-fg'), colour(t, row))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(colour(t, 'text'), colour(t, 'selection-bg', row))).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(colour(t, 'text'), colour(t, 'surface-raised'))).toBeGreaterThanOrEqual(4.5);
    // done subtask names are struck through in the muted tone, still readable
    expect(ratio(colour(t, 'text-muted-aa'), colour(t, 'surface-raised'))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('avatar initials on avatar colour %i', (n) => {
    expect(ratio(colour(t, 'avatar-fg'), colour(t, `avatar-${n}`))).toBeGreaterThanOrEqual(4.5);
  });

  it('non-text: focus ring and drop line are at least 3:1 on the surfaces', () => {
    for (const surface of ['bg', 'surface', 'surface-alt']) {
      expect(ratio(colour(t, 'focus-ring'), colour(t, surface))).toBeGreaterThanOrEqual(3);
    }
  });
});
