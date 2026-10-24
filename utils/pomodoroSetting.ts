import { useCallback, useSyncExternalStore } from 'react';

/**
 * 뽀모도로 한 번의 길이(분). 기본은 25분이고, 화면의 ▲▼ 버튼으로 5분씩 늘리거나 줄일 수 있다.
 * 바꾼 값은 이 기기에 저장되어 다음 학습·복습에서도 그대로 쓴다(학습과 기본 복습이 같은 값을 쓴다).
 */
export const DEFAULT_POMODORO_MINUTES = 25;
export const POMODORO_STEP_MINUTES = 5;
export const MIN_POMODORO_MINUTES = 5;
export const MAX_POMODORO_MINUTES = 90;
export const POMODORO_MINUTES_KEY = 'swp_pomodoro_minutes';

/** 5분 단위로 맞추고 5~90분 안으로 가둔다. 숫자가 아니면 기본값. */
export const normalizePomodoroMinutes = (value: unknown) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(number)) return DEFAULT_POMODORO_MINUTES;
  const snapped = Math.round(number / POMODORO_STEP_MINUTES) * POMODORO_STEP_MINUTES;
  return Math.min(MAX_POMODORO_MINUTES, Math.max(MIN_POMODORO_MINUTES, snapped));
};

/** 위(+1)·아래(-1) 버튼을 한 번 눌렀을 때의 새 값. 끝에 닿으면 그대로. */
export const stepPomodoroMinutes = (minutes: number, direction: 1 | -1) => (
  normalizePomodoroMinutes(normalizePomodoroMinutes(minutes) + direction * POMODORO_STEP_MINUTES)
);

let cachedMinutes: number | null = null;
const listeners = new Set<() => void>();

const loadMinutes = () => {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(POMODORO_MINUTES_KEY) : null;
    return raw === null ? DEFAULT_POMODORO_MINUTES : normalizePomodoroMinutes(raw);
  } catch {
    return DEFAULT_POMODORO_MINUTES;
  }
};

export const readPomodoroMinutes = () => {
  if (cachedMinutes === null) cachedMinutes = loadMinutes();
  return cachedMinutes;
};

export const writePomodoroMinutes = (value: number) => {
  const next = normalizePomodoroMinutes(value);
  cachedMinutes = next;
  try {
    window.localStorage.setItem(POMODORO_MINUTES_KEY, String(next));
  } catch {
    // 저장이 막혀 있어도 이번 화면에서는 바뀐 값을 그대로 쓴다.
  }
  listeners.forEach(listener => listener());
  return next;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== POMODORO_MINUTES_KEY) return;
    cachedMinutes = loadMinutes();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};

/** 지금 뽀모도로 길이(분)와 바꾸는 함수. 값을 쓰는 모든 화면이 같이 다시 그려진다. */
export const usePomodoroMinutes = () => {
  const minutes = useSyncExternalStore(subscribe, readPomodoroMinutes, () => DEFAULT_POMODORO_MINUTES);
  const setMinutes = useCallback((value: number) => writePomodoroMinutes(value), []);
  return [minutes, setMinutes] as const;
};
