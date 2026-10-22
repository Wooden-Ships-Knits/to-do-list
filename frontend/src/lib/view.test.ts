import {
  activeChips,
  clearFilters,
  defaultView,
  filterParams,
  listParams,
  parseView,
  serializeView,
  summaryPreset,
} from './view';

const parse = (qs: string) => parseView(new URLSearchParams(qs));

describe('view <-> URL', () => {
  it('round-trips every filter, sort, tab-less category, page and grouping', () => {
    const qs =
      'category=current,pending&stage=3,4&pic=abc,none&status=overdue&q=hello&name=n&desc=d&notes=x' +
      '&plan_from=2026-10-01&plan_to=2026-10-31&plan_tbd=1&adj_from=2026-01-01&eff_to=2026-12-31' +
      '&actual_tbd=1&start_from=2026-02-02&sort=-plan_date&page=3&group=0';
    const view = parse(qs);
    expect(view.category).toEqual(['current', 'pending']);
    expect(view.stage).toEqual([3, 4]);
    expect(view.pic).toEqual(['abc', 'none']);
    expect(view.sort).toBe('plan_date');
    expect(view.dir).toBe('desc');
    expect(view.page).toBe(3);
    expect(view.group).toBe('none');
    expect(view.dates.plan).toEqual({ from: '2026-10-01', to: '2026-10-31', tbd: true });
    const again = parse(serializeView(view).toString());
    expect(again).toEqual(view);
  });

  it('ignores junk values instead of crashing', () => {
    const view = parse(
      'category=bogus&stage=x,-1,2&status=nope&plan_from=notadate&sort=evil&page=-4&tab=zzz',
    );
    expect(view.category).toEqual([]);
    expect(view.stage).toEqual([2]);
    expect(view.status).toEqual([]);
    expect(view.dates.plan.from).toBe('');
    expect(view.sort).toBeNull();
    expect(view.page).toBe(1);
    expect(view.tab).toBe('all');
  });

  it('keeps unrelated params such as the open project', () => {
    const base = new URLSearchParams('project=123&q=old');
    const next = serializeView({ ...defaultView(), q: 'new' }, base);
    expect(next.get('project')).toBe('123');
    expect(next.get('q')).toBe('new');
  });

  it('a tab wins over a category filter', () => {
    const view = parse('tab=pending&category=current');
    expect(view.tab).toBe('pending');
    expect(view.category).toEqual([]);
  });
});

describe('grouping', () => {
  it('is by category by default; stage or none are kept in the URL', () => {
    expect(parse('').group).toBe('category');
    expect(parse('group=1').group).toBe('category');
    expect(parse('group=stage').group).toBe('stage');
    expect(parse('group=0').group).toBe('none'); // old links
    expect(parse('group=none').group).toBe('none');
    expect(serializeView({ ...defaultView(), group: 'none' }).get('group')).toBe('0');
    expect(serializeView({ ...defaultView(), group: 'stage' }).get('group')).toBe('stage');
    expect(serializeView(defaultView()).has('group')).toBe(false);
  });
});

describe('API params', () => {
  it('maps filters to backend parameter names', () => {
    const view = parse(
      'tab=current&stage=2&pic=none&status=due_soon&q=x&desc=d&notes=n&plan_tbd=1&eff_from=2026-01-01&sort=-name',
    );
    const params = listParams(view);
    expect(params).toContainEqual(['category', 'current']);
    expect(params).toContainEqual(['stage', '2']);
    expect(params).toContainEqual(['pic', 'none']);
    expect(params).toContainEqual(['deadline_status', 'due_soon']);
    expect(params).toContainEqual(['search', 'x']);
    expect(params).toContainEqual(['description', 'd']);
    expect(params).toContainEqual(['status_notes', 'n']);
    expect(params).toContainEqual(['plan_date_tbd', 'true']);
    expect(params).toContainEqual(['effective_deadline_from', '2026-01-01']);
    expect(params).toContainEqual(['sort_by', 'name']);
    expect(params).toContainEqual(['sort_dir', 'desc']);
  });
  it('filterParams has no sorting', () => {
    expect(filterParams(parse('sort=name&q=a')).some(([k]) => k.startsWith('sort'))).toBe(false);
  });
});

describe('chips and clearing', () => {
  const stages = [{ id: 2, name: 'Testing', sort_order: 2 }];
  const persons = [{ id: 'p', name: 'Ann', is_active: true }];
  it('creates one removable chip per active filter', () => {
    const view = parse('stage=2&pic=p,none&status=overdue&q=hi&plan_from=2026-10-01&plan_tbd=1');
    const chips = activeChips(view, stages, persons);
    expect(chips.map((c) => c.label)).toEqual([
      'Stage: Testing',
      'PIC: Ann',
      'PIC: TBD',
      'Status: Overdue',
      'Search: hi',
      'Plan Date: from Thu, Oct 01, 26 or TBD',
    ]);
    const removed = chips[0]!.remove(view);
    expect(removed.stage).toEqual([]);
    expect(activeChips(removed, stages, persons)).toHaveLength(5);
  });
  it('clearFilters keeps the tab and sort', () => {
    const cleared = clearFilters(parse('tab=pending&q=a&stage=2&sort=-name&page=2'));
    expect(cleared.tab).toBe('pending');
    expect(cleared.sort).toBe('name');
    expect(cleared.q).toBe('');
    expect(cleared.stage).toEqual([]);
    expect(cleared.page).toBe(1);
  });
  it('summary presets replace all other filters', () => {
    const view = summaryPreset(parse('tab=pending&q=a&stage=2'), { status: ['overdue'] });
    expect(view.status).toEqual(['overdue']);
    expect(view.tab).toBe('all');
    expect(view.q).toBe('');
    expect(view.stage).toEqual([]);
  });
});
