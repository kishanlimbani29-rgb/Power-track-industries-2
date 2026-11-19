const WHOLE_UNIT_SET = new Set(['pc', 'pcs', 'piece', 'pieces']);

export const isWholeUnit = (unit?: string): boolean => {
  if (!unit) return false;
  return WHOLE_UNIT_SET.has(unit.trim().toLowerCase());
};

/**
 * Formats an inventory/production quantity using Indian (en-IN) thousand separators.
 * - Pieces/pcs always render as whole numbers (never ".0").
 * - kg / L / other continuous units render up to 2 decimal places without trailing zeroes.
 */
export const formatQty = (value: number | string | null | undefined, unit?: string): string => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';

  if (isWholeUnit(unit)) {
    return Math.round(num).toLocaleString('en-IN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  const rounded = Math.round(num * 100) / 100;
  return rounded.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
};

/**
 * Formats an INR currency amount using en-IN thousand separators.
 */
export const formatInrAmount = (
  value: number | string | null | undefined,
  decimals: 'auto' | 0 | 2 = 'auto'
): string => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '₹0';

  if (decimals === 0) {
    return `₹${Math.round(num).toLocaleString('en-IN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  }

  const rounded = Math.round(num * 100) / 100;
  const fractionDigits = decimals === 2 ? 2 : rounded % 1 === 0 ? 0 : 2;
  return `₹${rounded.toLocaleString('en-IN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
};

const parseDateSafe = (input?: string | Date | null): Date | null => {
  if (!input) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  const str = String(input).trim();
  if (!str) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(str) ? new Date(`${str}T00:00:00`) : new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
};

const getEnInDateTimeParts = (d: Date) => {
  const parts = new Intl.DateTimeFormat('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(d);

  const map: Record<string, string> = {};
  parts.forEach((p) => {
    if (p.type !== 'literal') map[p.type] = p.value;
  });

  return {
    month: map.month || '',
    day: map.day || '',
    year: map.year || '',
    hour: map.hour || '',
    minute: map.minute || '',
    dayPeriod: (map.dayPeriod || '').toUpperCase(),
  };
};

/**
 * Formats a timestamp using en-IN short month format: "Oct 27, 2026, 10:54 PM".
 */
export const formatDateTime = (input?: string | Date | null): string => {
  if (!input) return '—';
  const d = parseDateSafe(input);
  if (!d) return typeof input === 'string' ? input : '—';
  const { month, day, year, hour, minute, dayPeriod } = getEnInDateTimeParts(d);
  return `${month} ${day}, ${year}, ${hour}:${minute} ${dayPeriod}`.trim();
};

/**
 * Formats a date using en-IN short month format: "Oct 27, 2026".
 */
export const formatDate = (input?: string | Date | null): string => {
  if (!input) return '—';
  const d = parseDateSafe(input);
  if (!d) return typeof input === 'string' ? input : '—';
  const { month, day, year } = getEnInDateTimeParts(d);
  return `${month} ${day}, ${year}`;
};

/**
 * Formats a short list date using en-IN short month format: "Oct 27"
 * (optionally includes year when different from current year).
 */
export const formatShortDate = (
  input?: string | Date | null,
  includeYearWhenDifferent = false
): string => {
  if (!input) return '—';
  const d = parseDateSafe(input);
  if (!d) return typeof input === 'string' ? input : '—';
  const { month, day, year } = getEnInDateTimeParts(d);
  if (includeYearWhenDifferent && d.getFullYear() !== new Date().getFullYear()) {
    return `${month} ${day}, ${year}`;
  }
  return `${month} ${day}`;
};

/**
 * Formats a 12-hour time string using en-IN locale: "10:54 PM".
 */
export const formatTime12h = (input?: string | Date | null): string => {
  if (!input) return '';
  const d = parseDateSafe(input);
  if (!d) return '';
  const { hour, minute, dayPeriod } = getEnInDateTimeParts(d);
  return `${hour}:${minute} ${dayPeriod}`.trim();
};

/**
 * Shared timestamp helper alias: "Oct 27, 2026, 10:54 PM".
 */
export const formatShortDateTime = (iso?: string | Date | null): string => formatDateTime(iso);
