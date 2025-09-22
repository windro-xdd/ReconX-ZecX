export type DateLike = string | number | Date | null | undefined;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatDateTime(value: DateLike, opts?: { utc?: boolean; fallback?: string }): string {
  const utc = opts?.utc ?? false;
  const fallback = opts?.fallback ?? 'N/A';
  if (value == null) return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return fallback;
  const Y = utc ? d.getUTCFullYear() : d.getFullYear();
  const M = pad((utc ? d.getUTCMonth() : d.getMonth()) + 1);
  const D = pad(utc ? d.getUTCDate() : d.getDate());
  const h = pad(utc ? d.getUTCHours() : d.getHours());
  const m = pad(utc ? d.getUTCMinutes() : d.getMinutes());
  const s = pad(utc ? d.getUTCSeconds() : d.getSeconds());
  return `${Y}-${M}-${D} ${h}:${m}:${s}${utc ? ' UTC' : ''}`;
}
