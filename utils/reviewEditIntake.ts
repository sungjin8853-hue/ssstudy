import { useCallback, useSyncExternalStore } from 'react';

/**
 * 노트를 그냥 고쳐도 고친 부분이 복습으로 들어가는 기능. 기본은 켜짐이고, 끌 수 있다.
 * 바꾼 값은 이 기기에 저장되어 모든 노트 화면에서 같이 쓴다.
 */
export const REVIEW_EDIT_INTAKE_KEY = 'swp_review_edit_intake';

let cached: boolean | null = null;
const listeners = new Set<() => void>();

const load = () => {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(REVIEW_EDIT_INTAKE_KEY) : null;
    return raw !== 'off';
  } catch {
    return true;
  }
};

export const readEditIntake = () => {
  if (cached === null) cached = load();
  return cached;
};

export const writeEditIntake = (value: boolean) => {
  cached = value;
  try {
    window.localStorage.setItem(REVIEW_EDIT_INTAKE_KEY, value ? 'on' : 'off');
  } catch {
    // 저장이 막혀 있어도 이번 화면에서는 바뀐 값을 그대로 쓴다.
  }
  listeners.forEach(listener => listener());
  return value;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== REVIEW_EDIT_INTAKE_KEY) return;
    cached = load();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};

/** 노트 수정분 복습 편입이 켜져 있는가와 바꾸는 함수 */
export const useEditIntake = () => {
  const on = useSyncExternalStore(subscribe, readEditIntake, () => true);
  const setOn = useCallback((value: boolean) => writeEditIntake(value), []);
  return [on, setOn] as const;
};
