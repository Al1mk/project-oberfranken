const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:Z|([+-])(\d{2}):(\d{2}))?$/;

/** Calendar validation before Date.parse can normalize an impossible day. */
export function isIsoDate(value: string): boolean {
  const parts = DATE.exec(value);
  if (!parts) return false;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!;
}

/** Keep supported local/offset timestamp strings and browser parsing semantics intact. */
export function isIsoDateOrTimestamp(value: string): boolean {
  if (isIsoDate(value)) return true;
  const parts = TIMESTAMP.exec(value);
  if (!parts || !isIsoDate(parts[1]!)) return false;
  const hour = Number(parts[2]);
  const minute = Number(parts[3]);
  const second = Number(parts[4] ?? 0);
  const fraction = parts[5] ?? "0";
  if (hour > 24 || minute > 59 || second > 59) return false;
  // ISO permits the exact end of a day, but no other time in hour 24.
  if (hour === 24 && (minute !== 0 || second !== 0 || /[1-9]/.test(fraction))) return false;
  if (parts[6] && (Number(parts[7]) > 23 || Number(parts[8]) > 59)) return false;
  return !Number.isNaN(Date.parse(value));
}
