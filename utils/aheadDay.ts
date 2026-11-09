import type { StudyLog, Subject } from '../types';
import {
  getDiffDays,
  getLocalDateKey,
  getLogStudyDate,
  getPastPlanBalance,
  getSubjectDayTarget,
  getSubjectRemainingPageCount,
  getWeekdayPagePlan,
  normalizeWeekdays,
  parseStudyDate
} from './schedule';
import { calculateRecentCompletedDayAverage } from './math';

/**
 * 9일 "다음 학습일 치를 그날 이전에 모두 끝냈다 하더라도 그 학습일에 그 과목이 오늘 할 일에 빨간색으로 뜬다":
 * 오늘이 학습 요일이고 오늘 몫이 있는데, 지난날 더 한 양(미리 한 양)이 오늘 몫을 다 덮어 오늘 할 양이 0인 과목.
 * 오늘 이미 그 과목을 공부했으면(끝낸 과목 · 초록) 여기 없다.
 */
export interface AheadDay {
  subjectId: string;
  /** 오늘 원래 몫(페이지) */
  dayTarget: number;
  /** 오늘까지 미리 한 양(페이지). dayTarget 이상이다 */
  aheadPages: number;
}

export const buildAheadDays = (
  subjects: Subject[], logs: StudyLog[], weekday: number, dateKey: string, today = new Date(), skipIds: ReadonlySet<string> = new Set()
): AheadDay[] => subjects.flatMap(subject => {
  if (skipIds.has(subject.id) || getSubjectRemainingPageCount(subject) <= 0) return [];
  if (!normalizeWeekdays(subject.scheduledWeekdays).includes(weekday)) return [];
  if (logs.some(log => log.subjectId === subject.id && getLogStudyDate(log) === dateKey && log.pagesRead > 0)) return [];
  const aheadPages = Math.max(0, -getPastPlanBalance(subject, logs, dateKey, dateKey));
  if (aheadPages <= 0) return [];
  const remaining = getSubjectRemainingPageCount(subject);
  const dayTarget = getSubjectDayTarget(subject, remaining, getDiffDays(subject.targetDate, today), weekday, today);
  if (dayTarget <= 0 || aheadPages < dayTarget) return [];
  return [{ subjectId: subject.id, dayTarget, aheadPages }];
});

export interface AheadFinishPlan {
  remainingPages: number;
  /** 남은 양을 끝내는 데 걸리는 총 시간(분). 속도를 모르면 0 */
  totalMinutes: number;
  /** 지금 요일별 할당량대로 오늘부터 하면 끝내는 데 드는 학습일 수와 그 마지막 날 */
  studyDaysNeeded: number;
  plainFinishDate: string | null;
  /** 오늘(누른 빨간 할 일)은 하고, 그 밖에 미리 끝낸 학습일은 쉬면 끝나는 날(공부하는 마지막 날: 쉬는 요일로 미루지 않는다) */
  finishDate: string | null;
  /** 오늘 뒤로 미리 끝낸 학습일(쉬는 날) */
  skippedDates: string[];
}

/**
 * "오늘 학습"을 눌렀을 때의 계산.
 *  - 총 시간: 남은 양 × 최근 하루 평균 효율(재기 전이면 임시값)
 *  - 필요 일수: 오늘부터 학습 요일마다 지금 요일별 할당량만큼 하면 며칠(학습일)
 *  - 완료 날짜: 오늘은 하고, 미리 한 양이 덮는 그다음 학습일들은 쉰다는 조건으로 다시 구한 마지막 공부 날
 */
export const aheadFinishPlan = (subject: Subject, logs: StudyLog[], ahead: AheadDay, today = new Date()): AheadFinishPlan => {
  const remainingPages = getSubjectRemainingPageCount(subject);
  const subjectLogs = logs.filter(log => log.subjectId === subject.id && log.pagesRead > 0 && log.timeSpentMinutes > 0);
  const measured = calculateRecentCompletedDayAverage(subjectLogs, remainingPages).averageTimePerPage;
  const perPage = measured > 0 ? measured : Math.max(0, subject.initialAverageTimePerPage || 0);
  const plan = getWeekdayPagePlan(subject, remainingPages, getDiffDays(subject.targetDate, today), today);
  const scheduled = normalizeWeekdays(subject.scheduledWeekdays);
  const start = parseStudyDate(getLocalDateKey(today));
  const walk = (skipAhead: boolean) => {
    let left = remainingPages;
    let aheadLeft = Math.max(0, ahead.aheadPages - ahead.dayTarget);
    let days = 0;
    const skipped: string[] = [];
    for (let offset = 0; offset < 3650 && left > 0; offset += 1) {
      const date = new Date(start);
      date.setDate(date.getDate() + offset);
      const weekday = date.getDay();
      const quota = Math.max(0, plan[weekday] || 0);
      if (!scheduled.includes(weekday) || quota <= 0) continue;
      let study = quota;
      if (skipAhead && offset > 0 && aheadLeft > 0) {
        const cover = Math.min(aheadLeft, quota);
        aheadLeft -= cover;
        study = quota - cover;
        if (study <= 0) { skipped.push(getLocalDateKey(date)); continue; }
      }
      left -= study;
      days += 1;
      if (left <= 0) return { days, finish: getLocalDateKey(date), skipped };
    }
    return { days, finish: null as string | null, skipped };
  };
  const plain = walk(false);
  const skipping = walk(true);
  return {
    remainingPages,
    totalMinutes: remainingPages * perPage,
    studyDaysNeeded: plain.days,
    plainFinishDate: plain.finish,
    finishDate: skipping.finish,
    skippedDates: skipping.skipped
  };
};
