import { useCallback, useSyncExternalStore } from 'react';

/**
 * 9일 "뽀모도로 한 번 끝날 때마다 사용자가 5분 단위로 정해 둔 쉬는 시간 타이머": 쉬는 시간 길이(분, 5분 단위)와
 * 지금 돌아가는 쉬는 시간이 끝나는 때(ms)를 이 기기에 둔다. 학습 실행의 "오늘 할 일" 왼쪽과 측정 화면이 같은 값을 본다.
 */
export const DEFAULT_REST_MINUTES = 5;
export const REST_STEP_MINUTES = 5;
export const MIN_REST_MINUTES = 5;
export const MAX_REST_MINUTES = 60;
export const REST_MINUTES_KEY = 'swp_rest_minutes';
export const REST_ENDS_AT_KEY = 'swp_rest_ends_at';

export const normalizeRestMinutes = (value: unknown) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(number)) return DEFAULT_REST_MINUTES;
  const snapped = Math.round(number / REST_STEP_MINUTES) * REST_STEP_MINUTES;
  return Math.min(MAX_REST_MINUTES, Math.max(MIN_REST_MINUTES, snapped));
};

const read = (key: string) => {
  try { return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null; } catch { return null; }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* 저장이 막혀 있어도 이번 화면에서는 그대로 쓴다 */ }
};

let cachedMinutes: number | null = null;
let cachedEndsAt: number | null | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

export const readRestMinutes = () => {
  if (cachedMinutes === null) {
    const raw = read(REST_MINUTES_KEY);
    cachedMinutes = raw === null ? DEFAULT_REST_MINUTES : normalizeRestMinutes(raw);
  }
  return cachedMinutes;
};
export const writeRestMinutes = (value: number) => {
  cachedMinutes = normalizeRestMinutes(value);
  write(REST_MINUTES_KEY, String(cachedMinutes));
  notify();
};

export const readRestEndsAt = (): number | null => {
  if (cachedEndsAt === undefined) {
    const raw = Number(read(REST_ENDS_AT_KEY));
    cachedEndsAt = Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  return cachedEndsAt;
};
export const writeRestEndsAt = (value: number | null) => {
  cachedEndsAt = value;
  write(REST_ENDS_AT_KEY, value === null ? null : String(value));
  notify();
};
/** 정해 둔 길이로 쉬는 시간을 (다시) 시작한다 */
export const startRest = (now = Date.now()) => writeRestEndsAt(now + readRestMinutes() * 60 * 1000);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== REST_MINUTES_KEY && event.key !== REST_ENDS_AT_KEY) return;
    cachedMinutes = null;
    cachedEndsAt = undefined;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};

export const useRestTimer = () => {
  const minutes = useSyncExternalStore(subscribe, readRestMinutes, () => DEFAULT_REST_MINUTES);
  const endsAt = useSyncExternalStore(subscribe, readRestEndsAt, () => null);
  const setMinutes = useCallback((value: number) => writeRestMinutes(value), []);
  return { minutes, endsAt, setMinutes };
};
