import type { ActivityEntry } from '../api/types';
import { actorName, describeActivity, describePatch } from './describe';

const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
  id: 1,
  project_id: 'p',
  task_id: null,
  task_name: null,
  field: 'name',
  old_value: null,
  new_value: null,
  changed_at: '2026-10-06T04:00:00Z',
  actor: null,
  ...over,
});

describe('project history: subtask entries', () => {
  const sub = { task_id: 't', task_name: 'Validation sign-off' };

  it('describes every kind of subtask change', () => {
    expect(describeActivity(entry({ ...sub, field: 'task', new_value: 'created' }))).toBe(
      'Subtask "Validation sign-off" added',
    );
    expect(
      describeActivity(
        entry({ ...sub, field: 'position', old_value: 'Project #2', new_value: "'A' #1" }),
      ),
    ).toBe('Subtask "Validation sign-off" moved from Project #2 to \'A\' #1');
    expect(describeActivity(entry({ ...sub, field: 'deleted_at', new_value: 'x' }))).toBe(
      'Subtask "Validation sign-off" deleted',
    );
    expect(describeActivity(entry({ ...sub, field: 'deleted_at', old_value: 'x' }))).toBe(
      'Subtask "Validation sign-off" restored',
    );
    expect(
      describeActivity(entry({ ...sub, field: 'name', old_value: 'Old', new_value: 'New' })),
    ).toBe('Subtask renamed: Old to New');
    expect(describeActivity(entry({ ...sub, field: 'notes', new_value: '# big' }))).toBe(
      'Subtask "Validation sign-off": notes updated',
    );
    expect(
      describeActivity(entry({ ...sub, field: 'stage', old_value: 'Testing', new_value: 'Done' })),
    ).toBe('Subtask "Validation sign-off": Stage Testing to Done');
    expect(describeActivity(entry({ ...sub, field: 'actual_date', new_value: '2026-10-06' }))).toBe(
      'Subtask "Validation sign-off": Actual date set to Tue, Oct 06, 26',
    );
    expect(describeActivity(entry({ ...sub, field: 'pics', new_value: 'Ann' }))).toBe(
      'Subtask "Validation sign-off": PIC TBD to Ann',
    );
  });

  it('project entries are unchanged', () => {
    expect(describeActivity(entry({ field: 'project', new_value: 'created' }))).toBe(
      'Project created',
    );
  });
});

describe('priority and who made the change', () => {
  it('names priority levels and "none"', () => {
    expect(
      describeActivity(entry({ field: 'priority', old_value: null, new_value: 'urgent' })),
    ).toBe('Priority: none to Urgent');
    expect(describeActivity(entry({ field: 'priority', old_value: 'low', new_value: null }))).toBe(
      'Priority: Low to none',
    );
    expect(
      describeActivity(
        entry({ task_id: 't', task_name: 'Sub', field: 'priority', new_value: 'high' }),
      ),
    ).toBe('Subtask "Sub": Priority none to High');
    expect(describePatch({ priority: 'normal' }, [], [])).toEqual(['Priority: Normal']);
    expect(describePatch({ priority: null }, [], [])).toEqual(['Priority: None']);
  });

  it('shows the actor, or Unknown for old entries', () => {
    expect(actorName({ id: 'u', username: 'denan', name: 'Denan' })).toBe('Denan');
    expect(actorName(null)).toBe('Unknown');
  });
});
