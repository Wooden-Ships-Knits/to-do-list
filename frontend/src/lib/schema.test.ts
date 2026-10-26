import {
  adjustedBeforePlanWarning,
  diffTaskPatch,
  diffToPatch,
  emptyFormValues,
  makeProjectSchema,
  makeTaskSchema,
  toCreateBody,
} from './schema';

const schema = makeProjectSchema('2026-10-06');
const valid = { ...emptyFormValues('current', 3), name: 'Alpha' };

const messages = (input: unknown): Record<string, string> => {
  const result = schema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message]));
};

describe('project form validation (same rules as the backend)', () => {
  it('accepts a minimal valid project', () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });
  it('requires a trimmed name of at most 200 characters', () => {
    expect(messages({ ...valid, name: '   ' }).name).toBe('Name is required');
    expect(messages({ ...valid, name: 'x'.repeat(201) }).name).toMatch(/200/);
    expect(schema.parse({ ...valid, name: '  Alpha  ' }).name).toBe('Alpha');
    expect(schema.safeParse({ ...valid, name: 'x'.repeat(200) }).success).toBe(true);
  });
  it('actual date cannot be in the future but today is fine', () => {
    expect(messages({ ...valid, actual_date: '2026-10-07' }).actual_date).toBe(
      'Actual date cannot be in the future',
    );
    expect(schema.safeParse({ ...valid, actual_date: '2026-10-06' }).success).toBe(true);
    expect(schema.safeParse({ ...valid, actual_date: '' }).success).toBe(true);
  });
  it('rejects impossible and out-of-range dates', () => {
    expect(messages({ ...valid, plan_date: '2026-02-30' }).plan_date).toBe('Enter a valid date');
    expect(messages({ ...valid, plan_date: '1999-12-31' }).plan_date).toMatch(/2000 and 2100/);
    expect(messages({ ...valid, plan_date: '2101-01-01' }).plan_date).toMatch(/2000 and 2100/);
  });
  it('requires a category and stage', () => {
    expect(messages({ ...valid, category: 'nope' }).category).toBe('Choose a category');
    expect(messages({ ...valid, stage_id: Number.NaN }).stage_id).toBe('Choose a stage');
    expect(messages({ ...valid, stage_id: 0 }).stage_id).toBe('Choose a stage');
  });
  it('an earlier adjusted date is only a warning, never an error', () => {
    const values = { ...valid, plan_date: '2026-10-20', adjusted_plan_date: '2026-10-10' };
    expect(schema.safeParse(values).success).toBe(true);
    expect(adjustedBeforePlanWarning(values.plan_date, values.adjusted_plan_date)).toMatch(
      /earlier/,
    );
    expect(adjustedBeforePlanWarning('2026-10-10', '2026-10-20')).toBeNull();
    expect(adjustedBeforePlanWarning('', '2026-10-20')).toBeNull();
  });
});

describe('payload helpers', () => {
  it('empty dates become null (TBD)', () => {
    const body = toCreateBody({ ...valid, plan_date: '2026-10-20' });
    expect(body.plan_date).toBe('2026-10-20');
    expect(body.actual_date).toBeNull();
  });
  it('diffToPatch contains only changed fields', () => {
    const next = { ...valid, description: 'new', plan_date: '2026-10-20', pic_ids: ['a'] };
    expect(diffToPatch(valid, next)).toEqual({
      description: 'new',
      plan_date: '2026-10-20',
      pic_ids: ['a'],
    });
    expect(diffToPatch(valid, valid)).toEqual({});
  });
  it('clearing a date produces null', () => {
    const before = { ...valid, plan_date: '2026-10-20' };
    expect(diffToPatch(before, { ...before, plan_date: '' })).toEqual({ plan_date: null });
  });
  it('pic order does not matter', () => {
    const before = { ...valid, pic_ids: ['a', 'b'] };
    expect(diffToPatch(before, { ...before, pic_ids: ['b', 'a'] })).toEqual({});
  });
});

describe('subtask form', () => {
  const schema = makeTaskSchema('2026-10-06');
  const valid = {
    name: ' Check totals ',
    stage_id: 1,
    notes: '- [ ] a',
    plan_date: '2026-10-10',
    adjusted_plan_date: '',
    actual_date: '',
    priority: '' as const,
    pic_ids: [],
  };

  it('uses the same rules as the backend', () => {
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, name: 'x'.repeat(201) }).success).toBe(false);
    expect(schema.safeParse({ ...valid, actual_date: '2026-10-07' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, actual_date: '2026-10-06' }).success).toBe(true);
    expect(schema.safeParse({ ...valid, plan_date: '2026-13-01' }).success).toBe(false);
  });

  it('only sends what changed (blank date = TBD)', () => {
    expect(diffTaskPatch(valid, { ...valid, name: 'Check totals' })).toEqual({});
    expect(
      diffTaskPatch(valid, { ...valid, plan_date: '', notes: '**x**', pic_ids: ['u'] }),
    ).toEqual({ plan_date: null, notes: '**x**', pic_ids: ['u'] });
  });

  it('sends priority changes, blank = no priority', () => {
    expect(schema.safeParse({ ...valid, priority: 'urgent' }).success).toBe(true);
    expect(schema.safeParse({ ...valid, priority: 'critical' }).success).toBe(false);
    expect(diffTaskPatch(valid, { ...valid, priority: 'high' })).toEqual({ priority: 'high' });
    expect(diffTaskPatch({ ...valid, priority: 'high' }, valid)).toEqual({ priority: null });
  });
});

describe('project priority', () => {
  it('is optional, validated, and only sent when changed', () => {
    expect(toCreateBody(valid).priority).toBeNull();
    expect(toCreateBody({ ...valid, priority: 'low' }).priority).toBe('low');
    expect(schema.safeParse({ ...valid, priority: 'LOW' }).success).toBe(false);
    expect(diffToPatch(valid, valid)).toEqual({});
    expect(diffToPatch(valid, { ...valid, priority: 'urgent' })).toEqual({ priority: 'urgent' });
    expect(diffToPatch({ ...valid, priority: 'urgent' }, valid)).toEqual({ priority: null });
  });
});
