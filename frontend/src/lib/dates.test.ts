import { addDays, formatDate, formatDateTime, isValidIsoDate } from './dates';

describe('formatDate', () => {
  it('uses the "Tue, Oct 06, 26" display format', () => {
    expect(formatDate('2026-10-06')).toBe('Tue, Oct 06, 26');
    expect(formatDate('2026-01-01')).toBe('Thu, Jan 01, 26');
    expect(formatDate('2100-12-31')).toBe('Fri, Dec 31, 00');
  });

  it('shows TBD for empty or invalid values', () => {
    expect(formatDate(null)).toBe('TBD');
    expect(formatDate('')).toBe('TBD');
    expect(formatDate('2026-02-30')).toBe('TBD');
    expect(formatDate(null, 'Not done')).toBe('Not done');
  });

  it('does not shift by timezone', () => {
    const original = process.env.TZ;
    for (const tz of ['Pacific/Kiritimati', 'America/Los_Angeles', 'Asia/Makassar']) {
      process.env.TZ = tz;
      expect(formatDate('2026-10-06')).toBe('Tue, Oct 06, 26');
    }
    process.env.TZ = original;
  });
});

describe('isValidIsoDate', () => {
  it('validates real calendar dates', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2024-02-29')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('26-1-1')).toBe(false);
  });
});

describe('addDays', () => {
  it('adds across month and year boundaries', () => {
    expect(addDays('2026-10-06', 7)).toBe('2026-10-13');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('formatDateTime', () => {
  it('renders timestamps in the business timezone', () => {
    expect(formatDateTime('2026-10-06T15:59:00Z', 'Asia/Makassar')).toBe('Tue, Oct 06, 26 23:59');
    expect(formatDateTime('2026-10-06T16:00:00Z', 'Asia/Makassar')).toBe('Wed, Oct 07, 26 00:00');
  });
});
