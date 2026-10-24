import { StudyLog } from '../types';
import { getLocalDateKey, getLogStudyDate } from './schedule';
import { REVIEW_MASK_INTERVAL_MS } from './reviewPractice';

/**
 * 학습 추이·리포트 화면에서 쓰는 계산 모음. 화면을 그리는 일과 분리해 두었고,
 * 저장된 값(기록)은 읽기만 하고 바꾸지 않는다.
 */

const DAY_MS = 86400000;
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

const startOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const shiftDays = (date: Date, days: number) => {
  const next = startOfDay(date);
  next.setDate(next.getDate() + days);
  return next;
};

const dayNumber = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
};

const finiteMinutes = (log: StudyLog) => (Number.isFinite(log.timeSpentMinutes) && log.timeSpentMinutes > 0 ? log.timeSpentMinutes : 0);
const finitePages = (log: StudyLog) => (Number.isFinite(log.pagesRead) && log.pagesRead > 0 ? log.pagesRead : 0);

export interface DailyStudyPoint {
  key: string;
  /** 막대 아래 글자. 예: "10/16" */
  label: string;
  weekday: string;
  minutes: number;
  pages: number;
  isToday: boolean;
}

/** 오늘을 포함한 최근 `days`일의 날짜별 학습 시간·페이지. 기록이 없는 날은 0으로 채운다. */
export const buildDailyStudy = (logs: StudyLog[], days: number, now = new Date()): DailyStudyPoint[] => {
  const today = startOfDay(now);
  const byDate = new Map<string, { minutes: number; pages: number }>();
  logs.forEach(log => {
    const key = getLogStudyDate(log);
    const entry = byDate.get(key) || { minutes: 0, pages: 0 };
    entry.minutes += finiteMinutes(log);
    entry.pages += finitePages(log);
    byDate.set(key, entry);
  });
  return Array.from({ length: Math.max(1, days) }, (_, index) => {
    const date = shiftDays(today, index - (Math.max(1, days) - 1));
    const key = getLocalDateKey(date);
    const entry = byDate.get(key);
    return {
      key,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      weekday: WEEKDAY_LABELS[date.getDay()],
      minutes: entry?.minutes || 0,
      pages: entry?.pages || 0,
      isToday: index === Math.max(1, days) - 1
    };
  });
};

export interface WindowSummary {
  minutes: number;
  pages: number;
  sessions: number;
  /** 분/페이지. 시간과 페이지가 모두 있는 기록만 계산한다. 없으면 0 */
  efficiency: number;
}

/** 오늘로부터 `offsetDays`일 전까지를 끝으로 하는 `days`일 구간의 합계. offsetDays=0이면 최근 `days`일. */
export const summarizeWindow = (logs: StudyLog[], days: number, offsetDays = 0, now = new Date()): WindowSummary => {
  const today = startOfDay(now);
  const endKey = getLocalDateKey(shiftDays(today, -offsetDays));
  const startKey = getLocalDateKey(shiftDays(today, -offsetDays - (days - 1)));
  let minutes = 0;
  let pages = 0;
  let sessions = 0;
  let timedMinutes = 0;
  let timedPages = 0;
  logs.forEach(log => {
    const key = getLogStudyDate(log);
    if (key < startKey || key > endKey) return;
    const logMinutes = finiteMinutes(log);
    const logPages = finitePages(log);
    minutes += logMinutes;
    pages += logPages;
    sessions += 1;
    if (logMinutes > 0 && logPages > 0) {
      timedMinutes += logMinutes;
      timedPages += logPages;
    }
  });
  return { minutes, pages, sessions, efficiency: timedPages > 0 ? timedMinutes / timedPages : 0 };
};

/** 이번 값이 지난 값보다 얼마나 늘었는지(%)와 차이. 지난 값이 0이면 비교하지 않는다. */
export const compareValues = (current: number, previous: number) => (
  previous > 0 ? { delta: current - previous, percent: (current / previous - 1) * 100 } : null
);

/** 장당 시간이 줄면 속도가 오른 것이다. 예) 4.0 → 3.2 분/P 는 +25% */
export const speedChangePercent = (currentEfficiency: number, previousEfficiency: number) => (
  currentEfficiency > 0 && previousEfficiency > 0 ? (previousEfficiency / currentEfficiency - 1) * 100 : null
);

export interface StreakSummary {
  /** 오늘(또는 오늘 기록이 아직 없으면 어제)까지 이어진 연속 학습일 */
  current: number;
  best: number;
  studiedToday: boolean;
}

export const calculateStudyStreak = (logs: StudyLog[], now = new Date()): StreakSummary => {
  const keys = Array.from(new Set(logs.filter(log => finiteMinutes(log) > 0 || finitePages(log) > 0).map(getLogStudyDate)))
    .filter(key => /^\d{4}-\d{2}-\d{2}$/.test(key))
    .map(dayNumber)
    .sort((a, b) => a - b);
  const set = new Set(keys);
  const todayNumber = dayNumber(getLocalDateKey(now));
  const studiedToday = set.has(todayNumber);
  let current = 0;
  for (let cursor = studiedToday ? todayNumber : todayNumber - 1; set.has(cursor); cursor -= 1) current += 1;
  let best = 0;
  let run = 0;
  keys.forEach((value, index) => {
    run = index > 0 && value - keys[index - 1] === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return { current, best, studiedToday };
};

export interface TimeSplit {
  solveMinutes: number;
  organizeMinutes: number;
  /** 풀이(타임어택) 비중 0~100. 시간이 없으면 null */
  solveShare: number | null;
}

/** 최근 `days`일 동안의 풀이(타임어택) 시간과 정리 시간. 구분이 없는 기록은 모두 풀이로 본다. */
export const summarizeTimeSplit = (logs: StudyLog[], days: number, now = new Date()): TimeSplit => {
  const startKey = getLocalDateKey(shiftDays(startOfDay(now), -(days - 1)));
  const endKey = getLocalDateKey(startOfDay(now));
  let solve = 0;
  let organize = 0;
  logs.forEach(log => {
    const key = getLogStudyDate(log);
    if (key < startKey || key > endKey) return;
    const total = finiteMinutes(log);
    if (total <= 0) return;
    let organizing = 0;
    if (Number.isFinite(log.organizationMinutes)) organizing = Math.max(0, log.organizationMinutes!);
    else if (Number.isFinite(log.timeAttackMinutes)) organizing = Math.max(0, total - Math.max(0, log.timeAttackMinutes!));
    organizing = Math.min(total, organizing);
    organize += organizing;
    solve += total - organizing;
  });
  const sum = solve + organize;
  return { solveMinutes: solve, organizeMinutes: organize, solveShare: sum > 0 ? (solve / sum) * 100 : null };
};

export interface ReviewReportSummary {
  /** 복습 문제로 만들어져 일정이 잡힌 문제 수 */
  questions: number;
  attempts: number;
  wrong: number;
  /** 맞힌 비율 0~100. 푼 기록이 없으면 null */
  accuracy: number | null;
  /** 복습 간격이 8일 이상이 되어 정답을 가려서 묻는 문제 수 */
  mastered: number;
  /** 최근 `days`일 동안 복습에 쓴 시간(분) */
  reviewMinutes: number;
}

export const summarizeReview = (logs: StudyLog[], days = 30, now = new Date()): ReviewReportSummary => {
  const startMs = shiftDays(startOfDay(now), -(days - 1)).getTime();
  let questions = 0;
  let attempts = 0;
  let wrong = 0;
  let mastered = 0;
  let reviewMinutes = 0;
  const inWindow = (timestamp: string) => {
    const time = Date.parse(timestamp);
    return Number.isFinite(time) && time >= startMs;
  };
  logs.forEach(log => {
    Object.values(log.reviewQuestionSchedules || {}).forEach(schedule => {
      questions += 1;
      attempts += Math.max(0, schedule.attempts || 0);
      wrong += Math.max(0, schedule.wrongCount || 0);
      if (schedule.masked || (schedule.intervalMs || 0) >= REVIEW_MASK_INTERVAL_MS) mastered += 1;
    });
    (log.basicReviewTimeRecords || []).forEach(record => {
      if (inWindow(record.timestamp) && Number.isFinite(record.minutes)) reviewMinutes += Math.max(0, record.minutes);
    });
    (log.reviewSubjectTimeRecords || []).forEach(record => {
      if (inWindow(record.timestamp) && Number.isFinite(record.minutes)) reviewMinutes += Math.max(0, record.minutes);
    });
  });
  return {
    questions, attempts, wrong, mastered, reviewMinutes,
    accuracy: attempts > 0 ? Math.max(0, Math.min(100, ((attempts - wrong) / attempts) * 100)) : null
  };
};

/** 끝낸 공부 시간을 분으로: 소수(초에서 온 것)를 버리고 정수 분, 1분이 안 되면 "1분 미만". 0이면 "0분" */
export const formatDoneMinutes = (minutes: number) => {
  if (!(minutes > 0)) return '0분';
  if (minutes < 1) return '1분 미만';
  return `${Math.round(minutes)}분`;
};

/** 분을 "1h 20m" 꼴로. 0이면 "0m" */
export const formatMinutesShort = (minutes: number) => {
  const rounded = Math.round(Math.max(0, minutes));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
};

/* ───────────── 추이 화면의 "쌓인 기록" 계산: 주별 · 누적 · 달력 · 요일 · 과목 비중 · 복습 회차 ───────────── */

const parseDateKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
};

/** 월요일에 시작하는 주의 첫날(자정) */
const startOfWeek = (date: Date) => {
  const next = startOfDay(date);
  next.setDate(next.getDate() - ((next.getDay() + 6) % 7));
  return next;
};

const shortDate = (date: Date) => `${date.getMonth() + 1}/${date.getDate()}`;

/** 기록 하나의 풀이(타임어택)·정리 시간. 구분이 없는 기록은 모두 풀이로 본다. */
const solveAndOrganize = (log: StudyLog) => {
  const total = finiteMinutes(log);
  let organizing = 0;
  if (Number.isFinite(log.organizationMinutes)) organizing = Math.max(0, log.organizationMinutes!);
  else if (Number.isFinite(log.timeAttackMinutes)) organizing = Math.max(0, total - Math.max(0, log.timeAttackMinutes!));
  organizing = Math.min(total, organizing);
  return { solve: total - organizing, organize: organizing };
};

/** 합이 정확히 100이 되도록 나눈 정수 퍼센트(가장 큰 나머지 순). 합이 0이면 모두 0. */
export const allocatePercents = (values: number[]) => {
  const sum = values.reduce((total, value) => total + Math.max(0, value), 0);
  if (!(sum > 0)) return values.map(() => 0);
  const exact = values.map(value => (Math.max(0, value) / sum) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((total, value) => total + value, 0);
  exact.map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index)
    .forEach(item => { if (left > 0) { floors[item.index] += 1; left -= 1; } });
  return floors;
};

export interface WeeklyStudyPoint {
  /** 그 주 월요일 날짜 키 */
  key: string;
  /** 막대 아래 글자. 예: "10/12" */
  label: string;
  minutes: number;
  solveMinutes: number;
  organizeMinutes: number;
  pages: number;
  isCurrent: boolean;
}

/** 오늘이 든 주까지 최근 `weeks`주의 주별 학습(월요일 시작). 기록이 없는 주는 0으로 채운다. */
export const buildWeeklyStudy = (logs: StudyLog[], weeks = 12, now = new Date()) => {
  const count = Math.max(1, weeks);
  const thisWeek = startOfWeek(now);
  const points: WeeklyStudyPoint[] = Array.from({ length: count }, (_, index) => {
    const start = new Date(thisWeek);
    start.setDate(start.getDate() - (count - 1 - index) * 7);
    return { key: getLocalDateKey(start), label: shortDate(start), minutes: 0, solveMinutes: 0, organizeMinutes: 0, pages: 0, isCurrent: index === count - 1 };
  });
  const byKey = new Map(points.map(point => [point.key, point]));
  logs.forEach(log => {
    const point = byKey.get(getLocalDateKey(startOfWeek(parseDateKey(getLogStudyDate(log)))));
    if (!point) return;
    const split = solveAndOrganize(log);
    point.minutes += finiteMinutes(log);
    point.solveMinutes += split.solve;
    point.organizeMinutes += split.organize;
    point.pages += finitePages(log);
  });
  // 평균은 끝난 주(오늘이 든 주 제외) 중 공부한 주만으로 낸다. 없으면 0
  const finished = points.filter(point => !point.isCurrent && point.minutes > 0);
  const averageMinutes = finished.length > 0 ? finished.reduce((sum, point) => sum + point.minutes, 0) / finished.length : 0;
  return { points, averageMinutes };
};

export interface CumulativeStudyPoint {
  key: string;
  label: string;
  /** 그 주 끝까지 쌓인 공부 시간(시간) */
  hours: number;
  pages: number;
  /** 그 주에 새로 쌓인 시간(분) */
  weekMinutes: number;
}

export interface CumulativeStudy {
  points: CumulativeStudyPoint[];
  totalMinutes: number;
  totalPages: number;
  studyDays: number;
  firstDateKey: string | null;
}

/** 처음 기록부터 지금까지 쌓인 학습 시간·페이지(주 단위 점). 그래프는 최근 `maxWeeks`주만 그리되 그 앞의 합계는 첫 점에 이미 들어 있다. */
export const buildCumulativeStudy = (logs: StudyLog[], now = new Date(), maxWeeks = 26): CumulativeStudy => {
  const rows = logs.filter(log => finiteMinutes(log) > 0 || finitePages(log) > 0)
    .map(log => ({ key: getLogStudyDate(log), minutes: finiteMinutes(log), pages: finitePages(log) }))
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.key))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (rows.length === 0) return { points: [], totalMinutes: 0, totalPages: 0, studyDays: 0, firstDateKey: null };
  const today = getLocalDateKey(startOfDay(now));
  const visible = rows.filter(row => row.key <= today);
  const firstWeek = startOfWeek(parseDateKey(visible[0]?.key ?? rows[0].key));
  const thisWeek = startOfWeek(now);
  const weekCount = Math.max(1, Math.min(Math.max(1, maxWeeks), Math.round((thisWeek.getTime() - firstWeek.getTime()) / (7 * DAY_MS)) + 1));
  const points: CumulativeStudyPoint[] = [];
  let minutes = 0;
  let pages = 0;
  let cursor = 0;
  for (let index = 0; index < weekCount; index++) {
    const start = new Date(thisWeek);
    start.setDate(start.getDate() - (weekCount - 1 - index) * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const endKey = getLocalDateKey(end);
    let weekMinutes = 0;
    while (cursor < visible.length && visible[cursor].key <= endKey) {
      minutes += visible[cursor].minutes;
      pages += visible[cursor].pages;
      if (visible[cursor].key >= getLocalDateKey(start)) weekMinutes += visible[cursor].minutes;
      cursor += 1;
    }
    points.push({ key: getLocalDateKey(start), label: shortDate(start), hours: minutes / 60, pages, weekMinutes });
  }
  const studyDays = new Set(visible.filter(row => row.minutes > 0).map(row => row.key)).size;
  return {
    points, totalMinutes: visible.reduce((sum, row) => sum + row.minutes, 0), totalPages: visible.reduce((sum, row) => sum + row.pages, 0),
    studyDays, firstDateKey: visible[0]?.key ?? null
  };
};

export interface CalendarDay {
  key: string;
  /** 0=월 … 6=일 */
  row: number;
  minutes: number;
  pages: number;
  /** 0이면 기록 없음, 1~4는 공부한 날들 가운데 적게~많이(사분위) */
  level: 0 | 1 | 2 | 3 | 4;
  isToday: boolean;
  isFuture: boolean;
  label: string;
  weekday: string;
}

export interface StudyCalendar {
  /** 주(열) 하나가 월~일 7칸 */
  columns: CalendarDay[][];
  months: Array<{ column: number; label: string }>;
  studiedDays: number;
  totalMinutes: number;
}

/** 최근 `weeks`주의 하루하루를 달력 칸으로(월요일 시작). 진하기는 공부한 날의 시간을 사분위로 나눈 4단계. */
export const buildStudyCalendar = (logs: StudyLog[], weeks = 15, now = new Date()): StudyCalendar => {
  const count = Math.max(1, weeks);
  const today = startOfDay(now);
  const todayKey = getLocalDateKey(today);
  const first = startOfWeek(today);
  first.setDate(first.getDate() - (count - 1) * 7);
  const byDate = new Map<string, { minutes: number; pages: number }>();
  logs.forEach(log => {
    const key = getLogStudyDate(log);
    const entry = byDate.get(key) || { minutes: 0, pages: 0 };
    entry.minutes += finiteMinutes(log);
    entry.pages += finitePages(log);
    byDate.set(key, entry);
  });
  const days: CalendarDay[][] = Array.from({ length: count }, (_, column) => Array.from({ length: 7 }, (_, row) => {
    const date = new Date(first);
    date.setDate(date.getDate() + column * 7 + row);
    const key = getLocalDateKey(date);
    const entry = byDate.get(key);
    return {
      key, row, minutes: entry?.minutes || 0, pages: entry?.pages || 0, level: 0 as const,
      isToday: key === todayKey, isFuture: key > todayKey, label: shortDate(date), weekday: WEEKDAY_LABELS[date.getDay()]
    };
  }));
  const studied = days.flat().filter(day => !day.isFuture && day.minutes > 0).map(day => day.minutes).sort((a, b) => a - b);
  const quantile = (p: number) => studied[Math.floor(p * (studied.length - 1))];
  const [q1, q2, q3] = studied.length > 0 ? [quantile(0.25), quantile(0.5), quantile(0.75)] : [0, 0, 0];
  days.flat().forEach(day => {
    if (day.isFuture || day.minutes <= 0) return;
    day.level = day.minutes <= q1 ? 1 : day.minutes <= q2 ? 2 : day.minutes <= q3 ? 3 : 4;
  });
  const months: StudyCalendar['months'] = [];
  days.forEach((column, index) => {
    const month = parseDateKey(column[0].key).getMonth();
    const previous = index > 0 ? parseDateKey(days[index - 1][0].key).getMonth() : -1;
    if (month !== previous) months.push({ column: index, label: `${month + 1}월` });
  });
  return { columns: days, months, studiedDays: studied.length, totalMinutes: studied.reduce((sum, value) => sum + value, 0) };
};

export interface WeekdayPatternPoint {
  /** 0=일 … 6=토 */
  weekday: number;
  label: string;
  /** 그 요일이 돌아온 날마다의 평균 학습 시간(분). 공부하지 않은 날도 센다 */
  averageMinutes: number;
  totalMinutes: number;
  /** 구간 안에서 그 요일이 돌아온 횟수 */
  occurrences: number;
}

/** 오늘까지 최근 `weeks`주(=7×weeks일)의 요일별 평균 학습 시간. 월요일부터 일요일 순. */
export const buildWeekdayPattern = (logs: StudyLog[], weeks = 12, now = new Date()): WeekdayPatternPoint[] => {
  const total = Math.max(1, weeks) * 7;
  const today = startOfDay(now);
  const startKey = getLocalDateKey(shiftDays(today, -(total - 1)));
  const endKey = getLocalDateKey(today);
  const minutes = Array(7).fill(0) as number[];
  const occurrences = Array(7).fill(0) as number[];
  for (let offset = 0; offset < total; offset++) occurrences[shiftDays(today, -offset).getDay()] += 1;
  logs.forEach(log => {
    const key = getLogStudyDate(log);
    if (key < startKey || key > endKey) return;
    minutes[parseDateKey(key).getDay()] += finiteMinutes(log);
  });
  return [1, 2, 3, 4, 5, 6, 0].map(weekday => ({
    weekday, label: WEEKDAY_LABELS[weekday], totalMinutes: minutes[weekday], occurrences: occurrences[weekday],
    averageMinutes: occurrences[weekday] > 0 ? minutes[weekday] / occurrences[weekday] : 0
  }));
};

export interface SubjectShareItem {
  id: string;
  name: string;
  minutes: number;
  /** 합이 100이 되도록 나눈 정수 퍼센트 */
  percent: number;
}

/** 과목별 학습 시간 비중. 많은 순으로 `topN`개와 나머지를 합친 "기타". sinceKey(YYYY-MM-DD)를 주면 그 날부터만 센다. */
export const buildSubjectShare = (
  logs: StudyLog[], nameOf: (subjectId: string, log: StudyLog) => string, options: { topN?: number; sinceKey?: string } = {}
): SubjectShareItem[] => {
  const topN = Math.max(1, options.topN ?? 6);
  const sums = new Map<string, { name: string; minutes: number }>();
  logs.forEach(log => {
    if (options.sinceKey && getLogStudyDate(log) < options.sinceKey) return;
    const minutes = finiteMinutes(log);
    if (minutes <= 0) return;
    const entry = sums.get(log.subjectId) || { name: nameOf(log.subjectId, log), minutes: 0 };
    entry.minutes += minutes;
    sums.set(log.subjectId, entry);
  });
  const sorted = Array.from(sums.entries()).map(([id, entry]) => ({ id, name: entry.name, minutes: entry.minutes }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
  const head = sorted.length > topN ? sorted.slice(0, topN - 1) : sorted;
  const rest = sorted.length > topN ? sorted.slice(topN - 1) : [];
  const items = rest.length > 0 ? [...head, { id: '__other', name: `기타 ${rest.length}개`, minutes: rest.reduce((sum, item) => sum + item.minutes, 0) }] : head;
  const percents = allocatePercents(items.map(item => item.minutes));
  return items.map((item, index) => ({ ...item, percent: percents[index] }));
};

export interface ReviewRoundPoint {
  round: number;
  /** 그 회차의 복습을 마친 횟수(기록 수) */
  sessions: number;
  minutes: number;
  pages: number;
  minutesPerPage: number;
  /** 1시간에 푸는 장수(P/h) */
  speed: number;
}

/** 기본 복습의 회차(1회 복습, 2회 복습 …)별 평균 효율. 같은 회차의 시간과 장수를 모두 더해 낸다. */
export const buildReviewRoundEfficiency = (logs: StudyLog[]): ReviewRoundPoint[] => {
  const rounds = new Map<number, { sessions: number; minutes: number; pages: number }>();
  logs.forEach(log => (log.basicReviewTimeRecords || []).forEach(record => {
    if (!(record.minutes > 0) || !(record.pages > 0) || !Number.isFinite(record.minutes) || !Number.isFinite(record.pages)) return;
    const round = Math.max(1, Math.floor(record.reviewNumber || 1));
    const entry = rounds.get(round) || { sessions: 0, minutes: 0, pages: 0 };
    entry.sessions += 1;
    entry.minutes += record.minutes;
    entry.pages += record.pages;
    rounds.set(round, entry);
  }));
  return Array.from(rounds.entries()).sort((a, b) => a[0] - b[0]).map(([round, entry]) => ({
    round, sessions: entry.sessions, minutes: entry.minutes, pages: entry.pages,
    minutesPerPage: entry.minutes / entry.pages, speed: 60 / (entry.minutes / entry.pages)
  }));
};

/* ───────────── 장기 점검: 과목별 쌓인 시간 · 주별 시간 · 계획 점검 ───────────── */

export interface SubjectCumulativeSeries {
  /** 차트 데이터의 키(s0, s1 …). 쌓인 시간이 많은 순서가 곧 색 순서다. */
  key: string;
  id: string;
  name: string;
  totalMinutes: number;
  /** 최근 28일 / 그 앞 28일에 쌓인 시간(분) */
  recentMinutes: number;
  previousMinutes: number;
  /** 합이 100이 되도록 나눈 정수 퍼센트 */
  percent: number;
}

export type SubjectCumulativePoint = { key: string; label: string } & { [seriesKey: string]: number | string };

export interface SubjectCumulative {
  series: SubjectCumulativeSeries[];
  /** 주마다 과목별로 그 주 끝까지 쌓인 시간(시간 단위) */
  points: SubjectCumulativePoint[];
  totalMinutes: number;
}

/** 과목별로 쌓인 학습 시간을 주 단위로(많은 순 `topN`개와 나머지를 합친 "기타"). 그래프는 최근 `maxWeeks`주만 그리되 그 앞의 합계는 첫 점에 들어 있다. */
export const buildSubjectCumulative = (
  logs: StudyLog[], nameOf: (subjectId: string, log: StudyLog) => string, now = new Date(), maxWeeks = 26, topN = 5
): SubjectCumulative => {
  const today = getLocalDateKey(startOfDay(now));
  const rows = logs.map(log => ({ id: log.subjectId, key: getLogStudyDate(log), minutes: finiteMinutes(log), log }))
    .filter(row => row.minutes > 0 && /^\d{4}-\d{2}-\d{2}$/.test(row.key) && row.key <= today)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (rows.length === 0) return { series: [], points: [], totalMinutes: 0 };
  const recentStart = getLocalDateKey(shiftDays(startOfDay(now), -27));
  const previousStart = getLocalDateKey(shiftDays(startOfDay(now), -55));
  const sums = new Map<string, { name: string; total: number; recent: number; previous: number }>();
  rows.forEach(row => {
    const entry = sums.get(row.id) || { name: nameOf(row.id, row.log), total: 0, recent: 0, previous: 0 };
    entry.total += row.minutes;
    if (row.key >= recentStart) entry.recent += row.minutes;
    else if (row.key >= previousStart) entry.previous += row.minutes;
    sums.set(row.id, entry);
  });
  const sorted = Array.from(sums.entries()).map(([id, entry]) => ({ id, ...entry }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const head = sorted.length > topN ? sorted.slice(0, topN) : sorted;
  const rest = sorted.length > topN ? sorted.slice(topN) : [];
  const grouped = rest.length > 0
    ? [...head, { id: '__other', name: `기타 ${rest.length}개`, total: rest.reduce((s, i) => s + i.total, 0), recent: rest.reduce((s, i) => s + i.recent, 0), previous: rest.reduce((s, i) => s + i.previous, 0) }]
    : head;
  const percents = allocatePercents(grouped.map(item => item.total));
  const series: SubjectCumulativeSeries[] = grouped.map((item, index) => ({
    key: `s${index}`, id: item.id, name: item.name, totalMinutes: item.total, recentMinutes: item.recent, previousMinutes: item.previous, percent: percents[index]
  }));
  const keyOf = new Map<string, string>();
  head.forEach((item, index) => keyOf.set(item.id, `s${index}`));
  rest.forEach(item => keyOf.set(item.id, `s${head.length}`));

  const firstWeek = startOfWeek(parseDateKey(rows[0].key));
  const thisWeek = startOfWeek(now);
  const weekCount = Math.max(1, Math.min(Math.max(1, maxWeeks), Math.round((thisWeek.getTime() - firstWeek.getTime()) / (7 * DAY_MS)) + 1));
  const running = new Map<string, number>(series.map(item => [item.key, 0]));
  const points: SubjectCumulativePoint[] = [];
  let cursor = 0;
  for (let index = 0; index < weekCount; index++) {
    const start = new Date(thisWeek);
    start.setDate(start.getDate() - (weekCount - 1 - index) * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const endKey = getLocalDateKey(end);
    while (cursor < rows.length && rows[cursor].key <= endKey) {
      const seriesKey = keyOf.get(rows[cursor].id)!;
      running.set(seriesKey, (running.get(seriesKey) || 0) + rows[cursor].minutes);
      cursor += 1;
    }
    const point: SubjectCumulativePoint = { key: getLocalDateKey(start), label: shortDate(start) };
    series.forEach(item => { point[item.key] = Number(((running.get(item.key) || 0) / 60).toFixed(2)); });
    points.push(point);
  }
  return { series, points, totalMinutes: rows.reduce((sum, row) => sum + row.minutes, 0) };
};

/** 과목마다 최근 `weeks`주의 주별 학습 시간(분). 오래된 주가 앞, 이번 주가 맨 끝. */
export const buildSubjectWeeklyMinutes = (logs: StudyLog[], weeks = 12, now = new Date()): Map<string, number[]> => {
  const count = Math.max(1, weeks);
  const thisWeek = startOfWeek(now);
  const firstWeek = new Date(thisWeek);
  firstWeek.setDate(firstWeek.getDate() - (count - 1) * 7);
  const firstKey = getLocalDateKey(firstWeek);
  const result = new Map<string, number[]>();
  logs.forEach(log => {
    const minutes = finiteMinutes(log);
    const dateKey = getLogStudyDate(log);
    if (minutes <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey < firstKey) return;
    const index = Math.round((startOfWeek(parseDateKey(dateKey)).getTime() - firstWeek.getTime()) / (7 * DAY_MS));
    if (index < 0 || index >= count) return;
    const list = result.get(log.subjectId) || Array(count).fill(0) as number[];
    list[index] += minutes;
    result.set(log.subjectId, list);
  });
  return result;
};

export type PlanStatus = 'done' | 'ahead' | 'ontrack' | 'late' | 'idle' | 'nodate';

export interface PlanCheck {
  status: PlanStatus;
  /** 최근 4주(기록이 더 짧으면 그 기간) 동안의 주당 페이지·시간 */
  weeklyPages: number;
  weeklyMinutes: number;
  remainingPages: number;
  /** 목표일까지 남은 날로 나눈 주당 필요 페이지. 목표일이 없거나 이미 지났으면 null */
  requiredWeeklyPages: number | null;
  /** 최근 페이스로 끝내는 날 − 목표일(일). 양수면 늦고 음수면 빠르다. 계산할 수 없으면 null */
  gapDays: number | null;
  /** 늦을 때 지금 페이스에 더해야 하는 주당 페이지. 늦지 않거나 계산할 수 없으면 null */
  extraWeeklyPages: number | null;
  /** 분/페이지: 처음 4주 → 최근 4주. 둘이 겹치거나 기록이 없으면 null */
  firstEfficiency: number | null;
  recentEfficiency: number | null;
}

/**
 * 과목 하나의 장기 점검. 최근 4주의 페이스를 그대로 이어갈 때 목표일에 맞는지를 본다(계획을 어디서 고칠지의 단서).
 * 저장된 값은 읽기만 한다.
 */
export const buildPlanCheck = (input: { logs: StudyLog[]; remainingPages: number; diffDays: number | null; now?: Date }): PlanCheck => {
  const now = input.now || new Date();
  const todayStart = startOfDay(now);
  const recentStart = getLocalDateKey(shiftDays(todayStart, -27));
  const today = getLocalDateKey(todayStart);
  const rows = input.logs.map(log => ({ key: getLogStudyDate(log), minutes: finiteMinutes(log), pages: finitePages(log) }))
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.key) && row.key <= today && (row.minutes > 0 || row.pages > 0));
  const firstKey = rows.reduce<string | null>((first, row) => (first === null || row.key < first ? row.key : first), null);
  const recent = rows.filter(row => row.key >= recentStart);
  const recentPages = recent.reduce((sum, row) => sum + row.pages, 0);
  const recentMinutes = recent.reduce((sum, row) => sum + row.minutes, 0);
  const activeDays = firstKey === null ? 28 : Math.min(28, Math.max(7, dayNumber(today) - dayNumber(firstKey) + 1));
  const weeks = activeDays / 7;
  const weeklyPages = recentPages / weeks;
  const weeklyMinutes = recentMinutes / weeks;
  const remainingPages = Math.max(0, input.remainingPages);
  const efficiency = (list: typeof rows) => {
    const timed = list.filter(row => row.pages > 0 && row.minutes > 0);
    const pages = timed.reduce((sum, row) => sum + row.pages, 0);
    return pages > 0 ? timed.reduce((sum, row) => sum + row.minutes, 0) / pages : null;
  };
  const firstEnd = firstKey === null ? null : getLocalDateKey(shiftDays(parseDateKey(firstKey), 27));
  const overlaps = firstEnd === null || firstEnd >= recentStart;
  const firstEfficiency = overlaps || firstKey === null ? null : efficiency(rows.filter(row => row.key <= firstEnd!));
  const recentEfficiency = efficiency(recent);
  const base = { weeklyPages, weeklyMinutes, remainingPages, firstEfficiency, recentEfficiency };
  if (remainingPages <= 0) return { ...base, status: 'done', requiredWeeklyPages: null, gapDays: null, extraWeeklyPages: null };
  const required = input.diffDays !== null && input.diffDays > 0 ? remainingPages / (input.diffDays / 7) : null;
  if (input.diffDays === null) return { ...base, status: 'nodate', requiredWeeklyPages: null, gapDays: null, extraWeeklyPages: null };
  if (!(weeklyPages > 0)) return { ...base, status: 'idle', requiredWeeklyPages: required, gapDays: null, extraWeeklyPages: required };
  const projectedDays = (remainingPages / weeklyPages) * 7;
  const gapDays = Math.round(projectedDays - input.diffDays);
  const tolerance = Math.max(2, Math.round(Math.max(input.diffDays, 0) * 0.1));
  const status: PlanStatus = gapDays > tolerance ? 'late' : gapDays < -tolerance ? 'ahead' : 'ontrack';
  const extra = status === 'late' && required !== null ? Math.max(0, required - weeklyPages) : null;
  return { ...base, status, requiredWeeklyPages: required, gapDays, extraWeeklyPages: extra };
};
