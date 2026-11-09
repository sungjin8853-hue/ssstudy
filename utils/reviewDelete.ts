import type { StudyLog } from '../types';

/**
 * 9일 "이미 넣은 복습을 삭제 가능하게": 오늘 할 일에 들어온 복습 칸에서 고른 복습을 지운다.
 * 지운 기록은 "복습 제외"로 저장한 기록과 같아진다: 복습 일정 · 문제 기록 · 관문 상태 · 자동 복습 표시를 지운다.
 * 공부 기록(장수 · 시간 · 범위)과 정리노트 글, 지난 복습에 쓴 시간 기록은 그대로 둔다.
 * 직접 복습에 넣은 기록은 넣은 때(reviewRegisteredAt)를 남겨 단위 · 노트 단위가 그대로다. 자동으로 넣은 기록은 넣은 때도 지운다
 * (자동 묶음에 남으면 같은 3시간 묶음에 새 기록이 들어올 때 다시 복습에 들어간다).
 */
export const excludeLogFromReview = (log: StudyLog): StudyLog => {
  const next: StudyLog = {
    ...log,
    reviewEnabled: false,
    isCondensed: true,
    isReviewed: false,
    reviewStep: undefined,
    nextReviewDate: undefined,
    reviewSubjectId: undefined,
    reviewFsrs: undefined,
    reviewQuestionSchedules: undefined,
    reviewGatePendingResult: undefined,
    reviewGatePendingSchedules: undefined,
    reviewGatePendingSteps: undefined,
    reviewGateRetry: undefined,
    reviewGateLevel: undefined,
    reviewEditIntake: undefined,
    unitReviewPending: undefined,
    basicReviewSkipped: undefined,
    autoReviewQueued: undefined,
    autoReviewRegistered: undefined,
    autoReviewAsk: undefined,
    autoReviewChosenGrade: undefined,
    autoReviewWaiting: undefined,
    autoReviewCut: undefined,
    ...(log.autoReviewRegistered ? { reviewRegisteredAt: undefined } : {})
  };
  (Object.keys(next) as Array<keyof StudyLog>).forEach(key => { if (next[key] === undefined) delete next[key]; });
  return next;
};

export interface ReviewDeleteUnit {
  key: string;
  logIds: string[];
  startPage?: number;
  endPage?: number;
  /** 이어지는 범위끼리 합친 범위들(1~4 · 7~8) */
  ranges: Array<{ start: number; end: number }>;
  /** 복습에 넣은 때(없으면 공부한 때 중 가장 이른 때) */
  at: string;
  auto: boolean;
}

/** 복습 칸의 기록을 "복습에 넣은 단위"(같은 때 넣은 기록)로 묶는다. 넣은 때가 없는 기록(예전 기록)은 하나씩 */
export const reviewDeleteUnits = (logs: readonly StudyLog[]): ReviewDeleteUnit[] => {
  const units = new Map<string, ReviewDeleteUnit>();
  logs.forEach(log => {
    const key = log.reviewRegisteredAt ? `at:${log.reviewRegisteredAt}` : `log:${log.id}`;
    const unit = units.get(key) ?? { key, logIds: [], ranges: [], at: log.reviewRegisteredAt ?? log.timestamp, auto: Boolean(log.autoReviewRegistered) };
    unit.logIds.push(log.id);
    if (Number.isFinite(log.startPage) && Number.isFinite(log.endPage)) unit.ranges.push({ start: log.startPage!, end: log.endPage! });
    if (Number.isFinite(log.startPage)) unit.startPage = Math.min(unit.startPage ?? Infinity, log.startPage!);
    if (Number.isFinite(log.endPage)) unit.endPage = Math.max(unit.endPage ?? -Infinity, log.endPage!);
    if (!log.reviewRegisteredAt && log.timestamp < unit.at) unit.at = log.timestamp;
    units.set(key, unit);
  });
  units.forEach(unit => {
    unit.ranges = unit.ranges.sort((a, b) => a.start - b.start || a.end - b.end).reduce<Array<{ start: number; end: number }>>((merged, range) => {
      const previous = merged[merged.length - 1];
      if (previous && range.start <= previous.end + 1) { previous.end = Math.max(previous.end, range.end); return merged; }
      merged.push({ ...range });
      return merged;
    }, []);
  });
  return [...units.values()].sort((a, b) => (a.startPage ?? Infinity) - (b.startPage ?? Infinity) || a.at.localeCompare(b.at));
};
