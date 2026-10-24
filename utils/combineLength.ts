import { useCallback, useSyncExternalStore } from 'react';

/**
 * 한 문제로 묶는 최대 길이(21:09 "최대 10까지며 사용자가 임의로 조정가능").
 *  - 능력 변환: 한 칸으로 이어지는 단위 문제를 이 개수까지 한 문제로 묶는다.
 *  - 관계쌍 묶음: 쌍의 자유도가 f면 f+1쌍까지 이어 묻는데, 그 쌍 수도 이 값을 넘지 않는다(자유도도 이 값−1까지 오른다).
 * 2~10, 기본 4(전과 같다). 이 기기에 저장된다.
 */
export const COMBINE_LENGTH_KEY = 'swp_combine_max';
export const COMBINE_LENGTH_MIN = 2;
export const COMBINE_LENGTH_MAX = 10;
export const COMBINE_LENGTH_DEFAULT = 4;

let cached: number | null = null;
const listeners = new Set<() => void>();

export const clampCombineLength = (value: number) => (Number.isFinite(value)
  ? Math.min(COMBINE_LENGTH_MAX, Math.max(COMBINE_LENGTH_MIN, Math.round(value))) : COMBINE_LENGTH_DEFAULT);

const load = (): number => {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(COMBINE_LENGTH_KEY) : null;
    return raw === null ? COMBINE_LENGTH_DEFAULT : clampCombineLength(Number(raw));
  } catch {
    return COMBINE_LENGTH_DEFAULT;
  }
};

export const readCombineLength = (): number => {
  if (cached === null) cached = load();
  return cached;
};

export const writeCombineLength = (value: number): number => {
  const next = clampCombineLength(value);
  cached = next;
  try { window.localStorage.setItem(COMBINE_LENGTH_KEY, String(next)); } catch { /* 저장이 막혀도 이번 화면에서는 쓴다 */ }
  listeners.forEach(listener => listener());
  return next;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== COMBINE_LENGTH_KEY) return;
    cached = load();
    listener();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
};

/** 지금 최대 길이와 바꾸는 함수 */
export const useCombineLength = () => {
  const value = useSyncExternalStore(subscribe, readCombineLength, () => COMBINE_LENGTH_DEFAULT);
  const set = useCallback((next: number) => writeCombineLength(next), []);
  return [value, set] as const;
};
