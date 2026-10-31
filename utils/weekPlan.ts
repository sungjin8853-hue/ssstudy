import { StudyLog, Subject } from '../types';
import { calculateBasicReviewAverageTimePerPage, calculateRecentTimedPageAverage, calculateStats, getReviewEfficiencySamples } from './math';
import { estimateSubjectEndDate } from './completionEstimate';
import { getSubjectFamily, isFamilyStudyLog } from './subjectChain';
import { getPageLabel } from './pageLabel';
import { getNextReviewIntervalMs, INITIAL_REVIEW_DELAY_MS } from './review';
import {
  calculateFreshWeekdayPagePlan,
  cleanWeekdayPagePlan,
  getActiveSubjectStage,
  getAllSubjectReviewIds,
  getDiffDays,
  getLocalDateKey,
  getLogStudyDate,
  getPlanningDayCount,
  getStudyDateForWeekday,
  getSubjectDayRemainingPages,
  getSubjectRemainingPageCount,
  getSubjectStages,
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
 * 복습과목 하나의 앞으로 7일(오늘부터) 요일별 복습량. 복습은 목표 날짜까지 끝내지 않아도 되므로(31일) 남은 양을 마감까지 나누지 않고,
 * 기록마다 잡힌 다음 복습 시각을 따라 돌아오는 양을 센다(지난 차례는 오늘에 모은다. 그 뒤로는 복습 간격대로 다시 돌아온다고 본다).
 * 복습과목에 남은 쪽수보다 많이 세지 않는다. 시간 = 쪽수 × 복습과목 효율(잰 값, 재기 전에는 공부의 2/3배).
 */
export const buildDueReviewWeekCells = (
  logs: StudyLog[], parent: Subject, review: Subject, parentEfficiency: number, now = new Date()
): Record<number, WeekCell> => {
  const DAY = 24 * 60 * 60 * 1000;
  const start = parseStudyDate(getLocalDateKey(now)).getTime();
  const end = start + 7 * DAY;
  const nowMs = now.getTime();
  const stages = getSubjectStages(parent);
  const events = logs
    .filter(log => log.subjectId === parent.id && !log.isCondensed && log.reviewEnabled !== false && !log.reviewParentSubjectId && log.pagesRead > 0)
    .filter(log => {
      const stage = stages.find(item => item.id === (log.subjectStageId || parent.id));
      const ids = log.reviewSubjectIdsSnapshot?.length ? log.reviewSubjectIdsSnapshot : stage?.reviewSubjectIds || [];
      return ids.includes(review.id);
    })
    .map(log => ({
      at: log.nextReviewDate ? new Date(log.nextReviewDate).getTime() : new Date(log.timestamp).getTime() + INITIAL_REVIEW_DELAY_MS,
      pages: Math.max(0, log.pagesRead),
      step: Math.max(0, log.reviewStep || 0)
    }))
    .filter(event => Number.isFinite(event.at));
  const bucket = [0, 0, 0, 0, 0, 0, 0];
  let left = getSubjectRemainingPageCount(review);
  for (let guard = 0; guard < 5000 && events.length > 0 && left > 0; guard += 1) {
    events.sort((a, b) => a.at - b.at);
    const event = events.shift()!;
    if (event.at >= end) break;
    const index = Math.max(0, Math.min(6, Math.floor((Math.max(event.at, nowMs, start) - start) / DAY)));
    const pages = Math.min(left, event.pages);
    bucket[index] += pages;
    left -= pages;
    events.push({ ...event, at: event.at + getNextReviewIntervalMs(event.step), step: event.step + 1 });
  }
  const own = calculateRecentTimedPageAverage(getReviewEfficiencySamples(logs, parent.id, review.id));
  const measured = own.averageTimePerPage > 0;
  const efficiency = measured ? own.averageTimePerPage : parentEfficiency * REVIEW_SUBJECT_PLAN_RATIO;
  const sigma = measured ? own.standardDeviation : 0;
  const scheduled = normalizeWeekdays(review.scheduledWeekdays);
  const cells: Record<number, WeekCell> = {};
  bucket.forEach((pages, index) => {
    const weekday = new Date(start + index * DAY + 12 * 60 * 60 * 1000).getDay();
    cells[weekday] = { weekday, pages, carryover: 0, minutes: roundMinutes(pages * efficiency), spreadMinutes: roundMinutes(pages * sigma), scheduled: scheduled.includes(weekday) };
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
/** 지금 단계 id: 새로 계산한 요일별 페이지는 이 단계의 페이지다(planStageId) */
export const currentPlanStageId = (subject: Subject) => getActiveSubjectStage(subject)?.id ?? subject.id;

export const withFreshWeekPlan = (subject: Subject): Subject => ({
  ...subject,
  planStageId: currentPlanStageId(subject),
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
  if (sameDays && subject.targetDate === next.targetDate) {
    // 요일과 마감일이 그대로면 저장된 요일별 페이지도 그대로다(30일: 이름만 바꿔 저장해도 계획이 다시 나뉘지 않게). 직접 정한 값은 쉬는 요일을 빼고 둔다
    if (hasCustomWeekdayPages(subject)) return cleanWeekdayPagePlan(subject.scheduledWeekdayPages || {}, next.scheduledWeekdays);
    if (Object.keys(subject.scheduledWeekdayPages || {}).length > 0) return { ...subject.scheduledWeekdayPages };
  }
  return calculateFreshWeekdayPagePlan(next, getSubjectRemainingPageCount(next), getDiffDays(next.targetDate));
};

/* ───────────── 요일별 페이지(과목의 페이지 단위로 조정) ───────────── */

const currentWeekdayPlan = (subject: Subject) => getWeekdayPagePlan(subject, getSubjectRemainingPageCount(subject), getDiffDays(subject.targetDate));

/**
 * 한 요일의 페이지를 amount(기본 1)만큼 늘이거나(direction 1) 줄인다(최소 0). 쉬는 요일은 그대로.
 * 한 주 합계는 계획(마감까지 끝내는 데 필요한 한 주 페이지)에 자동으로 맞춘다(27일 요청 "과목 설정 자동 합산"):
 * 한 요일을 늘리면 다른 학습 요일 중 가장 많은 날부터 1쪽씩 줄이고, 줄이면 가장 적은 날부터 1쪽씩 더한다.
 * 학습 요일이 하루뿐이면 그날이 한 주 몫 전부라 바뀌지 않는다.
 */
export const stepWeekdayPages = (subject: Subject, dayId: number, direction: 1 | -1, amount: number = getWeekdayPageStep(subject)): Subject => {
  const days = normalizeWeekdays(subject.scheduledWeekdays);
  if (!days.includes(dayId)) return subject;
  // 지금 요일별 페이지의 비율 그대로 계획 합계에 맞춘 값에서 시작한다(합계가 이미 맞으면 지금 값 그대로)
  const plan = cleanWeekdayPagePlan(currentWeekdayPlan(subject), days);
  const remaining = getSubjectRemainingPageCount(subject);
  const diffDays = getDiffDays(subject.targetDate);
  const fresh = cleanWeekdayPagePlan(calculateFreshWeekdayPagePlan(subject, remaining, diffDays), days);
  // 한 주 합계(계획)는 요일 나눔과 상관없이 같은 값이어야 누를 때마다 흔들리지 않는다: 같은 몫으로 나눈 계획의 합계
  const evenPlan = cleanWeekdayPagePlan(calculateFreshWeekdayPagePlan({ ...subject, scheduledWeekdayPages: undefined }, remaining, diffDays), days);
  const target = days.reduce((sum, day) => sum + evenPlan[day], 0);
  const next = days.reduce((sum, day) => sum + plan[day], 0) === target ? plan : fresh;
  next[dayId] = Math.max(0, Math.min(target, (next[dayId] || 0) + direction * amount));
  const others = days.filter(day => day !== dayId);
  let diff = days.reduce((sum, day) => sum + next[day], 0) - target;
  // 다른 요일로 맞춘다: 넘치면 많은 날부터 빼고, 모자라면 적은 날부터 더한다(같으면 바꾼 요일 다음 요일부터)
  const order = (list: number[]) => list.sort((a, b) => ((a - dayId + 7) % 7) - ((b - dayId + 7) % 7));
  for (let guard = 0; diff !== 0 && guard < 5000; guard += 1) {
    if (diff > 0) {
      const pick = order(others.filter(day => next[day] > 0)).sort((a, b) => next[b] - next[a])[0];
      if (pick === undefined) break;
      next[pick] -= 1; diff -= 1;
    } else {
      const pick = order([...others]).sort((a, b) => next[a] - next[b])[0];
      if (pick === undefined) { next[dayId] += -diff; diff = 0; break; }
      next[pick] += 1; diff += 1;
    }
  }
  return { ...subject, planStageId: currentPlanStageId(subject), scheduledWeekdayPages: next };
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
  return { ...base, planStageId: currentPlanStageId(base), scheduledWeekdayPages: cleanWeekdayPagePlan(calculateFreshWeekdayPagePlan(base, getSubjectRemainingPageCount(base), getDiffDays(base.targetDate)), ordered) };
};

/* ───────────── 요일별 공부 시간(계획은 시간으로 세우고, 실제 할당은 페이지) ───────────── */

/** ▲▼ 한 번에 바꾸는 시간(분) */
export const PLAN_MINUTE_STEP = 10;
/** 복습 시간의 임시값(재기 전): 기본 복습은 공부 시간의 1/4, 복습과목은 2/3배(31일 요청). 재 둔 값이 있으면 그 값 */
export const BASIC_REVIEW_PLAN_RATIO = 1 / 4;
export const REVIEW_SUBJECT_PLAN_RATIO = 2 / 3;

/** 과목 전체의 효율(분/페이지): 잰 값, 재기 전이면 처음 정한 임시값. 0이면 아직 모른다 */
const subjectBaseEfficiency = (logs: StudyLog[], subject: Subject) => (
  calculateStats(logs.filter(log => log.subjectId === subject.id), 0, 0, subject.initialAverageTimePerPage).averageTimePerPage
);

/**
 * 한 단계(과목 자신 또는 후행과목 한 칸)의 공부 효율(분/페이지).
 * 그 단계에서 잰 값 → 후행과목이 다른 과목을 합쳐 만든 것이면 그 원래 과목의 임시값 → 과목 전체의 효율(잰 값, 없으면 임시값) 순서.
 */
export const getStageMinutesPerPage = (subjects: Subject[], logs: StudyLog[], subject: Subject, stageId: string) => {
  const base = subjectBaseEfficiency(logs, subject);
  if (stageId === subject.id) return base;
  const family = getSubjectFamily(subjects, subject.id, stageId);
  const measured = calculateRecentTimedPageAverage(logs.filter(log => isFamilyStudyLog(family, log))).averageTimePerPage;
  if (measured > 0) return measured;
  const source = family.sourceSubjectId ? subjects.find(item => item.id === family.sourceSubjectId) : undefined;
  if (source && (source.initialAverageTimePerPage || 0) > 0) return source.initialAverageTimePerPage as number;
  return base;
};

export interface StagePlanTime {
  /** 공부 한 페이지(분) */
  study: number;
  /** 그 페이지의 기본 복습(분). 계획 시간(total)에는 넣지 않고 따로 보여 준다 */
  basicReview: number;
  /** 그 페이지를 따라 하는 복습과목들(분, 복습과목의 남은 양이 공부보다 적으면 그만큼만). 계획 시간(total)에는 넣지 않고 따로 보여 준다 */
  reviewSubjects: number;
  /** 계획 시간 = 그 과목을 직접 공부하는 시간(31일: 기본 복습 · 복습과목은 합치지 않고 나눠서 본다) */
  total: number;
}

/**
 * 계획에 쓰는 한 단계 한 페이지의 시간 = 그 과목을 직접 공부하는 시간. 기본 복습 · 복습과목은 계획 시간에 합치지 않고 나눠서 따로 보여 준다(31일 요청).
 * 복습은 직접 할당하지 않고 공부한 페이지를 따라오므로 공부 한 페이지에 붙는 시간으로 센다.
 * 복습 시간은 잰 값, 재기 전이면 기본 복습 = 공부의 1/4, 복습과목 = 공부의 2/3배.
 */
export const getStagePlanTime = (subjects: Subject[], logs: StudyLog[], subject: Subject, stageId: string): StagePlanTime => {
  const study = getStageMinutesPerPage(subjects, logs, subject, stageId);
  if (!(study > 0)) return { study: 0, basicReview: 0, reviewSubjects: 0, total: 0 };
  const measuredBasic = calculateBasicReviewAverageTimePerPage(logs, subject.id);
  const basicReview = subject.reviewEnabled === false ? 0 : measuredBasic > 0 ? measuredBasic : study * BASIC_REVIEW_PLAN_RATIO;
  const stage = getSubjectStages(subject).find(item => item.id === stageId);
  const reviewSubjects = (stage?.reviewSubjectIds || []).reduce((sum, reviewId) => {
    const review = subjects.find(item => item.id === reviewId);
    const left = review ? getSubjectRemainingPageCount(review) : 0;
    if (!review || left <= 0 || !stage) return sum;
    const measured = calculateRecentTimedPageAverage(getReviewEfficiencySamples(logs, subject.id, reviewId)).averageTimePerPage;
    const rate = measured > 0 ? measured : study * REVIEW_SUBJECT_PLAN_RATIO;
    return sum + rate * Math.min(1, left / Math.max(1, stage.remainingPages));
  }, 0);
  return { study, basicReview, reviewSubjects, total: study };
};

/**
 * 계획을 세우거나 고칠 때 단계별 계획 시간(직접 공부 시간)을 적어 둔다(planMinutesPerPage). 시간은 이때만 쓰이고, 그다음은 이 비율로 나눈 페이지가 할당이다.
 * 이 비율로 "하루 시간"이 단계가 바뀌어도 고르게 된다(느린 후행과목 기간에는 페이지가 줄고, 빠른 본 과목 기간에는 는다).
 */
export const withPlanTimes = (subjects: Subject[], logs: StudyLog[], subject: Subject): Subject => {
  const times: Record<string, number> = {};
  getSubjectStages(subject).forEach(stage => {
    const total = getStagePlanTime(subjects, logs, subject, stage.id).total;
    if (total > 0) times[stage.id] = Math.round(total * 100) / 100;
  });
  return { ...subject, planMinutesPerPage: Object.keys(times).length > 0 ? times : undefined };
};

/** 지금 단계 한 페이지의 계획 시간(직접 공부 시간)을 요일마다(모든 요일이 같다: 하루 시간은 단계와 상관없이 고르다). 0이면 모른다 */
export const getWeekdayMinutesPerPage = (subjects: Subject[], logs: StudyLog[], subject: Subject): Record<number, number> => {
  const total = getStagePlanTime(subjects, logs, subject, currentPlanStageId(subject)).total;
  const result: Record<number, number> = {};
  WEEKDAYS.forEach(({ id }) => { result[id] = total; });
  return result;
};

/** 학습 설정 한 주 막대에 들어갈 복습 몫: 공부 페이지를 따라오는 기본 복습과 지금 단계 복습과목들의 요일별 시간 */
export const buildPlanReviewCells = (subjects: Subject[], logs: StudyLog[], subject: Subject, studyCells: Record<number, WeekCell>) => {
  const stageId = currentPlanStageId(subject);
  const stage = getSubjectStages(subject).find(item => item.id === stageId);
  const time = getStagePlanTime(subjects, logs, subject, stageId);
  const cellsOf = (pagesPerStudyPage: number, minutesPerStudyPage: number) => {
    const cells: Record<number, WeekCell> = {};
    WEEKDAYS.forEach(({ id }) => {
      const studyPages = studyCells[id]?.pages || 0;
      cells[id] = { weekday: id, pages: Math.round(studyPages * pagesPerStudyPage * 10) / 10, carryover: 0, minutes: roundMinutes(studyPages * minutesPerStudyPage), spreadMinutes: 0, scheduled: Boolean(studyCells[id]?.scheduled) };
    });
    return cells;
  };
  const basic = time.basicReview > 0 ? cellsOf(1, time.basicReview) : null;
  const reviews = (stage?.reviewSubjectIds || []).flatMap(reviewId => {
    const review = subjects.find(item => item.id === reviewId);
    const left = review ? getSubjectRemainingPageCount(review) : 0;
    if (!review || left <= 0 || !stage || !(time.study > 0)) return [];
    const share = Math.min(1, left / Math.max(1, stage.remainingPages));
    const measured = calculateRecentTimedPageAverage(getReviewEfficiencySamples(logs, subject.id, reviewId)).averageTimePerPage;
    const rate = measured > 0 ? measured : time.study * REVIEW_SUBJECT_PLAN_RATIO;
    return [{ id: reviewId, name: review.name, cells: cellsOf(share, rate * share) }];
  });
  return { basic, reviews };
};

/** ▲▼ 한 번(PLAN_MINUTE_STEP분)이 몇 페이지인가: 최소 1페이지 */
export const minuteStepPages = (minutesPerPage: number) => (
  minutesPerPage > 0 ? Math.max(1, Math.round(PLAN_MINUTE_STEP / minutesPerPage)) : 1
);

/** 한 요일의 공부 시간을 ▲▼로 약 PLAN_MINUTE_STEP분씩 바꾼다. 저장은 그 시간에 맞는 페이지로(하루 할당량이 먼저다) */
export const stepWeekdayMinutes = (subject: Subject, dayId: number, direction: 1 | -1, minutesPerPage: Record<number, number>): Subject => (
  stepWeekdayPages(subject, dayId, direction, minuteStepPages(minutesPerPage[dayId] || 0))
);

/** 한 요일의 공부 시간을 직접 정한다(분). 그 시간에 가장 가까운 페이지로 바꿔 저장하고, 한 주 합계는 다른 요일로 맞춘다 */
export const setWeekdayMinutes = (subject: Subject, dayId: number, minutes: number, minutesPerPage: Record<number, number>): Subject => {
  const perPage = minutesPerPage[dayId] || 0;
  if (!(perPage > 0) || !Number.isFinite(minutes)) return subject;
  const current = Math.max(0, Math.round(currentWeekdayPlan(subject)[dayId] || 0));
  const target = Math.max(0, Math.round(Math.max(0, minutes) / perPage));
  const diff = target - current;
  return diff === 0 ? subject : stepWeekdayPages(subject, dayId, diff > 0 ? 1 : -1, Math.abs(diff));
};

/** "1:30", "1시간 30분", "1h30m", "90"(분), "1.5h" → 분. 못 읽으면 NaN */
export const parsePlanMinutes = (text: string) => {
  const value = text.trim().replace(/\s+/g, '');
  if (!value) return NaN;
  const colon = value.match(/^(\d+):(\d{1,2})$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  const hm = value.match(/^(?:(\d+(?:\.\d+)?)(?:h|시간))?(?:(\d+(?:\.\d+)?)(?:m|분)?)?$/i);
  if (hm && (hm[1] || hm[2])) return Math.round((Number(hm[1] || 0) * 60) + Number(hm[2] || 0));
  return NaN;
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
