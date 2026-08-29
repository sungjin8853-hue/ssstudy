import { Subject, StudyLog } from '../types';

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

export const getDiffDays = (targetDate: string, from = new Date()) => {
  const today = new Date(from);
  today.setHours(0, 0, 0, 0);
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

export const calculateWeeklyRequiredPages = (remainingPages: number, diffDays: number) => {
  const remaining = Math.max(0, Math.ceil(remainingPages));
  if (remaining <= 0) return 0;
  if (diffDays <= 0) return remaining;

  const daysInScope = Math.max(1, Math.min(7, diffDays));
  return Math.min(remaining, Math.ceil((remainingPages / diffDays) * daysInScope));
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

export const calculateFreshWeekdayPagePlan = (subject: Subject, remainingPages: number, diffDays: number) => {
  const selectedDays = normalizeWeekdays(subject.scheduledWeekdays);
  const weeklyRequiredPages = calculateWeeklyRequiredPages(remainingPages, diffDays);
  return distributePagesByWeekdayWeights(
    weeklyRequiredPages,
    selectedDays,
    subject.scheduledWeekdayWeights,
    subject.scheduledWeekdayRemainderDay
  );
};

export const getWeekdayPagePlan = (subject: Subject, remainingPages: number, diffDays: number) => {
  const selectedDays = normalizeWeekdays(subject.scheduledWeekdays);
  const weightPlan = calculateFreshWeekdayPagePlan(subject, remainingPages, diffDays);
  const storedPlan = subject.scheduledWeekdayPages || {};
  const hasStoredPlan = Object.keys(storedPlan).length > 0;
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

  return plan;
};

export const cleanWeekdayPagePlan = (plan: Record<string, number>, days?: number[]) => {
  const selectedDays = normalizeWeekdays(days);
  return selectedDays.reduce<Record<string, number>>((next, dayId) => {
    next[dayId] = Math.max(0, Math.round(Number(plan[dayId]) || 0));
    return next;
  }, {});
};

export const getSubjectDayTarget = (subject: Subject, remainingPages: number, diffDays: number, dayId: number) => {
  const plan = getWeekdayPagePlan(subject, remainingPages, diffDays);
  return Math.min(Math.max(0, Math.ceil(remainingPages)), Math.max(0, plan[dayId] || 0));
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
  today = new Date()
) => {
  const remainingPages = Math.max(0, subject.totalPages - subject.completedPages);
  const scopedPages = logs
    .filter(log => log.subjectId === subject.id && getLogStudyDate(log) === targetStudyDate)
    .reduce((sum, log) => sum + log.pagesRead, 0);
  const remainingBeforeStudyDate = remainingPages + scopedPages;
  const diffDays = getDiffDays(subject.targetDate, today);
  const dayTarget = getSubjectDayTarget(subject, remainingBeforeStudyDate, diffDays, targetWeekday);
  const remainingDayPages = Math.min(remainingPages, Math.max(0, dayTarget - scopedPages));

  return {
    scopedPages,
    remainingDayPages
  };
};

export const getPastCarryoverPages = (
  subject: Subject,
  logs: StudyLog[],
  targetStudyDate: string,
  todayDateKey = getLocalDateKey()
) => {
  if (targetStudyDate !== todayDateKey) return 0;

  const selectedWeekdays = normalizeWeekdays(subject.scheduledWeekdays);
  const startDateKey = getSubjectPlanStartDateKey(subject, logs, targetStudyDate);
  const targetDate = parseStudyDate(todayDateKey);
  const cursor = parseStudyDate(startDateKey);
  let carryoverPages = 0;
  let guard = 0;

  while (cursor < targetDate && guard < 3650) {
    const cursorDateKey = getLocalDateKey(cursor);
    const cursorWeekday = cursor.getDay();

    if (selectedWeekdays.includes(cursorWeekday)) {
      carryoverPages += getSubjectDayRemainingPages(
        subject,
        logs,
        cursorWeekday,
        cursorDateKey,
        new Date(cursor)
      ).remainingDayPages;
    }

    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }

  return carryoverPages;
};
