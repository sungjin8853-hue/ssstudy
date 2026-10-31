import { FollowUpSubject, Subject, StudyLog } from '../types';
import { chaptersPageCount, endPageForSolved, getCurrentChapter, getSubjectChapters, nextPageAfter, pageAtCount, pagesThrough } from './subjectChapters';

export const WEEKDAYS = [
  { id: 1, label: '월' },
  { id: 2, label: '화' },
  { id: 3, label: '수' },
  { id: 4, label: '목' },
  { id: 5, label: '금' },
  { id: 6, label: '토' },
  { id: 0, label: '일' },
];

export const normalizeWeekdays = (days?: number[]) => (
  days && days.length > 0 ? days : WEEKDAYS.map(day => day.id)
);

/** 후행과목의 단원(없으면 빈 목록) */
export const getFollowUpChapters = (followUp: Pick<FollowUpSubject, 'chapters'>) => getSubjectChapters(followUp);

export const getFollowUpPageCount = (followUp: FollowUpSubject) => {
  // 단원이 있으면 단원 안 페이지만 센다
  const chapters = getFollowUpChapters(followUp);
  return chapters.length > 0 ? chaptersPageCount(chapters) : Math.max(0, Math.round(followUp.endPage) - Math.round(followUp.startPage) + 1);
};

export const getFollowUpCompletedPageCount = (followUp: FollowUpSubject) => {
  const chapters = getFollowUpChapters(followUp);
  if (chapters.length > 0) return Math.min(chaptersPageCount(chapters), pagesThrough(chapters, followUp.completedPage));
  return Math.min(
    getFollowUpPageCount(followUp),
    Math.max(0, Math.round(followUp.completedPage) - Math.round(followUp.startPage) + 1)
  );
};

export const getSubjectStartPage = (subject: Subject) => (
  Math.max(1, Number(subject.startPage) || 1)
);

export const getSubjectBasePageCount = (subject: Subject) => {
  // 단원이 있으면 단원 안 페이지만 센다(단원 사이는 공부하지 않는다)
  const chapters = getSubjectChapters(subject);
  return chapters.length > 0 ? chaptersPageCount(chapters) : Math.max(0, subject.totalPages - getSubjectStartPage(subject) + 1);
};

export const getSubjectBaseCompletedPageCount = (subject: Subject) => {
  const chapters = getSubjectChapters(subject);
  if (chapters.length > 0) return Math.min(chaptersPageCount(chapters), pagesThrough(chapters, subject.completedPages));
  return Math.min(
    getSubjectBasePageCount(subject),
    Math.max(0, subject.completedPages - getSubjectStartPage(subject) + 1)
  );
};

export const getSubjectTotalPageCount = (subject: Subject) => (
  getSubjectBasePageCount(subject)
  + (subject.followUpSubjects || []).reduce((sum, followUp) => sum + getFollowUpPageCount(followUp), 0)
);

export const getSubjectCompletedPageCount = (subject: Subject) => (
  getSubjectBaseCompletedPageCount(subject)
  + (subject.followUpSubjects || []).reduce((sum, followUp) => sum + getFollowUpCompletedPageCount(followUp), 0)
);

export const getSubjectRemainingPageCount = (subject: Subject) => (
  Math.max(0, getSubjectTotalPageCount(subject) - getSubjectCompletedPageCount(subject))
);

export const getSubjectStageReviewSubjectIds = (subject: Subject, stageId?: string) => {
  const ids = !stageId || stageId === subject.id
    ? subject.reviewSubjectIds || []
    : subject.followUpSubjects?.find(stage => stage.id === stageId)?.reviewSubjectIds || [];

  return Array.from(new Set(ids.filter(id => id && id !== subject.id)));
};

export const getAllSubjectReviewIds = (subject: Subject) => Array.from(new Set([
  ...(subject.reviewSubjectIds || []),
  ...(subject.followUpSubjects || []).flatMap(stage => stage.reviewSubjectIds || [])
].filter(id => id && id !== subject.id)));

/** 그 단계의 단원: 본 과목 단계는 과목의 단원, 후행과목 단계는 그 후행과목에 정한 단원(없으면 빈 목록) */
export const getStageChapters = (subject: Subject, stage?: { isFollowUp: boolean; id?: string } | null) => {
  if (!stage) return [];
  if (!stage.isFollowUp) return getSubjectChapters(subject);
  const followUp = (subject.followUpSubjects || []).find(item => item.id === stage.id);
  return followUp ? getFollowUpChapters(followUp) : [];
};

/** 시작 페이지에서 pages장을 풀 때의 끝 페이지. 단원이 있으면 단원 사이를 건너뛰어 센다 */
export const getRecommendedEndPage = (subject: Subject, stage: { isFollowUp: boolean } | null | undefined, start: number, pages: number) => {
  const chapters = getStageChapters(subject, stage);
  return (chapters.length > 0 ? endPageForSolved(chapters, start, pages) : null) ?? start + pages - 1;
};

export const getSubjectStages = (subject: Subject) => {
  const startPage = getSubjectStartPage(subject);
  const baseCompletedPage = Math.max(startPage - 1, subject.completedPages);
  const chapters = getSubjectChapters(subject);
  const baseCurrentChapter = getCurrentChapter(chapters, baseCompletedPage);
  const basePageCount = getSubjectBasePageCount(subject);
  const baseCompletedCount = chapters.length > 0
    ? Math.min(basePageCount, pagesThrough(chapters, baseCompletedPage))
    : Math.min(basePageCount, Math.max(0, baseCompletedPage - startPage + 1));
  const stages = [
    {
      id: subject.id,
      name: subject.name,
      startPage,
      endPage: subject.totalPages,
      completedPage: baseCompletedPage,
      // 단원이 있으면 다음에 풀 페이지는 단원 사이를 건너뛴 다음 단원 시작이다
      currentPage: chapters.length > 0
        ? nextPageAfter(chapters, baseCompletedPage) ?? subject.totalPages
        : Math.min(subject.totalPages, baseCompletedPage + 1),
      remainingPages: chapters.length > 0 ? Math.max(0, basePageCount - baseCompletedCount) : Math.max(0, subject.totalPages - baseCompletedPage),
      /** 이 단계의 풀 페이지 수 · 푼 페이지 수(단원이 있으면 단원 안 페이지만) */
      pageCount: basePageCount,
      completedCount: baseCompletedCount,
      /** 단원이 있을 때 지금 공부하는 단원(진척도의 기준). 없으면 null */
      chapter: baseCurrentChapter,
      isFollowUp: false,
      reviewSubjectIds: getSubjectStageReviewSubjectIds(subject, subject.id)
    },
    ...(subject.followUpSubjects || []).map(followUp => {
      const completedPage = Math.max(followUp.startPage - 1, followUp.completedPage);
      const followUpChapters = getFollowUpChapters(followUp);
      const pageCount = getFollowUpPageCount(followUp);
      const completedCount = getFollowUpCompletedPageCount(followUp);
      return {
        id: followUp.id,
        name: followUp.name,
        startPage: followUp.startPage,
        endPage: followUp.endPage,
        completedPage,
        // 단원이 있으면 단원 사이를 건너뛴 다음 단원 시작이 다음에 풀 페이지다
        currentPage: followUpChapters.length > 0
          ? nextPageAfter(followUpChapters, completedPage) ?? followUp.endPage
          : Math.min(followUp.endPage, completedPage + 1),
        remainingPages: followUpChapters.length > 0 ? Math.max(0, pageCount - completedCount) : Math.max(0, followUp.endPage - completedPage),
        pageCount,
        completedCount,
        chapter: (followUpChapters.length > 0 ? getCurrentChapter(followUpChapters, completedPage) : null) as ReturnType<typeof getCurrentChapter>,
        isFollowUp: true,
        reviewSubjectIds: getSubjectStageReviewSubjectIds(subject, followUp.id)
      };
    })
  ];
  const activeIndex = stages.findIndex(stage => stage.remainingPages > 0);

  return stages.map((stage, index) => ({
    ...stage,
    status: activeIndex < 0 || index < activeIndex
      ? 'completed' as const
      : index === activeIndex
        ? 'current' as const
        : 'upcoming' as const
  }));
};

/** 지금 공부하는 단계로 본 필수 여부: 후행과목을 공부 중이고 그 후행과목에 필수 여부를 정했으면 그 값, 아니면 과목의 값 */
export const isSubjectRequiredNow = (subject: Subject | undefined | null): boolean => {
  if (!subject) return false;
  const stage = getActiveSubjectStage(subject);
  const followUp = stage?.isFollowUp ? (subject.followUpSubjects || []).find(item => item.id === stage.id) : undefined;
  return Boolean(followUp?.isRequired ?? subject.isRequired);
};

export const getActiveSubjectStage = (subject: Subject) => {
  const stages = getSubjectStages(subject);
  return stages.find(stage => stage.status === 'current') || null;
};

/** 단계(과목 자신 · 후행과목)의 임시 한 페이지 시간(분). 후행과목은 그 후행과목에 정한 값, 없으면 합쳐 만든 원래 과목의 값. 없으면 0 */
export const getStageInitialMinutesPerPage = (subjects: Subject[], subject: Subject, stageId: string) => {
  if (stageId === subject.id) return Math.max(0, Number(subject.initialAverageTimePerPage) || 0);
  const followUp = (subject.followUpSubjects || []).find(item => item.id === stageId);
  if (!followUp) return 0;
  const own = Number(followUp.initialAverageTimePerPage) || 0;
  if (own > 0) return own;
  const source = followUp.sourceSubjectId ? subjects.find(item => item.id === followUp.sourceSubjectId) : undefined;
  return Math.max(0, Number(source?.initialAverageTimePerPage) || 0);
};

/* ───── 하루 시간을 고르게(31일 요청): 단계마다 한 페이지의 계획 시간이 다르면 그 비율로 페이지를 바꿔 센다 ───── */

/**
 * 그 단계 한 페이지가 지금 단계 페이지 몇 개 몫인가(계획 시간 비율). 계획 시간을 적어 두지 않았거나 모르면 1(예전과 같다).
 * 예: 지금 본 과목 3분/쪽, 후행과목 6분/쪽이면 후행 한 쪽 = 본 과목 2쪽 몫.
 */
export const getPlanStageRatio = (subject: Subject, stageId?: string) => {
  const times = subject.planMinutesPerPage;
  if (!times) return 1;
  const current = getActiveSubjectStage(subject)?.id ?? subject.id;
  const from = Number(times[stageId || subject.id]) || 0;
  const to = Number(times[current]) || 0;
  return from > 0 && to > 0 ? from / to : 1;
};

/** 남은 페이지를 지금 단계 페이지로 바꿨을 때의 배율(남은 단계들의 계획 시간을 지금 단계 기준으로) */
export const getPlanRemainingScale = (subject: Subject) => {
  if (!subject.planMinutesPerPage) return 1;
  const stages = getSubjectStages(subject).filter(stage => stage.remainingPages > 0);
  const actual = stages.reduce((sum, stage) => sum + stage.remainingPages, 0);
  const equivalent = stages.reduce((sum, stage) => sum + stage.remainingPages * getPlanStageRatio(subject, stage.id), 0);
  return actual > 0 && equivalent > 0 ? equivalent / actual : 1;
};

/**
 * 지금 단계 페이지로 센 할 일을 실제로 풀 페이지로: 지금 단계가 그 전에 끝나면 넘치는 몫은 다음 단계의 계획 시간 비율로 바꾼다
 * (31일 점검: 본 과목 2쪽 남은 날 8쪽 할 일 → 후행(2배 느림) 6쪽을 그대로 풀어 그날 시간이 2배가 되고 다음 날이 1쪽이 되던 것).
 */
export const planPagesToActualPages = (subject: Subject, planPages: number) => {
  if (!subject.planMinutesPerPage || planPages <= 0) return planPages;
  let left = planPages;
  let actual = 0;
  for (const stage of getSubjectStages(subject).filter(item => item.remainingPages > 0)) {
    const ratio = getPlanStageRatio(subject, stage.id);
    const take = Math.min(left, stage.remainingPages * ratio);
    actual += take / ratio;
    left -= take;
    if (left <= 1e-9) break;
  }
  return Math.max(planPages > 0 ? 1 : 0, Math.round(actual));
};

/** 기록 하나의 진도를 지금 단계 페이지로(그 기록을 한 단계의 계획 시간 비율) */
export const getLogPlanPages = (subject: Subject, log: StudyLog) => (
  getLogProgressPages(log) * getPlanStageRatio(subject, log.subjectStageId || subject.id)
);

export const adjustSubjectProgress = (subject: Subject, pageDelta: number): Subject => {
  const totalPages = getSubjectTotalPageCount(subject);
  const startPage = getSubjectStartPage(subject);
  const basePageCount = getSubjectBasePageCount(subject);
  const nextCompleted = Math.min(
    totalPages,
    Math.max(0, getSubjectCompletedPageCount(subject) + pageDelta)
  );
  const baseCompletedPageCount = Math.min(basePageCount, nextCompleted);
  const chapters = getSubjectChapters(subject);
  const baseCompletedPage = baseCompletedPageCount > 0
    ? (chapters.length > 0 ? pageAtCount(chapters, baseCompletedPageCount) ?? startPage - 1 : startPage + baseCompletedPageCount - 1)
    : startPage - 1;
  let remainingCompleted = Math.max(0, nextCompleted - baseCompletedPageCount);
  const followUpSubjects = (subject.followUpSubjects || []).map(followUp => {
    const pageCount = getFollowUpPageCount(followUp);
    const completedCount = Math.min(pageCount, remainingCompleted);
    remainingCompleted -= completedCount;
    const followUpChapters = getFollowUpChapters(followUp);
    return {
      ...followUp,
      completedPage: completedCount > 0
        ? (followUpChapters.length > 0 ? pageAtCount(followUpChapters, completedCount) ?? followUp.startPage - 1 : followUp.startPage + completedCount - 1)
        : followUp.startPage - 1
    };
  });

  return {
    ...subject,
    completedPages: baseCompletedPage,
    followUpSubjects
  };
};

export const getLocalDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getStudyDateForWeekday = (weekday: number, from = new Date()) => {
  const target = new Date(from);
  target.setHours(0, 0, 0, 0);
  const todayWeekday = target.getDay();
  const daysUntilTarget = (weekday - todayWeekday + 7) % 7;
  target.setDate(target.getDate() + daysUntilTarget);
  return getLocalDateKey(target);
};

export const getLogStudyDate = (log: StudyLog) => {
  if (log.studyDate) return log.studyDate;
  return getLocalDateKey(new Date(log.timestamp));
};

export const getLogProgressPages = (log: StudyLog) => {
  // 단원이 있는 과목의 기록은 단원 사이를 건너뛴 만큼 뺀 페이지 수를 따로 들고 있다
  if (typeof log.progressPages === 'number' && Number.isFinite(log.progressPages) && log.progressPages >= 0) return log.progressPages;
  if (log.pageCountIsExplicit && log.startPage !== undefined && log.endPage !== undefined) {
    return Math.max(0, log.endPage - log.startPage + 1);
  }
  if (log.reviewParentSubjectId && !log.reviewPageRangeBased) return 0;
  return Math.max(0, log.pagesRead);
};

export const getDiffDays =(targetDate: string, from = new Date()) => {
  const today = new Date(from);
  today.setHours(0, 0, 0, 0);
  // "2026-11-06"은 그 지역의 그날로 읽는다(new Date("2026-11-06")은 UTC 자정이라 서쪽 시간대에서는 하루 앞당겨진다)
  const target = /^\d{4}-\d{2}-\d{2}$/.test(targetDate) ? parseStudyDate(targetDate) : new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

export const getPlanningDayCount = (diffDays: number) => (
  Math.max(1, Math.min(7, diffDays + 1))
);

export const getPlanningWeekdays = (days: number[] | undefined, diffDays: number, from = new Date()) => {
  const selectedDays = normalizeWeekdays(days);
  const availableDays = Array.from({ length: getPlanningDayCount(diffDays) }, (_, offset) => (
    (from.getDay() + offset) % 7
  )).filter(day => selectedDays.includes(day));

  // If every chosen weekday is after the deadline, keep the work available today.
  return availableDays.length ? availableDays : [from.getDay()];
};

export const calculateWeeklyRequiredPages = (remainingPages: number, diffDays: number, studyDays?: number[], from = new Date()) => {
  const remaining = Math.max(0, Math.ceil(remainingPages));
  if (remaining <= 0) return 0;
  if (diffDays <= 0) return remaining;

  const daysInScope = getPlanningDayCount(diffDays);
  // 학습 요일을 알면 달력 날짜가 아니라 "마감까지 남은 학습일" 중 이번 7일에 드는 몫만큼(31일 점검: 주말만 공부 · 마감이 월요일이면
  // 달력 날짜로 나눠 첫 주말에 12쪽, 둘째 주말에 5쪽처럼 앞에 몰렸다). 매일 공부하면 예전과 같다.
  if (studyDays && studyDays.length > 0) {
    const selected = normalizeWeekdays(studyDays);
    let inScope = 0;
    let total = 0;
    for (let offset = 0; offset <= diffDays; offset += 1) {
      if (!selected.includes((from.getDay() + offset) % 7)) continue;
      total += 1;
      if (offset < daysInScope) inScope += 1;
    }
    if (total > 0 && inScope > 0) return Math.min(remaining, Math.ceil((remainingPages * inScope) / total));
  }
  return Math.min(remaining, Math.ceil((remainingPages / (diffDays + 1)) * daysInScope));
};

export const normalizeWeekdayWeights = (weights?: Record<string, number>, days?: number[]) => {
  const selectedDays = normalizeWeekdays(days);
  return selectedDays.reduce<Record<string, number>>((next, dayId) => {
    const weight = Math.max(1, Math.round(Number(weights?.[dayId]) || 1));
    next[dayId] = weight;
    return next;
  }, {});
};

export const distributePagesByWeekdayWeights = (
  totalPages: number,
  days?: number[],
  weights?: Record<string, number>,
  remainderDay?: number
) => {
  const selectedDays = normalizeWeekdays(days);
  const normalizedWeights = normalizeWeekdayWeights(weights, selectedDays);
  const total = Math.max(0, Math.round(totalPages));
  const plan: Record<string, number> = {};

  WEEKDAYS.forEach(day => {
    plan[day.id] = 0;
  });

  if (selectedDays.length === 0 || total <= 0) return plan;

  const totalWeight = selectedDays.reduce((sum, dayId) => sum + normalizedWeights[dayId], 0);
  let usedPages = 0;

  selectedDays.forEach(dayId => {
    const pages = Math.floor((total * normalizedWeights[dayId]) / totalWeight);
    plan[dayId] = pages;
    usedPages += pages;
  });

  const remainder = total - usedPages;
  const targetDay = selectedDays.includes(remainderDay ?? -1)
    ? remainderDay
    : selectedDays[selectedDays.length - 1];

  if (targetDay !== undefined) {
    plan[targetDay] += remainder;
  }

  return plan;
};

/** 요일별 페이지를 한 번에 늘리고 줄이는 크기: 1쪽(고정 페이지 단위는 없앴다 — 단위는 "복습에 넣기" 사이 구간이다) */
export const getWeekdayPageStep = (_subject?: Pick<Subject, 'growthPageUnit'>) => 1;

/**
 * 합계(total)를 요일들에 weights 비율대로 나눈다. 기존 페이지 비율과 최대한 같게, 페이지 하나씩 나누고
 * (큰 소수 부분부터 1씩 더 받는다) 0은 그대로 0이다. 비율이 모두 0이면 같은 몫.
 */
export const distributePagesProportionally = (total: number, days: number[], weights: Record<string, number>) => {
  const plan: Record<string, number> = {};
  WEEKDAYS.forEach(day => { plan[day.id] = 0; });
  const pages = Math.max(0, Math.round(total));
  if (days.length === 0 || pages <= 0) return plan;
  let shares = days.map(day => Math.max(0, Number(weights[day]) || 0));
  if (shares.reduce((sum, value) => sum + value, 0) <= 0) shares = days.map(() => 1);
  const weightSum = shares.reduce((sum, value) => sum + value, 0);
  const exact = shares.map(value => (pages * value) / weightSum);
  const given = exact.map(Math.floor);
  let left = pages - given.reduce((sum, value) => sum + value, 0);
  exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index)
    .forEach(({ index }) => { if (left > 0 && shares[index] > 0) { given[index] += 1; left -= 1; } });
  days.forEach((day, index) => { plan[day] = given[index]; });
  return plan;
};

/** 지금 저장된 요일별 페이지에서 이번 계획의 비율 재료를 뽑는다: 학습 요일에 저장된 값, 새로 켠 요일은 다른 요일들의 평균. 쓸 값이 없으면 null. */
const getReferenceWeights = (subject: Subject, days: number[]): Record<string, number> | null => {
  const stored = subject.scheduledWeekdayPages || {};
  const studyDays = normalizeWeekdays(subject.scheduledWeekdays);
  const known = days.filter(day => studyDays.includes(day) && Number.isFinite(Number(stored[day])) && stored[day] !== undefined);
  const values = known.map(day => Math.max(0, Number(stored[day])));
  if (known.length === 0 || values.reduce((sum, value) => sum + value, 0) <= 0) return null;
  const mean = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  return days.reduce<Record<string, number>>((next, day) => {
    next[day] = known.includes(day) ? Math.max(0, Number(stored[day])) : mean;
    return next;
  }, {});
};

/**
 * 한 주 필요 페이지를 학습 요일에 나눈 계획. 전에 저장해 둔 요일별 페이지가 있으면 그 페이지 비율을 최대한 그대로 두고
 * 다시 나누고, 없으면 같은 몫으로 나눈다.
 */
/**
 * 한 주 계획을 마감까지 실제 날짜에 깔았을 때 남은 장수를 다 채우는지 확인하고, 모자라면 가장 적은 요일부터 1쪽씩 더한다.
 * 한 주 장수를 하루 몫 × 7로 정하고 나머지를 한 요일(일요일 등)에 몰면, 마감이 주 중간이라 그 요일이 한 번밖에 안 오는 경우
 * 계획대로 해도 마감에 끝나지 않았다(21:50 점검: 20쪽 · 12일 → 월~토 1쪽, 일 6쪽 = 마감까지 17쪽, 끝나는 날 ~11/8 > 마감 11/6).
 */
const coverDeadline = (plan: Record<string, number>, selectedDays: number[], remainingPages: number, diffDays: number, from: Date) => {
  if (diffDays < 7) return plan;
  const need = Math.max(0, Math.ceil(remainingPages));
  const counts: Record<number, number> = {};
  for (let offset = 0; offset <= diffDays; offset += 1) { const day = (from.getDay() + offset) % 7; counts[day] = (counts[day] || 0) + 1; }
  const days = selectedDays.filter(day => counts[day] > 0);
  if (!days.length) return plan;
  const next = { ...plan };
  const covered = () => days.reduce((sum, day) => sum + Math.max(0, next[day] || 0) * counts[day], 0);
  for (let guard = 0; guard < 2000 && covered() < need; guard += 1) {
    const pick = [...days].sort((a, b) => (next[a] || 0) - (next[b] || 0) || counts[b] - counts[a])[0];
    next[pick] = (next[pick] || 0) + 1;
  }
  return next;
};

export const calculateFreshWeekdayPagePlan = (subject: Subject, remainingPages: number, diffDays: number, from = new Date()) => {
  const selectedDays = getPlanningWeekdays(subject.scheduledWeekdays, diffDays, from);
  // 하루 시간을 고르게: 뒤에 남은 느린(빠른) 단계는 지금 단계 페이지로 더(덜) 센다. 마감날은 남은 페이지 그대로
  const planningPages = remainingPages * getPlanRemainingScale(subject);
  const weeklyRequiredPages = calculateWeeklyRequiredPages(planningPages, diffDays, subject.scheduledWeekdays, from);
  const reference = getReferenceWeights(subject, selectedDays);
  // 처음 나눌 때 나머지는 한 요일에 몰지 않고 오늘부터 가까운 요일에 1쪽씩 고르게 더한다(31일 요청)
  const plan = distributePagesProportionally(weeklyRequiredPages, selectedDays, reference || {});
  return coverDeadline(plan, selectedDays, planningPages, diffDays, from);
};

export const getWeekdayPagePlan = (subject: Subject, remainingPages: number, diffDays: number, from = new Date()) => {
  const selectedDays = normalizeWeekdays(subject.scheduledWeekdays);
  // 마감이 일주일 안이면 저장된 요일별 페이지와 상관없이 남은 요일에 같은 몫으로 나눈다(전과 같다)
  const weightPlan = calculateFreshWeekdayPagePlan(getPlanningDayCount(diffDays) < 7 ? { ...subject, scheduledWeekdayPages: undefined } : subject, remainingPages, diffDays, from);
  if (getPlanningDayCount(diffDays) < 7) return weightPlan;
  const storedPlan = subject.scheduledWeekdayPages || {};
  const hasStoredPlan = Object.keys(storedPlan).length > 0;
  const stageRatio = getPlanStageRatio(subject, subject.planStageId || subject.id);
  const plan: Record<string, number> = {};

  WEEKDAYS.forEach(day => {
    if (!selectedDays.includes(day.id)) {
      plan[day.id] = 0;
      return;
    }

    const storedValue = Number(storedPlan[day.id]);
    plan[day.id] = hasStoredPlan && Number.isFinite(storedValue)
      ? Math.max(0, Math.round(storedValue))
      : weightPlan[day.id] || 0;
  });

  // 저장된 페이지가 다른 단계(예: 끝난 본 과목)의 페이지면 지금 단계 페이지로 바꾼다: 한 주 합계를 비율대로 바꾼 뒤 요일 비율대로 다시 나누고
  // (요일마다 반올림하면 한 주가 부풀었다 — 31일 점검), 마감까지 덮는지 다시 본다
  if (hasStoredPlan && stageRatio !== 1) {
    const weekTotal = Math.round(selectedDays.reduce((sum, day) => sum + plan[day], 0) * stageRatio);
    const scaled = distributePagesProportionally(weekTotal, selectedDays, plan);
    return coverDeadline(scaled, selectedDays, remainingPages * getPlanRemainingScale(subject), diffDays, from);
  }
  return plan;
};

export const cleanWeekdayPagePlan = (plan: Record<string, number>, days?: number[]) => {
  const selectedDays = normalizeWeekdays(days);
  return selectedDays.reduce<Record<string, number>>((next, dayId) => {
    next[dayId] = Math.max(0, Math.round(Number(plan[dayId]) || 0));
    return next;
  }, {});
};

export const getSubjectDayTarget = (subject: Subject, remainingPages: number, diffDays: number, dayId: number, from = new Date()) => {
  const plan = getWeekdayPagePlan(subject, remainingPages, diffDays, from);
  // 할 일은 지금 단계 페이지로 센다: 남은 양도 같은 단위로(단계별 계획 시간이 없으면 그대로)
  return Math.min(Math.max(0, Math.ceil(remainingPages * getPlanRemainingScale(subject))), Math.max(0, plan[dayId] || 0));
};

export const parseStudyDate = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const getSubjectPlanStartDateKey = (
  subject: Subject,
  logs: StudyLog[],
  fallbackDateKey: string
) => {
  if (subject.planResetDate) return subject.planResetDate;

  if (subject.createdAt) {
    const createdAt = new Date(subject.createdAt);
    if (Number.isFinite(createdAt.getTime())) return getLocalDateKey(createdAt);
  }

  return logs
    .filter(log => log.subjectId === subject.id)
    .map(getLogStudyDate)
    .sort()[0] || fallbackDateKey;
};

export const getSubjectDayRemainingPages = (
  subject: Subject,
  logs: StudyLog[],
  targetWeekday: number,
  targetStudyDate: string,
  today = new Date(),
  includeCarryover = true
) => {
  const remainingPages = getSubjectRemainingPageCount(subject);
  const scopedPages = Math.round(logs
    .filter(log => log.subjectId === subject.id && getLogStudyDate(log) === targetStudyDate)
    .reduce((sum, log) => sum + getLogPlanPages(subject, log), 0));
  const remainingBeforeStudyDate = remainingPages + scopedPages;
  const diffDays = getDiffDays(subject.targetDate, today);
  if (includeCarryover && getPlanningDayCount(diffDays) < 7) {
    const todayDateKey = getLocalDateKey(today);
    const dates = Array.from({ length: getPlanningDayCount(diffDays) }, (_, offset) => {
      const date = new Date(today);
      date.setDate(date.getDate() + offset);
      return { dateKey: getLocalDateKey(date), weekday: date.getDay() };
    });
    const pagesByDate = logs
      .filter(log => log.subjectId === subject.id && dates.some(date => date.dateKey === getLogStudyDate(log)))
      .reduce<Record<string, number>>((pages, log) => {
        const dateKey = getLogStudyDate(log);
        pages[dateKey] = (pages[dateKey] || 0) + getLogPlanPages(subject, log);
        return pages;
      }, {});
    Object.keys(pagesByDate).forEach(dateKey => { pagesByDate[dateKey] = Math.round(pagesByDate[dateKey]); });
    // Reconstruct one shared budget so a record is deducted only on its own day.
    // 날짜별 양(pagesByDate)은 지금 단계 페이지로 세고, 진도를 되돌리는 데는 실제 페이지를 쓴다(단계별 계획 시간이 없으면 둘이 같다)
    const windowPages = logs
      .filter(log => log.subjectId === subject.id && dates.some(date => date.dateKey === getLogStudyDate(log)))
      .reduce((sum, log) => sum + getLogProgressPages(log), 0);
    const scale = getPlanRemainingScale(subject);
    const subjectBeforeWindow = adjustSubjectProgress(subject, -windowPages);
    const rawCarryover = getPastCarryoverPages(subjectBeforeWindow, logs, todayDateKey, todayDateKey, false);
    const initialCarryover = Math.min(Math.ceil((remainingPages + windowPages) * scale), rawCarryover);
    const plan = getWeekdayPagePlan(subject, remainingPages + windowPages - initialCarryover / scale, diffDays, today);
    const days = dates.map(({ dateKey, weekday }) => {
      const targetPages = (plan[weekday] || 0) + (dateKey === todayDateKey ? initialCarryover : 0);
      const paidPages = pagesByDate[dateKey] || 0;
      return { dateKey, remaining: Math.max(0, targetPages - paidPages), excess: Math.max(0, paidPages - targetPages) };
    });
    let excessPages = days.reduce((sum, day) => sum + day.excess, 0);
    const unpaidCarryover = Math.max(0, initialCarryover - (pagesByDate[todayDateKey] || 0));
    let carryoverPages = 0;
    let remainingDayPages = 0;
    days.forEach(day => {
      const deductedPages = Math.min(day.remaining, excessPages);
      excessPages -= deductedPages;
      if (day.dateKey === targetStudyDate) {
        remainingDayPages = Math.min(Math.ceil(remainingPages * getPlanRemainingScale(subject)), day.remaining - deductedPages);
        carryoverPages = day.dateKey === todayDateKey
          ? Math.min(remainingDayPages, Math.max(0, unpaidCarryover - deductedPages))
          : 0;
      }
    });
    return {
      scopedPages,
      carryoverPages,
      remainingDayPages
    };
  }
  const dayTarget = getSubjectDayTarget(subject, remainingBeforeStudyDate, diffDays, targetWeekday, today);
  const remainingDayPages = Math.min(Math.ceil(remainingPages * getPlanRemainingScale(subject)), Math.max(0, dayTarget - scopedPages));

  return {
    scopedPages,
    carryoverPages: 0,
    remainingDayPages
  };
};

/**
 * 계획 시작일부터 어제까지, 날짜마다 계획이 정한 페이지(요일별 페이지)와 실제로 푼 페이지를 견준 차이(29일 요청).
 * 양수 = 밀린 양(오늘 할 양에 더해 계속 쌓인다), 음수 = 미리 한 양(오늘 이후 할 양에서 앞에서부터 뺀다).
 */
export const getPastPlanBalance = (
  subject: Subject,
  logs: StudyLog[],
  targetStudyDate: string,
  todayDateKey = getLocalDateKey(),
  /** 과목의 진도에 오늘 푼 양이 들어 있는가(마감 일주일 안 계산은 오늘 이후 기록을 되돌린 과목을 넘긴다) */
  progressIncludesToday = true
) => {
  if (targetStudyDate !== todayDateKey) return 0;

  const selectedWeekdays = normalizeWeekdays(subject.scheduledWeekdays);
  const startDateKey = getSubjectPlanStartDateKey(subject, logs, targetStudyDate);
  const targetDate = parseStudyDate(todayDateKey);
  const cursor = parseStudyDate(startDateKey);
  const remainingPages = getSubjectRemainingPageCount(subject);
  // 그날의 남은 양 = 지금 남은 양 + 그날부터 오늘까지 푼 양(31일 점검: 지금 남은 양으로 지난날 할 일을 잘라, 끝이 가까우면
  // 쉰 날의 밀린 양이 작게 · 따라잡은 날이 "미리 한 양"으로 세어져 남은 1쪽이 마감날로 밀리던 것)
  const subjectLogs = logs.filter(log => log.subjectId === subject.id);
  let pagesFromCursor = subjectLogs
    .filter(log => getLogStudyDate(log) >= startDateKey && (progressIncludesToday || getLogStudyDate(log) < todayDateKey))
    .reduce((sum, log) => sum + getLogProgressPages(log), 0);
  let shortfallPages = 0;
  let surplusPages = 0;
  let guard = 0;

  while (cursor < targetDate && guard < 3650) {
    const cursorDateKey = getLocalDateKey(cursor);
    const cursorWeekday = cursor.getDay();
    const remainingThen = remainingPages + pagesFromCursor;
    pagesFromCursor -= subjectLogs.filter(log => getLogStudyDate(log) === cursorDateKey).reduce((sum, log) => sum + getLogProgressPages(log), 0);
    // 지난 기록은 지금 단계 페이지로(소수 그대로 더하고 마지막에 반올림: 날마다 반올림하면 미리 한 양이 부풀었다)
    const scopedPages = logs
      .filter(log => log.subjectId === subject.id && getLogStudyDate(log) === cursorDateKey)
      .reduce((sum, log) => sum + getLogPlanPages(subject, log), 0);

    if (selectedWeekdays.includes(cursorWeekday)) {
      const dayTarget = getSubjectDayTarget(
        subject,
        remainingThen,
        getDiffDays(subject.targetDate, new Date(cursor)),
        cursorWeekday,
        new Date(cursor)
      );
      shortfallPages += Math.max(0, dayTarget - scopedPages);
      surplusPages += Math.max(0, scopedPages - dayTarget);
    } else {
      // Pages done on a non-study weekday also pay back earlier shortfall.
      surplusPages += scopedPages;
    }

    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }

  // Extra pages studied on any earlier day reduce the shortfall carried to today, and what is left over is done ahead.
  // 밀린 양은 남은 양(지금 단계 페이지)보다 클 수 없다
  return Math.min(Math.ceil(remainingPages * getPlanRemainingScale(subject)), Math.round(shortfallPages - surplusPages));
};

export const getPastCarryoverPages = (
  subject: Subject,
  logs: StudyLog[],
  targetStudyDate: string,
  todayDateKey = getLocalDateKey(),
  progressIncludesToday = true
) => Math.max(0, getPastPlanBalance(subject, logs, targetStudyDate, todayDateKey, progressIncludesToday));

/**
 * 계획을 고치면 그날부터 새 계획이다(29일 요청): 요일별 페이지 · 학습 요일 · 마감일 · 범위(시작 · 끝 · 단원)가 바뀌면 계획 시작일을 오늘로 옮긴다.
 * 지난날은 그때의 계획대로 둔다(새 값으로 지난날을 다시 따지면 밀린 양 · 미리 한 양이 갑자기 생긴다). 밀린 양 · 미리 한 양은 남은 페이지에 들어 있어 새 계획에 나뉜다.
 */
export const withPlanRestart = (previous: Subject | undefined, rawNext: Subject, todayKey = getLocalDateKey()): Subject => {
  if (!previous) return rawNext;
  // 요일별 페이지를 새로 적었으면 그 값은 지금 단계의 페이지다(따로 적지 않은 곳에서 고쳐도 단계 비율이 어긋나지 않게)
  const pagesChanged = JSON.stringify(previous.scheduledWeekdayPages || {}) !== JSON.stringify(rawNext.scheduledWeekdayPages || {});
  const next = pagesChanged && rawNext.planStageId === previous.planStageId
    ? { ...rawNext, planStageId: getActiveSubjectStage(rawNext)?.id ?? rawNext.id }
    : rawNext;
  const key = (subject: Subject) => JSON.stringify([
    normalizeWeekdays(subject.scheduledWeekdays), cleanWeekdayPagePlan(subject.scheduledWeekdayPages || {}, subject.scheduledWeekdays),
    subject.targetDate, subject.startPage, subject.totalPages, subject.chapters ?? null, subject.followUpSubjects?.map(item => [item.id, item.startPage, item.endPage]) ?? null
  ]);
  return key(previous) === key(next) || next.planResetDate === todayKey ? next : { ...next, planResetDate: todayKey };
};
