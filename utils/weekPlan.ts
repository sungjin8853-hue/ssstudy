import { StudyLog, Subject } from '../types';
import { calculateRecentTimedPageAverage, calculateStats, getReviewEfficiencySamples } from './math';
import { estimateSubjectEndDate } from './completionEstimate';
import { getPageLabel } from './pageLabel';
import {
  calculateFreshWeekdayPagePlan,
  cleanWeekdayPagePlan,
  getAllSubjectReviewIds,
  getDiffDays,
  getLocalDateKey,
  getLogStudyDate,
  getPlanningDayCount,
  getStudyDateForWeekday,
  getSubjectDayRemainingPages,
  getSubjectRemainingPageCount,
  getWeekdayPagePlan,
  getWeekdayPageStep,
  normalizeWeekdays,
  parseStudyDate,
  WEEKDAYS
} from './schedule';

/**
 * 학습 설정(과목·폴더 관리)의 요일별 필요 시간이 쓰는 계산.
 * 요일(월~일)마다 과목별 권장량 · 필요 시간 · 편차를 모은다.
 *  - 권장량: 그 요일에 풀기로 계획한 양. 오늘은 학습 실행의 "오늘 권장"과 같은 값(밀린 양 포함)이다.
 *  - 필요 시간: 권장량 × 그 과목의 평균 효율(분/페이지).
 *  - 편차: 효율의 표준편차(σ, 분/페이지) × 권장량 = 필요 시간이 얼마나 흔들릴 수 있는지(분).
 *    하루 합계의 편차는 과목들이 서로 독립이라고 보고 제곱의 합의 제곱근으로 합친다.
 */
export interface WeekCell {
  weekday: number;
  /** 권장량(페이지). 오늘이면 밀린 양을 포함한다 */
  pages: number;
  /** 그중 밀린 양(오늘만) */
  carryover: number;
  minutes: number;
  /** 편차(분) */
  spreadMinutes: number;
  /** 이 요일을 학습 요일로 정했는가 */
  scheduled: boolean;
}

export interface WeekRow {
  subject: Subject;
  label: string;
  /** 평균 효율(분/페이지)과 그 표준편차 */
  efficiency: number;
  sigma: number;
  remaining: number;
  diffDays: number;
  endDate: Date | null;
  /** 최근 7일(오늘 포함) 하루 평균 공부 시간(분)과 페이지 */
  avgDailyMinutes: number;
  avgDailyPages: number;
  /** 요일별 권장량을 직접 고칠 수 있는가: 마감까지 7일 이상 남아 있어야 한다(그보다 짧으면 자동으로 나눈다) */
  planEditable: boolean;
  scheduledWeekdays: number[];
  cells: Record<number, WeekCell>;
}

export interface WeekDay {
  weekday: number;
  label: string;
  /** 그 요일이 다음에 오는 날(오늘이면 오늘) */
  dateKey: string;
  isToday: boolean;
  minutes: number;
  spreadMinutes: number;
  /** 그 요일에 공부하는 과목 수 */
  subjectCount: number;
  /** 과목 id → 그날 필요 시간에서 차지하는 비율(0~1) */
  shares: Record<string, number>;
}

export interface WeekPlan {
  rows: WeekRow[];
  days: WeekDay[];
  /** 공부하는 요일들의 필요 시간 평균(분) */
  activeDayAverageMinutes: number;
}

const roundMinutes = (value: number) => Math.round(value * 10) / 10;

/** 설정 화면에 나올 과목: 복습과목과 후행과목 원본(합쳐지기 전 과목)은 빼고, 아직 남은 양이 있는 학습과목 */
export const getWeekPlanSubjects = (subjects: Subject[]) => {
  const reviewIds = new Set(subjects.flatMap(getAllSubjectReviewIds));
  const sourceIds = new Set(subjects.flatMap(subject => (subject.followUpSubjects || []).flatMap(stage => stage.sourceSubjectId ? [stage.sourceSubjectId] : [])));
  return subjects.filter(subject => !reviewIds.has(subject.id) && !sourceIds.has(subject.id) && getSubjectRemainingPageCount(subject) > 0);
};

/**
 * 복습과목 하나의 요일별 권장량과 필요 시간. 복습과목은 설정 화면 목록에 따로 나오지 않으므로(getWeekPlanSubjects),
 * 그것을 거느린 과목 카드에 합쳐 보여 줄 때만 쓴다. 효율은 복습과목이 따로 잰 값이고, 재지 않았으면 거느린 과목의 효율을 그대로 쓴다.
 * 오늘 칸에 밀린 양은 더하지 않는다(복습은 정해진 날에 밀리는 일이 아니라 남은 양을 마감까지 나눈 것).
 */
export const buildReviewWeekCells = (
  logs: StudyLog[], parent: Subject, review: Subject, parentEfficiency: number, now = new Date()
): Record<number, WeekCell> => {
  const remaining = getSubjectRemainingPageCount(review);
  const plan = remaining > 0 ? getWeekdayPagePlan(review, remaining, getDiffDays(review.targetDate, now), now) : {};
  const own = calculateRecentTimedPageAverage(getReviewEfficiencySamples(logs, parent.id, review.id));
  const measured = own.averageTimePerPage > 0;
  const efficiency = measured ? own.averageTimePerPage : parentEfficiency;
  const sigma = measured ? own.standardDeviation : 0;
  const scheduled = normalizeWeekdays(review.scheduledWeekdays);
  const cells: Record<number, WeekCell> = {};
  WEEKDAYS.forEach(({ id }) => {
    const pages = Math.max(0, (plan as Record<number, number>)[id] || 0);
    cells[id] = { weekday: id, pages, carryover: 0, minutes: roundMinutes(pages * efficiency), spreadMinutes: roundMinutes(pages * sigma), scheduled: scheduled.includes(id) };
  });
  return cells;
};

/** 요일별 칸들을 요일마다 더한다(편차는 서로 독립이라고 보고 제곱의 합의 제곱근) */
export const mergeWeekCells = (parts: Array<Record<number, WeekCell>>): Record<number, WeekCell> => {
  const cells: Record<number, WeekCell> = {};
  WEEKDAYS.forEach(({ id }) => {
    const items = parts.map(part => part[id]).filter((cell): cell is WeekCell => Boolean(cell));
    cells[id] = {
      weekday: id,
      pages: items.reduce((sum, cell) => sum + cell.pages, 0),
      carryover: items.reduce((sum, cell) => sum + cell.carryover, 0),
      minutes: roundMinutes(items.reduce((sum, cell) => sum + cell.minutes, 0)),
      spreadMinutes: roundMinutes(Math.sqrt(items.reduce((sum, cell) => sum + cell.spreadMinutes ** 2, 0))),
      scheduled: items.some(cell => cell.scheduled)
    };
  });
  return cells;
};

export const buildWeekPlan = (subjects: Subject[], logs: StudyLog[], now = new Date()): WeekPlan => {
  const todayKey = getLocalDateKey(now);
  const todayWeekday = now.getDay();
  const weekStart = parseStudyDate(todayKey);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartKey = getLocalDateKey(weekStart);

  const rows: WeekRow[] = getWeekPlanSubjects(subjects).map(subject => {
    const subjectLogs = logs.filter(log => log.subjectId === subject.id);
    const remaining = getSubjectRemainingPageCount(subject);
    const diffDays = getDiffDays(subject.targetDate, now);
    const doneToday = subjectLogs.filter(log => getLogStudyDate(log) === todayKey).reduce((sum, log) => sum + log.pagesRead, 0);
    const plan = getWeekdayPagePlan(subject, remaining + doneToday, diffDays, now);
    // 오늘 칸은 학습 실행의 "오늘 권장"과 같게: 오늘 이미 한 양과 남은 권장량을 더한 하루치(밀린 양 포함)
    const today = getSubjectDayRemainingPages(subject, logs, todayWeekday, todayKey, now);
    const todayPages = today.remainingDayPages + today.scopedPages;
    const scheduled = normalizeWeekdays(subject.scheduledWeekdays);
    const stats = calculateStats(subjectLogs, remaining, todayPages || Math.max(0, ...Object.values(plan)), subject.initialAverageTimePerPage);
    const efficiency = stats.averageTimePerPage;
    const sigma = stats.standardDeviation;
    const weekly = subjectLogs.filter(log => {
      const date = getLogStudyDate(log);
      return date >= weekStartKey && date <= todayKey;
    });
    const cells: Record<number, WeekCell> = {};
    WEEKDAYS.forEach(({ id }) => {
      const isToday = id === todayWeekday;
      const planned = Math.max(0, plan[id] || 0);
      const pages = isToday ? Math.max(0, todayPages) : planned;
      cells[id] = {
        weekday: id,
        pages,
        carryover: isToday ? Math.max(0, pages - planned) : 0,
        minutes: roundMinutes(pages * efficiency),
        spreadMinutes: roundMinutes(pages * sigma),
        scheduled: scheduled.includes(id)
      };
    });
    return {
      subject,
      label: getPageLabel(subject),
      efficiency,
      sigma,
      remaining,
      diffDays,
      endDate: estimateSubjectEndDate(subjects, logs, subject.id),
      avgDailyMinutes: weekly.reduce((sum, log) => sum + log.timeSpentMinutes, 0) / 7,
      avgDailyPages: weekly.reduce((sum, log) => sum + log.pagesRead, 0) / 7,
      planEditable: getPlanningDayCount(diffDays) >= 7,
      scheduledWeekdays: scheduled,
      cells
    };
  });

  const days: WeekDay[] = WEEKDAYS.map(({ id, label }) => {
    const active = rows.filter(row => row.cells[id].pages > 0);
    const minutes = active.reduce((sum, row) => sum + row.cells[id].minutes, 0);
    const spread = Math.sqrt(active.reduce((sum, row) => sum + row.cells[id].spreadMinutes ** 2, 0));
    const shares: Record<string, number> = {};
    active.forEach(row => { shares[row.subject.id] = minutes > 0 ? row.cells[id].minutes / minutes : 0; });
    return {
      weekday: id, label, dateKey: getStudyDateForWeekday(id, now), isToday: id === todayWeekday,
      minutes: roundMinutes(minutes), spreadMinutes: roundMinutes(spread), subjectCount: active.length, shares
    };
  });
  const activeDays = days.filter(day => day.minutes > 0);
  return {
    rows, days,
    activeDayAverageMinutes: activeDays.length > 0 ? activeDays.reduce((sum, day) => sum + day.minutes, 0) / activeDays.length : 0
  };
};

/** 학습 요일이나 마감일을 바꿀 때: 요일별 권장량을 자동 배분으로 다시 만든 과목 */
export const withFreshWeekPlan = (subject: Subject): Subject => ({
  ...subject,
  scheduledWeekdayWeights: undefined,
  scheduledWeekdayRemainderDay: undefined,
  scheduledWeekdayPages: calculateFreshWeekdayPagePlan(subject, getSubjectRemainingPageCount(subject), getDiffDays(subject.targetDate))
});

/** 요일별 페이지를 직접 고친 과목인가: 저장된 요일별 페이지가 자동 배분과 다르면 직접 정한 것으로 본다 */
export const hasCustomWeekdayPages = (subject: Subject): boolean => {
  const stored = subject.scheduledWeekdayPages || {};
  if (Object.keys(stored).length === 0) return false;
  const fresh = calculateFreshWeekdayPagePlan(subject, getSubjectRemainingPageCount(subject), getDiffDays(subject.targetDate));
  return normalizeWeekdays(subject.scheduledWeekdays).some(day => Math.max(0, Math.round(Number(stored[day]) || 0)) !== (fresh[day] || 0));
};

/**
 * 수정 화면에서 저장할 요일별 페이지.
 *  - 이번 수정에서 + / − 로 고쳤으면 그 값(쉬는 요일은 뺀다).
 *  - 안 고쳤고, 전에 직접 정해 둔 값이 있고, 학습 요일과 마감일도 그대로면 그 값을 그대로 둔다(이름만 바꿔도 사라지지 않게).
 *  - 그 밖에는 요일·마감일에 맞춰 자동으로 다시 나눈다(전에 수정 화면이 하던 일).
 */
export const resolveSavedWeekdayPages = (subject: Subject, next: Subject, edited: Record<string, number> | null): Record<string, number> => {
  if (edited) return cleanWeekdayPagePlan(edited, next.scheduledWeekdays);
  const sameDays = normalizeWeekdays(subject.scheduledWeekdays).join() === normalizeWeekdays(next.scheduledWeekdays).join();
  if (sameDays && subject.targetDate === next.targetDate && hasCustomWeekdayPages(subject)) {
    return cleanWeekdayPagePlan(subject.scheduledWeekdayPages || {}, next.scheduledWeekdays);
  }
  return calculateFreshWeekdayPagePlan(next, getSubjectRemainingPageCount(next), getDiffDays(next.targetDate));
};

/* ───────────── 요일별 페이지(과목의 페이지 단위로 조정) ───────────── */

const currentWeekdayPlan = (subject: Subject) => getWeekdayPagePlan(subject, getSubjectRemainingPageCount(subject), getDiffDays(subject.targetDate));

/**
 * 한 요일의 페이지를 과목의 페이지 단위(없으면 1)만큼 늘이거나(direction 1) 줄인다(최소 0). amount를 주면 그만큼(예: 1쪽씩 미세 조정).
 * 그 요일만 바뀐다: 합계가 달라질 수 있고, 나중에 계획을 갱신하면 이 페이지 비율대로 다시 나뉜다. 쉬는 요일은 그대로.
 */
export const stepWeekdayPages = (subject: Subject, dayId: number, direction: 1 | -1, amount: number = getWeekdayPageStep(subject)): Subject => {
  const days = normalizeWeekdays(subject.scheduledWeekdays);
  if (!days.includes(dayId)) return subject;
  const plan = currentWeekdayPlan(subject);
  const next = Math.max(0, Math.min(999, Math.round(plan[dayId] || 0) + direction * amount));
  return { ...subject, scheduledWeekdayPages: cleanWeekdayPagePlan({ ...plan, [dayId]: next }, days) };
};

/**
 * 학습 요일을 켜고 끈다(마지막 하나는 끌 수 없다). 한 주 필요 페이지를 남은 요일의 지금 페이지 비율대로 다시 나누고,
 * 새로 켠 요일은 다른 요일들의 평균 몫으로 시작한다.
 */
export const toggleStudyWeekday = (subject: Subject, dayId: number): Subject => {
  const days = normalizeWeekdays(subject.scheduledWeekdays);
  const next = days.includes(dayId) ? days.filter(day => day !== dayId) : [...days, dayId];
  if (next.length === 0) return subject;
  const ordered = WEEKDAYS.map(day => day.id).filter(id => next.includes(id));
  // 새로 켠 요일에는 저장된 값이 없어야 평균으로 시작한다(끄면서 남은 0이 몫이 되지 않게)
  const kept = cleanWeekdayPagePlan(currentWeekdayPlan(subject), days.filter(day => ordered.includes(day)));
  const base: Subject = { ...subject, scheduledWeekdays: ordered, scheduledWeekdayPages: kept };
  return { ...base, scheduledWeekdayPages: cleanWeekdayPagePlan(calculateFreshWeekdayPagePlan(base, getSubjectRemainingPageCount(base), getDiffDays(base.targetDate)), ordered) };
};

/** 분을 "2시간 14분" / "45분" / "0분"으로 */
export const formatDuration = (minutes: number) => {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours <= 0) return `${rest}분`;
  return rest > 0 ? `${hours}시간 ${rest}분` : `${hours}시간`;
};

/** 좁은 칸에 쓰는 짧은 형태: "2h 14m" */
export const formatDurationShort = (minutes: number) => {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, '0')}m` : `${rest}m`;
};
