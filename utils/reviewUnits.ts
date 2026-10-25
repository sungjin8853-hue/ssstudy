import type { StudyLog } from '../types';

/**
 * 단위(15:28 결정): 페이지 수로 나누던 "페이지 단위"를 없애고, 복습에 넣은 때로 단위를 나눈다.
 *  - 학습과목: 이전 "복습에 넣기"부터 다음 "복습에 넣기"까지가 한 단위다(처음 단위는 처음 시작부터 첫 "복습에 넣기"까지).
 *    아직 복습에 넣지 않은 기록들은 지금 채우는 단위다.
 *  - 복습과목: 복습 한 번(그 복습과목을 "복습 완료"로 마친 때까지)이 한 단위다.
 * 단위의 끝(경계)은 시각이다. 기록은 그 시각 이하에 끝난 첫 경계의 단위에 든다(경계 시각보다 늦은 기록은 다음 단위).
 */

/** 학습과목의 단위 경계: "복습에 넣기"를 누른 시각들(오래된 것부터). */
export const registrationBoundaries = (logs: readonly StudyLog[]): number[] => {
  const times = new Set<number>();
  // 예전 기록(누른 시각을 남기기 전)은 같은 범위로 함께 들어간 기록들의 가장 늦은 시각을 경계로 본다
  const legacy = new Map<string, number>();
  logs.forEach(log => {
    if (log.reviewParentSubjectId || log.unitReviewPending) return;
    const at = log.reviewRegisteredAt ? Date.parse(log.reviewRegisteredAt) : NaN;
    if (Number.isFinite(at)) { times.add(at); return; }
    if (!log.reviewUnitRange) return;
    const key = `${log.subjectId}:${log.reviewUnitRange.start}:${log.reviewUnitRange.end}`;
    const time = Date.parse(log.timestamp);
    if (Number.isFinite(time)) legacy.set(key, Math.max(legacy.get(key) ?? -Infinity, time));
  });
  legacy.forEach(time => times.add(time));
  return [...times].sort((a, b) => a - b);
};

/** 복습과목의 단위 경계: 원래 과목(parentSubjectId)의 기록을 그 복습과목으로 복습해 마친 시각들(오래된 것부터). */
export const reviewCompletionBoundaries = (logs: readonly StudyLog[], parentSubjectId: string, reviewSubjectId: string): number[] => {
  const times = new Set<number>();
  logs.forEach(log => {
    if (log.subjectId !== parentSubjectId && log.reviewParentSubjectId !== parentSubjectId) return;
    (log.reviewSubjectTimeRecords || []).forEach(record => {
      if (record.subjectId !== reviewSubjectId || record.completed !== true) return;
      const at = Date.parse(record.timestamp);
      if (Number.isFinite(at)) times.add(at);
    });
  });
  return [...times].sort((a, b) => a - b);
};

/** 시각이 몇 번째 단위(0부터)에 드는가: 그 시각보다 이른 경계의 수. 마지막 경계보다 늦으면 지금 채우는 단위(경계 수). */
export const unitIndexAt = (timeMs: number, boundaries: readonly number[]) => {
  let index = 0;
  while (index < boundaries.length && boundaries[index] < timeMs) index += 1;
  return index;
};
