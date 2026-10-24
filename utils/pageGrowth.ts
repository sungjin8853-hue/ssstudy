import { StudyLog, Subject } from '../types';
import { getLocalDateKey } from './schedule';
import { DEFAULT_PAGE_LABEL, normalizePageLabel } from './pageLabel';

export const DEFAULT_GROWTH_PAGE_UNIT = 10;
export const normalizeGrowthUnit = (value?: number, fallback = DEFAULT_GROWTH_PAGE_UNIT) => (
  Number.isFinite(value) && value! >= 1 ? Math.floor(value!) : fallback
);

/**
 * 과목의 페이지 단위. 0이면 "단위 없음"이라 효율이 초기화되지 않고 계속 이어진다(기출 문제집처럼 같은 문제가 되풀이되는 책).
 * 저장된 값이 없거나 잘못됐으면 기본 단위다.
 */
export const getGrowthUnitSize = (value?: number) => (value === 0 ? 0 : normalizeGrowthUnit(value));

export const normalizePageGrowthSettings = (subject: Subject) => ({
  growthPageUnit: getGrowthUnitSize(subject.growthPageUnit),
  pageLabel: normalizePageLabel(subject.pageLabel),
  reviewGrowthDisplay: subject.reviewGrowthDisplay === 'unit' ? 'unit' as const : 'review' as const
});

export interface PageEfficiencyUnit {
  index: number;
  pages: number;
  minutes: number;
  averageTimePerPage: number;
  complete: boolean;
  timeAttackMinutes: number;
  timeAttackAverageTimePerPage: number;
  standardDeviation: number;
}

export interface PageEfficiencySample {
  pagesRead: number;
  timeSpentMinutes: number;
  timeAttackMinutes?: number;
  timestamp: string;
  /** 푼 페이지 범위. 페이지 단위로 효율을 나눌 때만 쓴다(없으면 단위와 상관없이 이어진다). */
  startPage?: number;
  endPage?: number;
}

export const hasMeasurementOnDate = (logs: PageEfficiencySample[], date: string) => logs.some(log => (
  log.pagesRead > 0 && log.timeSpentMinutes > 0 && Number.isFinite(Date.parse(log.timestamp))
    && getLocalDateKey(new Date(log.timestamp)) === date
));

export const buildPageEfficiencyUnits = (logs: PageEfficiencySample[], pageUnit?: number) => {
  const unitSize = normalizeGrowthUnit(pageUnit);
  const units: PageEfficiencyUnit[] = [];
  let pages = 0;
  let minutes = 0;
  let attackMinutes = 0;
  let rateSquares = 0;
  const append = (complete: boolean) => {
    units.push({ index: units.length + 1, pages, minutes, averageTimePerPage: minutes / pages, complete,
      timeAttackMinutes: attackMinutes, timeAttackAverageTimePerPage: attackMinutes / pages,
      standardDeviation: Math.sqrt(Math.max(0, rateSquares / pages - (minutes / pages) ** 2)) });
    pages = 0;
    minutes = 0;
    attackMinutes = 0;
    rateSquares = 0;
  };
  logs.filter(log => Number.isFinite(log.pagesRead) && log.pagesRead > 0
    && Number.isFinite(log.timeSpentMinutes) && log.timeSpentMinutes > 0 && Number.isFinite(Date.parse(log.timestamp)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .forEach(log => {
      let remaining = log.pagesRead;
      const rate = log.timeSpentMinutes / log.pagesRead;
      const attackRate = (Number.isFinite(log.timeAttackMinutes)
        ? Math.min(log.timeSpentMinutes, Math.max(0, log.timeAttackMinutes!)) : log.timeSpentMinutes) / log.pagesRead;
      while (remaining > 1e-9) {
        const amount = Math.min(remaining, unitSize - pages);
        pages += amount;
        minutes += amount * rate;
        attackMinutes += amount * attackRate;
        rateSquares += amount * rate ** 2;
        remaining -= amount;
        if (unitSize - pages < 1e-9) append(true);
      }
    });
  if (pages > 1e-9) append(false);
  return units;
};

// One point per page unit (the last may still be filling), dated when the unit was reached.
// speedIncrease compares each unit with the subject's first unit, like the growth cells do.
export const getUnitSpeedTrend = (logs: StudyLog[], pageUnit?: number) => {
  const unitSize = normalizeGrowthUnit(pageUnit);
  const valid = logs.filter(log => Number.isFinite(log.pagesRead) && log.pagesRead > 0
    && Number.isFinite(log.timeSpentMinutes) && log.timeSpentMinutes > 0 && Number.isFinite(Date.parse(log.timestamp)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const units = buildPageEfficiencyUnits(valid, unitSize);
  const endedAt: string[] = [];
  let cumulativePages = 0;
  valid.forEach(log => {
    cumulativePages += log.pagesRead;
    while (endedAt.length < units.length && cumulativePages >= (endedAt.length + 1) * unitSize - 1e-9) endedAt.push(log.timestamp);
  });
  while (endedAt.length < units.length) endedAt.push(valid[valid.length - 1].timestamp);
  return units.map((unit, index) => ({
    unit,
    timestamp: endedAt[index],
    speedIncrease: (units[0].averageTimePerPage / unit.averageTimePerPage - 1) * 100
  }));
};

/** 효율을 재는 한 덩어리 = 공부한 시간 25분(뽀모도로). 짧은 시간의 값은 믿기 어려워서 25분 평균을 "지금의 효율"로 본다. */
export const EFFICIENCY_WINDOW_MINUTES = 25;

/** 공부한 시간 25분 동안의 평균. 장당 시간(분/P)은 그 시간에 푼 장수로 나눈 값이다. */
export interface EfficiencyWindow {
  pages: number;
  minutes: number;
  averageTimePerPage: number;
  timeAttackMinutes: number;
  timeAttackAverageTimePerPage: number;
  standardDeviation: number;
  /** 25분을 다 채웠으면 true. 25분 미만의 기록뿐일 때만 false인 한 덩어리가 나온다. */
  complete: boolean;
}

const isMeasuredSample = (log: PageEfficiencySample) => Number.isFinite(log.pagesRead) && log.pagesRead > 0
  && Number.isFinite(log.timeSpentMinutes) && log.timeSpentMinutes > 0 && Number.isFinite(Date.parse(log.timestamp));

const chronological = <T extends PageEfficiencySample>(logs: T[]) => logs.filter(isMeasuredSample)
  .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

/**
 * 가장 최근 공부부터 25분씩 끊어 뽀모도로 덩어리를 만든다(맨 앞이 가장 최근, 그 뒤가 1회 전, 2회 전 …).
 * 기록 하나가 두 덩어리에 걸치면 그 기록은 시간에 비례해 나눈다(기록 안에서는 같은 속도로 풀었다고 본다).
 * 가장 오래된 쪽에 25분이 못 되는 자투리가 남으면 버린다. 전체가 25분이 안 되면 있는 만큼이 한 덩어리다(complete=false).
 */
export const buildEfficiencyWindows = (logs: PageEfficiencySample[], windowMinutes = EFFICIENCY_WINDOW_MINUTES): EfficiencyWindow[] => {
  const windows: EfficiencyWindow[] = [];
  let pages = 0, minutes = 0, attack = 0, rateSquares = 0;
  const clear = () => { pages = 0; minutes = 0; attack = 0; rateSquares = 0; };
  // 기록을 시간에 비례해 나누면 0.0000000000001 같은 계산 오차가 남으므로 9자리에서 맞춘다.
  const tidy = (value: number) => Math.round(value * 1e9) / 1e9;
  const toWindow = (complete: boolean): EfficiencyWindow => ({
    pages: tidy(pages), minutes: tidy(minutes), averageTimePerPage: tidy(minutes / pages), complete,
    timeAttackMinutes: tidy(attack), timeAttackAverageTimePerPage: tidy(attack / pages),
    standardDeviation: tidy(Math.sqrt(Math.max(0, rateSquares / pages - (minutes / pages) ** 2)))
  });
  for (const log of chronological(logs).reverse()) {
    const rate = log.timeSpentMinutes / log.pagesRead;
    const attackShare = (Number.isFinite(log.timeAttackMinutes)
      ? Math.min(log.timeSpentMinutes, Math.max(0, log.timeAttackMinutes!)) : log.timeSpentMinutes) / log.timeSpentMinutes;
    let left = log.timeSpentMinutes;
    while (left > 1e-9) {
      const take = Math.min(left, windowMinutes - minutes);
      pages += take / rate;
      minutes += take;
      attack += take * attackShare;
      rateSquares += (take / rate) * rate ** 2;
      left -= take;
      if (windowMinutes - minutes < 1e-9) { windows.push(toWindow(true)); clear(); }
    }
  }
  if (windows.length === 0 && minutes > 1e-9) windows.push(toWindow(false));
  return windows;
};

/**
 * 지금의 효율 = 가장 최근 25분(뽀모도로)의 평균. 예상 시간·뽀모도로 장수를 정하는 기준이다.
 * 25분이 안 되는 기록뿐이면 있는 기록 전부의 평균이다. 페이지 단위로 나누지 않는다(단위는 이전 성장과 견주는 데만 쓴다).
 */
export const calculateUnitEfficiency = (logs: PageEfficiencySample[]) => {
  const basis = buildEfficiencyWindows(logs)[0] || null;
  return { basis, averageTimePerPage: basis?.averageTimePerPage || 0,
    timeAttackAverageTimePerPage: basis?.timeAttackAverageTimePerPage || 0,
    standardDeviation: basis?.standardDeviation || 0 };
};

/** 끝 페이지(또는 시작 페이지)가 몇 번째 단위에 있는가. 단위는 책의 첫 페이지부터 unitSize쪽씩 끊는다. */
export const pageUnitIndex = (page: number, unitSize: number, firstPage = 1) => (
  Math.max(0, Math.floor((page - firstPage) / unitSize))
);

/** "다음 단위까지"에 쓰는 값. 단위는 푼 장수로 센다: 단위 크기만큼 풀 때마다 한 단위가 찬다. */
export interface UnitProgress {
  unitSize: number;
  /** 지금 채우는 단위가 몇 번째인가(1부터). 막 단위를 마쳤으면 다음 단위가 0장으로 시작한다. */
  index: number;
  /** 지금 단위에서 푼 장수 (막 단위를 마쳤으면 0) */
  done: number;
  remaining: number;
}

/**
 * 효율 칸이 쓸 기록과 단위. 페이지 단위는 효율을 초기화하지 않고, 이전 성장과 견주는 단위로 쓴다.
 *  - 단위는 푼 장수로 센다(끝 페이지가 어디인지와 상관없다). 단위 크기만큼 풀 때마다 한 단위가 차고, 한 기록이 두 단위에 걸치면 장수에 비례해 나눈다.
 *  - 효율(가장 최근 25분)은 과목의 측정 기록 전체에서 잰다. 단위를 넘어도 새로 시작하지 않는다.
 *  - units는 마친 단위들과 지금 채우는 단위다. 이전 단위·이이전 단위와의 비교에 쓴다.
 *  - unitSize가 0이면 단위가 없다. units는 비고, 평균과는 견줄 수 있다.
 */
export interface EfficiencyScope {
  /** 효율을 재는 기록(오래된 것부터). */
  current: PageEfficiencySample[];
  /** 푼 장수로 센 단위들(맨 끝은 아직 채우는 중일 수 있다). */
  units: PageEfficiencyUnit[];
  progress: UnitProgress | null;
}

export const getEfficiencyScope = (samples: PageEfficiencySample[], unitSize: number, firstPage = 1, reachedPage?: number): EfficiencyScope => {
  const logs = chronological(samples);
  if (!(unitSize > 0)) return { current: logs, units: [], progress: null };
  // 기록이 없으면 지금까지 푼 쪽수(끝 페이지 − 시작 페이지 + 1)로 게이지를 채운다.
  const solved = logs.length > 0 ? logs.reduce((sum, log) => sum + log.pagesRead, 0)
    : typeof reachedPage === 'number' && Number.isFinite(reachedPage) ? Math.max(0, reachedPage - firstPage + 1) : 0;
  const finished = Math.floor(solved / unitSize + 1e-9);
  const rest = solved - finished * unitSize;
  const done = rest < 1e-9 ? 0 : rest;
  return {
    current: logs,
    units: buildPageEfficiencyUnits(logs, unitSize),
    progress: { unitSize, index: finished + 1, done, remaining: unitSize - done }
  };
};

/** 효율 칸에서 견줄 수 있는 가장 먼 뽀모도로. 5회 전보다 더 이전과는 견주지 않는다. */
export const MAX_COMPARISON_POMODOROS = 5;
/** 효율 칸에서 견줄 수 있는 가장 먼 마친 단위: 이전 단위(1), 이이전 단위(2) */
export const MAX_COMPARISON_UNITS = 2;

/** 효율 칸이 무엇과 견주는가: 뽀모도로 N회 전 · 이전(N=1)/이이전(N=2) 단위 · 과목 평균 */
export type EfficiencyComparison =
  | { kind: 'pomodoro'; n: number }
  | { kind: 'unit'; n: number }
  | { kind: 'average' };

export const sameComparison = (a: EfficiencyComparison, b: EfficiencyComparison) => (
  a.kind === b.kind && (a.kind === 'average' || (b.kind !== 'average' && a.n === b.n))
);

/** 과목 평균: 측정 기록 전체의 장당 시간(합계 ÷ 장수) */
export interface EfficiencyAverage {
  pages: number;
  averageTimePerPage: number;
  timeAttackAverageTimePerPage: number;
}

export interface EfficiencyView {
  /** 효율 칸에 보이는 덩어리: 가장 최근 25분의 평균. 새 단위가 막 시작돼 그 단위에 푼 기록이 아직 없으면 이전 단위의 평균. 쓸 기록이 없으면 null. */
  shown: EfficiencyWindow | null;
  /** 새 단위가 막 시작돼서 이전 단위의 평균을 가져와 보이는 중인가 */
  inherited: boolean;
  /** 지금 견주는 기준(견줄 수 없는 기준을 골랐어도 고른 그대로 둔다). 단위는 있는 만큼으로 줄인다. */
  choice: EfficiencyComparison;
  /** 뽀모도로 N회 전과 견주는 중이면 그 N(1~5). 아니거나 견줄 덩어리가 없으면 0. */
  comparison: number;
  /** 고를 수 있는 가장 먼 뽀모도로(0이면 견줄 덩어리가 없다). */
  maxComparison: number;
  /** 견줄 수 있는 마친 단위 수(0~2). */
  maxUnits: number;
  /** 견줄 수 있는 기준들을 버튼이 넘기는 순서대로: 뽀모도로 1~5회 전 → 이전 단위 → 이이전 단위 → 평균 */
  options: EfficiencyComparison[];
  /** 뽀모도로로 견줄 때의 기준 덩어리 */
  reference: EfficiencyWindow | null;
  /** 단위로 견줄 때의 기준 단위(이전 단위 또는 이이전 단위) */
  referenceUnit: PageEfficiencyUnit | null;
  /** 평균과 견줄 수 있을 때의 평균 */
  average: EfficiencyAverage | null;
  overall: GrowthChange | null;
  attack: GrowthChange | null;
}

const averageOf = (logs: PageEfficiencySample[], shown: EfficiencyWindow): EfficiencyAverage | null => {
  let pages = 0, minutes = 0, attack = 0;
  logs.forEach(log => {
    pages += log.pagesRead;
    minutes += log.timeSpentMinutes;
    attack += Number.isFinite(log.timeAttackMinutes) ? Math.min(log.timeSpentMinutes, Math.max(0, log.timeAttackMinutes!)) : log.timeSpentMinutes;
  });
  // 보이는 25분 덩어리뿐이면 견줄 평균이 따로 없다
  if (pages - shown.pages < 1e-6) return null;
  return { pages, averageTimePerPage: minutes / pages, timeAttackAverageTimePerPage: attack / pages };
};

/**
 * 효율 칸이 보여줄 값을 정한다.
 *  - 값은 과목의 가장 최근 25분 평균이다(페이지 단위를 넘어도 새로 시작하지 않는다). 다만 새 단위가 막 시작돼 그 단위에 푼 기록이
 *    아직 없으면 이전 단위의 평균을 가져와 보인다(`inherited`). 이때는 그 단위 자신과 견주지 않고 그 앞 단위들·평균과 견준다.
 *  - 변화(속도·공부량)는 그 값과 고른 기준의 차이다. 기준은 뽀모도로 N회 전(기본 1회 전, 최대 5회 전) ·
 *    이전 단위 · 이이전 단위(푼 장수로 센 마친 단위의 평균) · 과목 평균이다.
 *  - 견줄 수 없는 기준이면 변화를 숨긴다. `comparison`을 숫자로 주면 뽀모도로 N회 전이다.
 */
export const getEfficiencyView = (scope: EfficiencyScope, comparison: number | EfficiencyComparison = 1): EfficiencyView => {
  const requested: EfficiencyComparison = typeof comparison === 'number' ? { kind: 'pomodoro', n: comparison } : comparison;
  const windows = buildEfficiencyWindows(scope.current);
  const finishedUnits = scope.units.filter(unit => unit.complete);
  // 새 단위가 시작되면 이전 단위를 가져온다: 막 단위를 마쳐서 새 단위에 푼 기록이 아직 없으면 효율 칸은 이전 단위의 평균이다.
  const inherited = windows.length > 0 && finishedUnits.length > 0 && Boolean(scope.progress) && scope.progress!.done < 1e-9;
  const inheritedUnit = inherited ? finishedUnits[finishedUnits.length - 1] : null;
  const shown: EfficiencyWindow | null = inheritedUnit
    ? { pages: inheritedUnit.pages, minutes: inheritedUnit.minutes, averageTimePerPage: inheritedUnit.averageTimePerPage,
        timeAttackMinutes: inheritedUnit.timeAttackMinutes, timeAttackAverageTimePerPage: inheritedUnit.timeAttackAverageTimePerPage,
        standardDeviation: inheritedUnit.standardDeviation, complete: true }
    : windows[0] || null;
  if (!shown) {
    return { shown, inherited: false, choice: requested.kind === 'average' ? requested : { kind: requested.kind, n: 0 }, comparison: 0, maxComparison: 0, maxUnits: 0, options: [],
      reference: null, referenceUnit: null, average: null, overall: null, attack: null };
  }
  // 이전 단위를 가져와 보이는 중에는 그 단위 자신과 견주지 않는다: 그 앞 단위들과 평균으로 견주고, 뽀모도로로는 견주지 않는다.
  const finished = inherited ? finishedUnits.slice(0, -1) : finishedUnits;
  const maxComparison = inherited ? 0 : Math.min(MAX_COMPARISON_POMODOROS, windows.length - 1);
  const maxUnits = Math.min(MAX_COMPARISON_UNITS, finished.length);
  const average = averageOf(scope.current, shown);
  const options: EfficiencyComparison[] = [
    ...Array.from({ length: maxComparison }, (_, index): EfficiencyComparison => ({ kind: 'pomodoro', n: index + 1 })),
    ...Array.from({ length: maxUnits }, (_, index): EfficiencyComparison => ({ kind: 'unit', n: index + 1 })),
    ...(average ? [{ kind: 'average' } as EfficiencyComparison] : [])
  ];
  const wanted = requested.kind === 'average' ? 1 : Math.max(1, Math.floor(requested.n) || 1);
  // 이전 단위를 가져와 보이는 중에 뽀모도로 기준이 골라져 있으면 이전 단위(그 앞 단위)로 견준다
  const effective: EfficiencyComparison = inherited && requested.kind === 'pomodoro'
    ? maxUnits > 0 ? { kind: 'unit', n: 1 } : average ? { kind: 'average' } : { kind: 'unit', n: 0 }
    : requested;
  let choice: EfficiencyComparison = effective;
  let reference: EfficiencyWindow | null = null;
  let referenceUnit: PageEfficiencyUnit | null = null;
  let against: { overall: number; attack: number } | null = null;
  if (effective.kind === 'pomodoro') {
    const used = maxComparison > 0 ? Math.min(maxComparison, wanted) : 0;
    choice = { kind: 'pomodoro', n: used };
    reference = used > 0 ? windows[used] : null;
    if (reference) against = { overall: reference.averageTimePerPage, attack: reference.timeAttackAverageTimePerPage };
  } else if (effective.kind === 'unit') {
    const used = maxUnits > 0 ? Math.min(maxUnits, effective === requested ? wanted : 1) : 0;
    choice = { kind: 'unit', n: used };
    referenceUnit = used > 0 ? finished[finished.length - used] : null;
    if (referenceUnit) against = { overall: referenceUnit.averageTimePerPage, attack: referenceUnit.timeAttackAverageTimePerPage };
  } else if (average) {
    against = { overall: average.averageTimePerPage, attack: average.timeAttackAverageTimePerPage };
  }
  return {
    shown, inherited, choice, comparison: choice.kind === 'pomodoro' ? choice.n : 0, maxComparison, maxUnits, options, reference, referenceUnit, average,
    overall: against ? toGrowthChange(against.overall, shown.averageTimePerPage) : null,
    attack: against ? toGrowthChange(against.attack, shown.timeAttackAverageTimePerPage) : null
  };
};

/** 비교 버튼을 한 번 더 눌렀을 때의 뽀모도로 수. 1→2→…→5(또는 있는 만큼)→1. (뽀모도로 안에서만 돈다) */
export const nextComparison = (view: Pick<EfficiencyView, 'comparison' | 'maxComparison'>) => (
  view.maxComparison <= 1 || view.comparison >= view.maxComparison ? 1 : view.comparison + 1
);

/** 비교 버튼을 한 번 더 눌렀을 때의 기준: 뽀모도로 1~5회 전 → 이전 단위 → 이이전 단위 → 평균 → 다시 뽀모도로 1회 전. 견줄 수 없는 기준은 건너뛴다. */
export const nextEfficiencyComparison = (view: Pick<EfficiencyView, 'choice' | 'options'>): EfficiencyComparison => {
  if (view.options.length === 0) return view.choice;
  const at = view.options.findIndex(option => sameComparison(option, view.choice));
  return view.options[(at + 1) % view.options.length];
};

/** 속도를 "일정 시간 안에 몇 장을 푸는지"로 말할 때 쓰는 기준 시간(분). 한 시간이다(뽀모도로 25분과는 따로). */
export const SPEED_REFERENCE_MINUTES = 60;
/** 화면에 쓰는 기준 시간 글자 */
export const SPEED_REFERENCE_LABEL = '1시간';

/** 장당 시간(분/P)을 "기준 시간(1시간)에 푸는 장수"로 바꾼다. 장당 시간이 없으면 0. */
export const pagesPerReferenceTime = (minutesPerPage: number | null | undefined) => (
  minutesPerPage && Number.isFinite(minutesPerPage) && minutesPerPage > 0 ? SPEED_REFERENCE_MINUTES / minutesPerPage : 0
);

/**
 * 이전보다 얼마나 달라졌는지를 사람이 바로 읽는 두 숫자로 나타낸다(퍼센트는 쓰지 않는다). 모든 과목이 같은 규칙이다.
 *  - speedPages: 1시간 동안 푸는 장수의 차이. + 이면 같은 시간에 그만큼 더 풀었다.
 *  - studyMinutes: 한 페이지에 쓴 시간(분)의 차이. + 이면 한 페이지에 그만큼 더 오래 공부했다.
 * 두 값은 같은 변화를 서로 다른 눈으로 본 것이라 부호가 늘 반대다(빨라지면 속도 +, 공부량 −).
 */
export interface GrowthDelta { speedPages: number; studyMinutes: number }
/** 소수 첫째 자리로 반올림한 값. 화면에 쓰는 값이다. */
export type GrowthChange = GrowthDelta;

/** 이전 장당 시간 → 지금 장당 시간의 반올림 전 변화. 어느 한쪽이라도 없으면 null. */
export const getGrowthDelta = (referenceMinutesPerPage: number | null | undefined, currentMinutesPerPage: number | null | undefined): GrowthDelta | null => {
  if (!referenceMinutesPerPage || !currentMinutesPerPage || !Number.isFinite(referenceMinutesPerPage) || !Number.isFinite(currentMinutesPerPage)
    || referenceMinutesPerPage <= 0 || currentMinutesPerPage <= 0) return null;
  return {
    speedPages: pagesPerReferenceTime(currentMinutesPerPage) - pagesPerReferenceTime(referenceMinutesPerPage),
    studyMinutes: currentMinutesPerPage - referenceMinutesPerPage
  };
};

/** 소수 첫째 자리까지 반올림(0.05는 0에서 먼 쪽으로, 음수도 같은 크기로). -0은 0으로 바꾼다. */
export const roundTenth = (value: number) => (Math.sign(value) * Math.round(Math.abs(value) * 10 + 1e-9) / 10) || 0;

export const roundGrowthDelta = (delta: GrowthDelta | null | undefined): GrowthChange | null => (
  delta ? { speedPages: roundTenth(delta.speedPages), studyMinutes: roundTenth(delta.studyMinutes) } : null
);

export const toGrowthChange = (referenceMinutesPerPage: number | null | undefined, currentMinutesPerPage: number | null | undefined) => (
  roundGrowthDelta(getGrowthDelta(referenceMinutesPerPage, currentMinutesPerPage))
);

/** "+2.4" / "−1.0" / "0.0" (소수 첫째 자리까지) */
export const formatSignedTenth = (value: number) => {
  const rounded = roundTenth(value);
  return rounded > 0 ? `+${rounded.toFixed(1)}` : rounded < 0 ? `−${Math.abs(rounded).toFixed(1)}` : '0.0';
};

/** 알약·기록에 쓰는 글자. 속도는 1시간당 장수(P/h), 공부량은 한 페이지당 분. */
export const describeSpeed = (change: GrowthChange, label = DEFAULT_PAGE_LABEL) => `속도 ${formatSignedTenth(change.speedPages)}${label}/h`;
export const describeStudyAmount = (change: GrowthChange, label = DEFAULT_PAGE_LABEL) => `공부량 ${formatSignedTenth(change.studyMinutes)}분/${label}`;
/** 속도와 공부량을 늘 함께 보여준다. 기본 복습은 공부량 없이 속도만(speedOnly). */
export const describeGrowthChange = (change: GrowthChange | null | undefined, speedOnly = false, label = DEFAULT_PAGE_LABEL) => (
  change ? (speedOnly ? describeSpeed(change, label) : `${describeSpeed(change, label)} · ${describeStudyAmount(change, label)}`) : null
);
