import { ChangeWindow, RolePermissions, UserRole } from '../types/inventory';

export const CHANGE_WINDOW_OPTIONS: {
  id: ChangeWindow;
  label: string;
  shortLabel: string;
}[] = [
  { id: '15m', label: '15 minutes', shortLabel: '15m' },
  { id: '1h', label: '1 hour', shortLabel: '1h' },
  { id: '2h', label: '2 hours', shortLabel: '2h' },
  { id: 'eod', label: 'End of day', shortLabel: 'End of day' },
  { id: '24h', label: '24 hours', shortLabel: '24h' },
  { id: 'none', label: 'No limit', shortLabel: 'No limit' },
];

export interface ChangeEntryCheckInput {
  createdByUid?: string;
  createdByName?: string;
  createdAt?: string;
}

export interface ChangeEntryCheckResult {
  allowed: boolean;
  reason?: string;
  minutesLeft?: number;
  timeLeftLabel?: string;
}

const IST_OFFSET_MS = 330 * 60_000; // Asia/Kolkata = UTC+05:30

export function formatMinutesLeft(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
  }
  return `${m}m`;
}

function parseEntryTimestampMs(createdAt?: string): number {
  if (!createdAt) return NaN;
  const raw = String(createdAt).trim();
  if (!raw) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T00:00:00+05:30`).getTime();
  }
  return new Date(raw).getTime();
}

function getDeadlineMs(createdMs: number, window: ChangeWindow): number | null {
  if (window === 'none') return null;
  if (Number.isNaN(createdMs)) return 0;
  switch (window) {
    case '15m':
      return createdMs + 15 * 60_000;
    case '1h':
      return createdMs + 60 * 60_000;
    case '2h':
      return createdMs + 2 * 60 * 60_000;
    case '24h':
      return createdMs + 24 * 60 * 60_000;
    case 'eod': {
      // 23:59:59.999 of entry's calendar day in Asia/Kolkata (UTC+05:30)
      const istDate = new Date(createdMs + IST_OFFSET_MS);
      const eodUtcMs = Date.UTC(
        istDate.getUTCFullYear(),
        istDate.getUTCMonth(),
        istDate.getUTCDate(),
        23,
        59,
        59,
        999
      );
      return eodUtcMs - IST_OFFSET_MS;
    }
    default:
      return createdMs + 2 * 60 * 60_000;
  }
}

export function canChangeEntry(
  entry: ChangeEntryCheckInput,
  currentUser: string | { uid?: string | null; realUserUid?: string | null } | null | undefined,
  rolePerms: Pick<RolePermissions, 'changeWindow' | 'canChangeOthersEntries'>,
  role?: UserRole
): ChangeEntryCheckResult {
  if (role === 'admin') {
    return { allowed: true };
  }

  const currentUid =
    typeof currentUser === 'string'
      ? currentUser
      : currentUser?.realUserUid || currentUser?.uid || '';

  if (!rolePerms.canChangeOthersEntries) {
    const creatorUid = (entry.createdByUid || '').trim();
    if (!creatorUid || creatorUid !== currentUid) {
      return {
        allowed: false,
        reason: `Only ${entry.createdByName || 'the creator'} can change this entry`,
      };
    }
  }

  const win: ChangeWindow = rolePerms.changeWindow || '2h';
  if (win === 'none') {
    return { allowed: true };
  }

  const createdMs = parseEntryTimestampMs(entry.createdAt);
  const deadlineMs = getDeadlineMs(createdMs, win);
  if (deadlineMs === null) {
    return { allowed: true };
  }

  const nowMs = Date.now();
  if (nowMs > deadlineMs) {
    const shortLabel = CHANGE_WINDOW_OPTIONS.find((o) => o.id === win)?.shortLabel || win;
    return {
      allowed: false,
      reason: `Locked: ${shortLabel} limit has passed`,
    };
  }

  const minutesLeft = Math.max(1, Math.ceil((deadlineMs - nowMs) / 60_000));
  return {
    allowed: true,
    minutesLeft,
    timeLeftLabel: formatMinutesLeft(minutesLeft),
  };
}

export function formatLockReason(reason?: string): string {
  const clean = (reason || 'Restricted').replace(/^Locked:\s*/i, '');
  return `🔒 Locked · ${clean}`;
}
