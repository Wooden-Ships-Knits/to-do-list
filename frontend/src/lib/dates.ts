/** Business dates are plain ISO strings (YYYY-MM-DD); they are never converted through Date
 *  objects in the local timezone, so they cannot shift by a day. */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MIN_DATE = '2000-01-01';
export const MAX_DATE = '2100-12-31';

export function isValidIsoDate(value: string): boolean {
  const match = ISO.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** "Tue, Oct 06, 26" — the display format used everywhere. */
export function formatDate(value: string | null | undefined, empty = 'TBD'): string {
  if (!value || !isValidIsoDate(value)) return empty;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const weekday = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${MONTHS[m - 1]} ${String(d).padStart(2, '0')}, ${String(y % 100).padStart(2, '0')}`;
}

/** Timestamp (UTC ISO from the API) shown in the business timezone: "Tue, Oct 06, 26 14:05". */
export function formatDateTime(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const iso = `${get('year')}-${get('month')}-${get('day')}`;
  return `${formatDate(iso)} ${get('hour')}:${get('minute')}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}
