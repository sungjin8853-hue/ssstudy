import { StudyLog, Subject } from '../types';
import { getReviewEfficiencySamples } from './math';
import { buildEfficiencyWindows, calculateUnitEfficiency, EFFICIENCY_WINDOW_MINUTES, formatSignedTenth, PageEfficiencySample, SPEED_REFERENCE_MINUTES } from './pageGrowth';
import { getSubjectFamily, isFamilyStudyLog } from './subjectChain';
import { getLocalDateKey, getStageInitialMinutesPerPage, getSubjectRemainingPageCount, getSubjectStages, parseStudyDate } from './schedule';

/**
 * 학습 설정의 "속도 증가" 계산.
 *  - 속도 = 1시간 동안 푸는 장수(P/h). 공부한 시간 25분(뽀모도로)마다 하나씩 잰다. 학습 실행의 "속도 +1.2P/h"와 같은 값이다.
 *  - 속도 증가율 = 가장 최근 25분의 속도 − 그 바로 앞 25분의 속도 (최근 값). 학습 실행의 알약과 같다.
 *  - 속도 증가 그래프 = 페이지 위치(가로)에 따라, 각 25분의 속도가 첫 25분보다 얼마나 늘었는지(P/h). 위치를 모르는 기록이면 푼 장수의 합이 가로다.
 *  - 페이지당 가속도 = 푼 장수 1P마다 속도가 평균 얼마나 늘었는지(P/h per P, 평균 증가량 기울기). 학습 설정이 쓴다. 추이 분석의 학습시간 가속도(P/h per h)는 따로 그대로 둔다.
 *  - 완료 예측 = 지금 속도에서 시작해 1P를 풀 때마다 페이지당 가속도만큼 빨라진다고 보고, 남은 페이지 범위의 장수를 다 푸는 데 걸리는 시간.
 */

/** 가속도를 구하려면 25분 덩어리가 최소 이만큼은 있어야 한다(둘이면 어떤 직선이든 맞아 버린다) */
export const MIN_WINDOWS_FOR_ACCELERATION = 3;
/** 추이분석의 속도 덩어리: 공부한 시간 1시간마다 하나. 25분(뽀모도로)보다 덜 흔들리고, 뽀모도로 길이를 바꿔도 변하지 않는다. */
export const TREND_WINDOW_MINUTES = 60;
/** 예측에서 속도가 지금의 몇 배까지만 변한다고 보는가(빨라지는 쪽 / 느려지는 쪽). 직선을 멀리 늘려도 터무니없어지지 않게 막는다. */
export const SPEED_CLAMP_MAX_FACTOR = 2;
export const SPEED_CLAMP_MIN_FACTOR = 0.5;

export interface SpeedPoint {
  /** 0부터, 오래된 25분이 먼저 */
  index: number;
  /** 이 25분이 끝난 때까지 쌓인 공부 시간(시간) */
  hours: number;
  timestamp: string;
  /** 이 25분이 끝난 공부 날짜 */
  dateKey: string;
  /** 이 25분이 끝난 순간의 페이지 위치(기록의 시작~끝 페이지 안에서 시간에 비례해 찾는다). 기록에 페이지 범위가 없으면 null */
  page: number | null;
  /** 이 25분이 끝날 때까지 푼 장수의 합(페이지 위치를 모를 때 가로축으로 쓴다) */
  pagesDone: number;
  /** P/h */
  speed: number;
  /** 첫 25분의 속도보다 늘어난 값(P/h). 첫 점은 0 */
  gain: number;
  /** 바로 앞 25분보다 늘어난 값(P/h). 첫 점은 null */
  growth: number | null;
}

export interface SpeedSeries {
  points: SpeedPoint[];
  /** 가장 최근 25분의 속도(P/h). 25분을 채운 기록이 없으면 null */
  latestSpeed: number | null;
  /** 속도 증가율(최근 값): 가장 최근 25분 − 그 앞 25분 (P/h). 25분 덩어리가 둘 미만이면 null */
  latestGrowth: number | null;
  /** 학습시간 가속도: 속도가 공부 1시간마다 늘어나는 양(P/h per h, 최소제곱). 추이 분석이 쓴다. 덩어리가 MIN_WINDOWS_FOR_ACCELERATION 미만이면 null */
  acceleration: number | null;
  /**
   * 페이지당 가속도(P/h per P): 푼 장수 1P마다 속도가 평균 얼마나 늘어났는가 = 평균 증가량 기울기.
   * (첫 25분보다 마지막 25분이 늘어난 속도) ÷ (그 사이 푼 장수). 학습 설정의 가속도와 완료 예측이 쓴다.
   * 덩어리가 MIN_WINDOWS_FOR_ACCELERATION 미만이거나 그 사이 푼 장수가 0이면 null
   */
  pageAcceleration: number | null;
}

const EMPTY_SERIES: SpeedSeries = { points: [], latestSpeed: null, latestGrowth: null, acceleration: null, pageAcceleration: null };

type SpeedLog = PageEfficiencySample & { studyDate?: string };

const isMeasured = (log: SpeedLog) => Number.isFinite(log.pagesRead) && log.pagesRead > 0
  && Number.isFinite(log.timeSpentMinutes) && log.timeSpentMinutes > 0 && Number.isFinite(Date.parse(log.timestamp));

/**
 * 기록 하나 안에서 시간이 fraction(0~1)만큼 지났을 때 풀고 있던 페이지. 시작~끝 페이지를 시간에 비례해 나눈다
 * (끝까지 지났으면 끝 페이지). 페이지 범위가 없는 기록(기본복습 기록 등)은 null.
 */
const pageAtFraction = (log: SpeedLog, fraction: number): number | null => {
  const { startPage, endPage } = log;
  if (typeof startPage !== 'number' || typeof endPage !== 'number' || !Number.isFinite(startPage) || !Number.isFinite(endPage) || endPage < startPage) return null;
  const share = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 1;
  return Math.round((startPage - 1 + share * (endPage - startPage + 1)) * 100) / 100;
};

/**
 * 평균 증가량 기울기: 속도가 25분마다 평균 얼마나 늘었는지를 25분마다 평균 몇 장을 풀었는지로 나눈 값 = 푼 장수 1P당 늘어난 속도(P/h per P).
 * 첫 점 뒤의 증가량을 모두 더하면 (마지막 속도 − 첫 속도)라서, 그 값을 첫 점 뒤에 푼 장수로 나눈 것과 같다. 푼 장수가 0이면 null.
 */
export const averageGainPerPage = (points: Array<Pick<SpeedPoint, 'gain' | 'pagesDone'>>): number | null => {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const pages = last.pagesDone - first.pagesDone;
  return pages > 1e-9 ? (last.gain - first.gain) / pages : null;
};

/** x(시간)에 따른 y의 최소제곱 직선의 기울기. 점이 둘 미만이거나 x가 모두 같으면 null */
export const fitSlope = (xs: number[], ys: number[]) => {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    covariance += (xs[i] - meanX) * (ys[i] - meanY);
    variance += (xs[i] - meanX) ** 2;
  }
  return variance > 1e-12 ? covariance / variance : null;
};

/**
 * 기록 → 25분마다 하나씩의 속도 점. 25분 덩어리 나누는 방식은 학습 실행의 효율과 같다(가장 최근부터 25분씩, 오래된 자투리는 버린다).
 * timeAttack이면 속도를 정리 시간을 뺀 "문제 푸는 시간(타임어택)"으로 센다(타임어택 기록이 없는 덩어리는 전체 시간으로).
 */
export const buildSpeedSeries = (samples: SpeedLog[], options: { timeAttack?: boolean; windowMinutes?: number } = {}): SpeedSeries => {
  // 덩어리 길이: 기본은 학습 실행의 효율과 같은 25분. 추이분석은 1시간(TREND_WINDOW_MINUTES)으로 잰다.
  const windowMinutes = options.windowMinutes && options.windowMinutes > 0 ? options.windowMinutes : EFFICIENCY_WINDOW_MINUTES;
  const logs = samples.filter(isMeasured).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const windows = buildEfficiencyWindows(logs, windowMinutes).filter(window => window.complete).reverse();
  if (windows.length === 0) return EMPTY_SERIES;
  const totalMinutes = logs.reduce((sum, log) => sum + log.timeSpentMinutes, 0);
  const leftover = Math.max(0, totalMinutes - windows.length * windowMinutes);
  // 각 덩어리가 끝난 순간이 어느 기록 안에 있는지 찾아 날짜와 페이지 위치를 붙인다.
  const endsAt: SpeedLog[] = [];
  const pagesAt: Array<number | null> = [];
  let running = 0;
  let cursor = 0;
  windows.forEach((_, index) => {
    const target = leftover + (index + 1) * windowMinutes;
    while (cursor < logs.length - 1 && running + logs[cursor].timeSpentMinutes < target - 1e-6) {
      running += logs[cursor].timeSpentMinutes;
      cursor += 1;
    }
    endsAt.push(logs[cursor]);
    pagesAt.push(pageAtFraction(logs[cursor], (target - running) / logs[cursor].timeSpentMinutes));
  });
  let pagesDone = 0;
  const speeds = windows.map(window => SPEED_REFERENCE_MINUTES / (options.timeAttack && window.timeAttackAverageTimePerPage > 0 ? window.timeAttackAverageTimePerPage : window.averageTimePerPage));
  const points: SpeedPoint[] = windows.map((chunk, index) => ({
    index,
    hours: ((index + 1) * windowMinutes) / 60,
    timestamp: endsAt[index].timestamp,
    dateKey: endsAt[index].studyDate || getLocalDateKey(new Date(endsAt[index].timestamp)),
    page: pagesAt[index],
    pagesDone: (pagesDone += chunk.pages),
    speed: speeds[index],
    gain: speeds[index] - speeds[0],
    growth: index > 0 ? speeds[index] - speeds[index - 1] : null
  }));
  const latest = points[points.length - 1];
  return {
    points,
    latestSpeed: latest.speed,
    latestGrowth: latest.growth,
    acceleration: points.length >= MIN_WINDOWS_FOR_ACCELERATION ? fitSlope(points.map(p => p.hours), points.map(p => p.gain)) : null,
    pageAcceleration: points.length >= MIN_WINDOWS_FOR_ACCELERATION ? averageGainPerPage(points) : null
  };
};

/**
 * 남은 장수(남은 페이지 범위의 장수)를 다 푸는 데 걸리는 시간(분). 속도는 지금 speed(P/h)에서 시작해 1P를 풀 때마다 acceleration(P/h)씩 변한다.
 * 푼 장수 k일 때의 속도가 speed + acceleration·k 라서, 한 장을 푸는 데 드는 시간(1/속도)을 남은 장수만큼 더한다: 시간 = ln((speed + a·남은 장수) / speed) / a (시간).
 * 속도는 지금의 SPEED_CLAMP_MIN_FACTOR~SPEED_CLAMP_MAX_FACTOR배 안에서만 변한다고 본다(그 한도에 닿은 뒤로는 한도 속도로 푼다). 속도를 모르면 null.
 */
export const projectStudyMinutes = (remainingPages: number, speed: number | null | undefined, acceleration: number | null | undefined) => {
  if (!(remainingPages > 0)) return 0;
  if (!speed || !Number.isFinite(speed) || speed <= 0) return null;
  const a = acceleration && Number.isFinite(acceleration) ? acceleration : 0;
  if (Math.abs(a) < 1e-9) return (remainingPages / speed) * 60;
  const limit = speed * (a > 0 ? SPEED_CLAMP_MAX_FACTOR : SPEED_CLAMP_MIN_FACTOR);
  const pagesToLimit = (limit - speed) / a;
  if (remainingPages <= pagesToLimit) return (Math.log((speed + a * remainingPages) / speed) / a) * 60;
  return (Math.log(limit / speed) / a + (remainingPages - pagesToLimit) / limit) * 60;
};

export type ForecastKind = 'current' | 'followUp' | 'review';
/**
 * measured: 이 과목의 속도를 쟀다 / inherited: 재지 않아서 현재 과목의 속도와 가속도로 계산 /
 * previous: 막 시작한 현재 과목(후행과목)이라 아직 25분이 안 돼 앞 과목(이전 단계)의 속도로 계산 / initial: 처음에 정해 둔 장당 시간 / none: 알 수 없다
 */
export type ForecastBasis = 'measured' | 'inherited' | 'previous' | 'initial' | 'none';

export interface ForecastItem {
  id: string;
  name: string;
  kind: ForecastKind;
  remainingPages: number;
  speed: number | null;
  /** 페이지당 가속도(P/h per P) */
  acceleration: number | null;
  /** 남은 장수를 다 푸는 데 걸리는 시간(분). 알 수 없으면 null */
  minutes: number | null;
  basis: ForecastBasis;
}

/** 과목(또는 복습과목) 하나의 속도 점들과 효율. 타임어택(문제 푸는 시간) 기준이다. */
export interface SpeedUnit {
  series: SpeedSeries;
  /** 최근 25분의 장당 타임어택 시간(분/P). 재 본 기록이 없으면 null */
  efficiency: number | null;
}

export interface SubjectSpeedAnalysis {
  /** 지금 공부하는 단계(과목 자신 또는 후행과목) id. 모두 끝났으면 null */
  stageId: string | null;
  /** 과목 카드에 보이는 값: 현재 단계와 그 복습과목들의 기록을 합친 속도 점들(타임어택 기준) */
  series: SpeedSeries;
  /** 합친 기록의 최근 25분 장당 타임어택 시간(분/P). 없으면 null */
  efficiency: number | null;
  /** 현재 단계 하나만의 값(전체 과목 목록에서 현재 과목 ›) */
  own: SpeedUnit;
  /** 이 과목의 공부 기록을 기본복습하며 푼 기록만의 값(전체 과목 목록에서 현재 과목 ›) */
  basicReview: SpeedUnit;
  /** 복습과목마다 따로 본 값(복습과목 id → 값). 아직 끝나지 않은 단계에 붙은 복습과목 전부 */
  reviews: Record<string, SpeedUnit>;
  /** 현재 단계 → 그 복습과목 → 이어지는 후행과목 → 그 복습과목 순서 */
  forecast: ForecastItem[];
  totalMinutes: number;
}

/**
 * 공부 기록들을 기본복습하며 푼 기록(복습 번호와 상관없이 시간 순서). 장수와 시간이 모두 있는 것만.
 * 속도 점과 효율은 과목과 같은 방식(25분 덩어리)으로 잰다.
 */
export const getBasicReviewSpeedSamples = (studyLogs: StudyLog[]): SpeedLog[] => studyLogs.flatMap(log => {
  const records = log.basicReviewTimeRecords || [];
  if (records.length > 0) return records.map(record => ({ pagesRead: record.pages, timeSpentMinutes: record.minutes, timestamp: record.timestamp }));
  if ((log.reviewTimeSpentMinutes || 0) > 0 && (log.reviewCompletedPages || 0) > 0) {
    return [{ pagesRead: log.reviewCompletedPages || 0, timeSpentMinutes: log.reviewTimeSpentMinutes || 0, timestamp: log.timestamp }];
  }
  return [];
}).filter(isMeasured);

/**
 * 과목 하나의 속도 증가 분석: 지금 공부하는 단계의 속도 점들과, 그 단계를 다 푸는 데 걸리는 시간 · 연결된 복습과목과 후행과목을 푸는 데 걸리는 시간.
 * 재지 않은 과목(복습과목, 후행과목)은 현재 단계의 속도와 가속도로 예측한다. 재지는 않았어도 처음 장당 시간을 정해 둔 현재 단계는 그 값에서 시작한다.
 * 이미 끝난 단계(이전 과목)의 복습과목도 현재 과목이 끝났다고 멈추지 않는다: 남은 장수가 있는 동안은 예측과 합친 값에 계속 들어간다.
 */
export const analyzeSubjectSpeed = (subjects: Subject[], logs: StudyLog[], subject: Subject): SubjectSpeedAnalysis => {
  const stages = getSubjectStages(subject);
  const current = stages.find(stage => stage.status === 'current');
  const family = current ? getSubjectFamily(subjects, subject.id, current.id) : null;
  const familyLogs = family ? logs.filter(log => isFamilyStudyLog(family, log)) : [];
  // 예측은 전체 시간 기준(필요 시간과 같은 눈금)으로 계산한다. 화면에 보이는 값(속도 증가율 · 가속도 · 효율)은 타임어택 기준이다.
  const series = buildSpeedSeries(familyLogs);
  const toUnit = (samples: SpeedLog[]): SpeedUnit => ({
    series: buildSpeedSeries(samples, { timeAttack: true }),
    efficiency: calculateUnitEfficiency(samples).timeAttackAverageTimePerPage || null
  });
  const initialSpeed = subject.initialAverageTimePerPage && subject.initialAverageTimePerPage > 0
    ? SPEED_REFERENCE_MINUTES / subject.initialAverageTimePerPage : null;
  // 후행과목으로 막 넘어가 그 단계의 25분 덩어리가 아직 없으면, 앞 단계들(같은 과목의 공부 기록)의 속도를 이어 쓴다:
  // 앞 단계를 공부할 때 이 후행과목을 그 속도로 예측하던 것과 같고, 넘어가자마자 "측정 안 됨"으로 돌아가지 않는다.
  const previousSeries = series.latestSpeed === null && current && current.id !== subject.id
    ? buildSpeedSeries(logs.filter(log => log.subjectId === subject.id && !log.reviewParentSubjectId && (log.subjectStageId || subject.id) !== current.id))
    : EMPTY_SERIES;
  const baseSpeed = series.latestSpeed ?? previousSeries.latestSpeed ?? initialSpeed;
  const baseAcceleration = series.pageAcceleration ?? previousSeries.pageAcceleration ?? 0;
  const forecast: ForecastItem[] = [];
  const reviews: Record<string, SpeedUnit> = {};
  /** 지금 하고 있는 복습: 현재 단계의 복습과목 + 끝난 단계에서 아직 남은 복습과목 */
  const workingReviewSamples: SpeedLog[] = [];
  const push = (item: Omit<ForecastItem, 'minutes'>) => forecast.push({
    ...item, minutes: projectStudyMinutes(item.remainingPages, item.speed, item.acceleration)
  });
  // 같은 복습과목이 여러 단계에 붙어 있어도 남은 장수는 하나다: 예측에 한 번만 넣는다
  const forecastReviews = new Set<string>();
  stages.forEach(stage => {
    const finished = stage.status === 'completed';
    if (stage.id === current?.id) {
      push({ id: stage.id, name: stage.name, kind: 'current', remainingPages: stage.remainingPages, speed: baseSpeed, acceleration: baseSpeed ? baseAcceleration : null,
        basis: series.latestSpeed !== null ? 'measured' : previousSeries.latestSpeed !== null ? 'previous' : initialSpeed ? 'initial' : 'none' });
    } else if (!finished) {
      // 후행과목은 현재 단계의 속도를 이어 쓰되, 두 단계의 임시값(한 장당 시간)이 있으면 그 비율로 바꾼다(31일 요청: 현재 단계가 빨라지면 같이 빨라진다).
      // 현재 단계 속도를 모르면 후행과목 임시값 그대로
      const followTemp = getStageInitialMinutesPerPage(subjects, subject, stage.id);
      const currentTemp = current ? getStageInitialMinutesPerPage(subjects, subject, current.id) : 0;
      const ratio = followTemp > 0 && currentTemp > 0 ? currentTemp / followTemp : 1;
      const speed = baseSpeed ? baseSpeed * ratio : followTemp > 0 ? SPEED_REFERENCE_MINUTES / followTemp : null;
      push({ id: stage.id, name: stage.name, kind: 'followUp', remainingPages: stage.remainingPages, speed, acceleration: speed ? (baseSpeed ? baseAcceleration * ratio : 0) : null,
        basis: baseSpeed ? 'inherited' : speed ? 'initial' : 'none' });
    }
    stage.reviewSubjectIds.forEach(reviewId => {
      const review = subjects.find(candidate => candidate.id === reviewId);
      if (!review) return;
      const remainingPages = getSubjectRemainingPageCount(review);
      const samples = getReviewEfficiencySamples(logs, subject.id, reviewId);
      reviews[reviewId] = toUnit(samples);
      // 끝난 단계의 복습과목은 다 끝났으면 더 이어 갈 것이 없다
      if (finished && remainingPages <= 0) return;
      if (forecastReviews.has(reviewId)) return;
      forecastReviews.add(reviewId);
      if (stage.id === current?.id || finished) workingReviewSamples.push(...samples);
      const own = buildSpeedSeries(samples);
      const speed = own.latestSpeed ?? baseSpeed;
      const acceleration = own.pageAcceleration ?? baseAcceleration;
      push({ id: reviewId, name: review.name, kind: 'review', remainingPages, speed, acceleration: speed ? acceleration : null,
        basis: own.latestSpeed !== null ? 'measured' : baseSpeed ? 'inherited' : 'none' });
    });
  });
  // 현재 과목과 복습과목은 서로 다른 책이라 페이지 위치를 한 가로축에 놓을 수 없다(섞으면 그래프가 앞뒤로 뒤죽박죽 된다).
  // 복습과목 기록이 섞이면 페이지 위치를 빼서 "푼 장수의 합"(늘 앞으로만 감)을 가로축으로 쓴다.
  const combined = toUnit(workingReviewSamples.length > 0
    ? [...familyLogs, ...workingReviewSamples].map(sample => ({ ...sample, startPage: undefined, endPage: undefined }))
    : familyLogs);
  return {
    stageId: current?.id ?? null, series: combined.series, efficiency: combined.efficiency, own: toUnit(familyLogs), basicReview: toUnit(getBasicReviewSpeedSamples(familyLogs)), reviews,
    forecast, totalMinutes: forecast.reduce((sum, item) => sum + (item.minutes ?? 0), 0)
  };
};

export interface FolderSpeedSummary {
  /** 최근 속도 증가율이 있는 과목 수 */
  measured: number;
  /** 과목들의 속도 증가율(최근 값) 합계 (P/h) */
  total: number;
  /** 그 값들의 편차(표준편차, P/h). 과목들이 고르게 늘고 있으면 작고, 한쪽만 늘면 크다 */
  spread: number;
}

export const summarizeFolderSpeed = (latestGrowths: Array<number | null | undefined>): FolderSpeedSummary => {
  const values = latestGrowths.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (values.length === 0) return { measured: 0, total: 0, spread: 0 };
  const total = values.reduce((sum, value) => sum + value, 0);
  const mean = total / values.length;
  return { measured: values.length, total, spread: Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) };
};

/* ───────────── 공부량 증가: 속도 증가율과 같은 변화를 "한 장에 쓴 시간(분)"으로 본 값 ───────────── */

/** 속도(P/h) → 한 장당 시간(분/P). 속도를 모르면 null */
const minutesPerPageAt = (speed: number) => (Number.isFinite(speed) && speed > 0 ? SPEED_REFERENCE_MINUTES / speed : null);

/**
 * 점마다의 공부량 증가(분/P): 바로 앞 덩어리보다 한 장당 시간이 달라진 값. 속도 증가율과 같은 두 덩어리로 재서 부호만 반대다
 * (빨라지면 속도 +, 공부량 −). 첫 점이거나 속도를 모르면 null.
 */
export const amountGrowthOfPoints = (points: SpeedPoint[]): Array<number | null> => points.map((point, index) => {
  if (index === 0) return null;
  const before = minutesPerPageAt(points[index - 1].speed);
  const now = minutesPerPageAt(point.speed);
  return before !== null && now !== null ? now - before : null;
});

/** 공부량 증가(최근 값): 가장 최근 덩어리 − 그 앞 덩어리의 한 장당 시간(분/P). 덩어리가 둘 미만이면 null */
export const latestAmountGrowthOf = (series: Pick<SpeedSeries, 'points'>): number | null => {
  const values = amountGrowthOfPoints(series.points);
  return values.length > 0 ? values[values.length - 1] : null;
};

/** 값이 있는 것만 더한다. 하나도 없으면 null */
export const sumOf = (values: Array<number | null | undefined>): number | null => {
  const present = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : null;
};

export interface GroupSpeedPoint {
  /** 이 묶음이 지금까지 공부한 시간(시간). 25분마다 하나씩 쌓인다 */
  hours: number;
  /** 이 25분이 끝난 페이지 위치. 묶음 안 기록이 같은 책의 페이지일 때만 있고(과목 하나, 또는 sharedPages), 여러 과목이 섞였거나 위치를 모르면 null */
  page: number | null;
  /** 묶음 안 과목들이 지금까지 푼 장수의 합(위치를 못 쓸 때 가로축) */
  pagesDone: number;
  /** 묶음 안 과목들이 각자 첫 25분보다 늘어난 속도(P/h)의 합 */
  gain: number;
  timestamp: string;
}

export interface GroupSpeed {
  id: string;
  name: string;
  isFolder: boolean;
  /** 폴더·과목마다 하나의 선: 페이지 위치(가로)에 따른 속도 증가(세로). 위치를 쓸 수 없으면 푼 장수의 합이 가로 */
  points: GroupSpeedPoint[];
  /** 속도 증가율(최근 값). 폴더면 안에 든 과목들의 최근 값을 더한 것. 잰 과목이 없으면 null */
  latestGrowth: number | null;
  /** 속도를 잰 과목 수 */
  measured: number;
  /** 공부량 증가(최근 값, 분/P). 속도 증가율과 같은 두 덩어리로 잰 한 장당 시간의 변화. 폴더면 안에 든 과목들의 값을 더한 것. 없으면 null */
  latestAmountGrowth: number | null;
}

/**
 * 폴더(또는 과목) 하나의 "공부 시간에 따른 속도 증가". 안에 든 과목들의 25분들을 시간 순서로 한 줄로 이어,
 * 25분이 끝날 때마다 (과목별로 지금까지 늘어난 속도)를 모두 더한 값을 점으로 찍는다. 과목 하나면 그 과목의 그래프와 같다.
 */
export const buildGroupSpeed = (head: { id: string; name: string; isFolder: boolean }, memberSeries: SpeedSeries[], options: { sharedPages?: boolean } = {}): GroupSpeed => {
  // 과목 하나(또는 같은 책의 기록들)만 점이 있으면 페이지 위치를 그대로 쓰고, 여러 과목이 섞이면 위치가 서로 다른 책의 것이라 쓰지 않는다.
  const sharedPages = options.sharedPages ?? memberSeries.filter(series => series.points.length > 0).length <= 1;
  const events = memberSeries.flatMap((series, member) => series.points.map(point => ({ member, point })))
    .sort((a, b) => Date.parse(a.point.timestamp) - Date.parse(b.point.timestamp) || a.member - b.member || a.point.index - b.point.index);
  const current = memberSeries.map(() => 0);
  const done = memberSeries.map(() => 0);
  const points: GroupSpeedPoint[] = events.map(({ member, point }, index) => {
    current[member] = point.gain;
    done[member] = point.pagesDone ?? 0;
    return {
      hours: ((index + 1) * EFFICIENCY_WINDOW_MINUTES) / 60, gain: current.reduce((sum, value) => sum + value, 0), timestamp: point.timestamp,
      page: sharedPages ? point.page ?? null : null, pagesDone: done.reduce((sum, value) => sum + value, 0)
    };
  });
  const growths = memberSeries.map(series => series.latestGrowth).filter((value): value is number => value !== null);
  return {
    ...head, points,
    latestGrowth: growths.length > 0 ? growths.reduce((sum, value) => sum + value, 0) : null,
    measured: growths.length,
    latestAmountGrowth: sumOf(memberSeries.map(latestAmountGrowthOf))
  };
};

/* ───────────── 하루 · 일주일 · 전체 단위로 본 속도 증가 ───────────── */

export type PlanUnit = 'day' | 'week' | 'all';

/** 날짜가 속한 주(월~일)의 월요일 날짜 */
const getWeekStartKey = (dateKey: string) => {
  const date = parseStudyDate(dateKey);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return getLocalDateKey(date);
};

/**
 * 속도 점들이 단위 하나 동안 늘린 속도(P/h)의 평균.
 *  - day: 공부한 날마다 늘어난 속도(그날 끝난 덩어리들의 증가를 더한 값)의 평균. weekday를 주면 그 요일에 공부한 날만 본다.
 *  - week: 공부한 주(월~일)마다 늘어난 속도의 평균.
 *  - all: 처음부터 지금까지 늘어난 속도(첫 덩어리 대비 지금).
 * 덩어리가 둘 미만이거나 그 단위에 해당하는 날이 없으면 null.
 */
const unitValueOf = (points: SpeedPoint[], values: Array<number | null>, unit: PlanUnit, weekday: number | null): number | null => {
  const grown = points.map((point, index) => ({ point, value: values[index] })).filter((item): item is { point: SpeedPoint; value: number } => item.value !== null);
  if (grown.length === 0) return null;
  if (unit === 'all') return grown.reduce((sum, item) => sum + item.value, 0);
  const buckets = new Map<string, number>();
  grown.forEach(({ point, value }) => {
    if (unit === 'day' && weekday !== null && parseStudyDate(point.dateKey).getDay() !== weekday) return;
    const key = unit === 'day' ? point.dateKey : getWeekStartKey(point.dateKey);
    buckets.set(key, (buckets.get(key) || 0) + value);
  });
  if (buckets.size === 0) return null;
  return Array.from(buckets.values()).reduce((sum, value) => sum + value, 0) / buckets.size;
};

export const unitGrowthOf = (series: SpeedSeries, unit: PlanUnit, weekday: number | null = null): number | null => (
  unitValueOf(series.points, series.points.map(point => point.growth), unit, weekday)
);

/** 단위로 본 공부량 증가(분/P). 속도 증가율(unitGrowthOf)과 같은 날 · 주 묶음으로 센다: 하루/일주일은 묶음별 합의 평균, 전체는 첫 덩어리 대비 지금. */
export const unitAmountGrowthOf = (series: Pick<SpeedSeries, 'points'>, unit: PlanUnit, weekday: number | null = null): number | null => (
  unitValueOf(series.points, amountGrowthOfPoints(series.points), unit, weekday)
);

/** 과목들의 단위당 공부량 증가 평균(분/P). 값이 있는 과목만 센다(summarizeUnitGrowth의 mean과 같은 방식). 하나도 없으면 null */
export const summarizeUnitAmount = (seriesList: Array<Pick<SpeedSeries, 'points'>>, unit: PlanUnit, weekday: number | null = null): number | null => {
  const values = seriesList.map(series => unitAmountGrowthOf(series, unit, weekday)).filter((value): value is number => value !== null);
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
};

export interface UnitGrowthSummary {
  /** 값이 있는 과목 수 */
  measured: number;
  /** 과목들의 단위당 속도 증가 평균 (P/h) */
  mean: number;
  /** 그 값들의 표준편차 (P/h) */
  spread: number;
}

/** 과목들의 속도 점으로 본 단위당 평균 속도 증가율과 그 표준편차 */
export const summarizeUnitGrowth = (seriesList: SpeedSeries[], unit: PlanUnit, weekday: number | null = null): UnitGrowthSummary => {
  const summary = summarizeFolderSpeed(seriesList.map(series => unitGrowthOf(series, unit, weekday)));
  return { measured: summary.measured, mean: summary.measured > 0 ? summary.total / summary.measured : 0, spread: summary.spread };
};

/** "+1.2P/h" 같은 글자. 값이 없으면 "측정 필요" */
export const describeSpeedGrowth = (value: number | null | undefined, label = 'P') => (
  typeof value === 'number' && Number.isFinite(value) ? `${formatSignedTenth(value)}${label}/h` : '측정 필요'
);

/** 페이지당 가속도 숫자: 값이 작아서 소수 둘째 자리까지 쓴다("+0.10"). */
export const formatSignedHundredth = (value: number) => {
  const rounded = Math.round(Math.abs(value) * 100) / 100;
  return rounded === 0 ? '0.00' : `${value < 0 ? '−' : '+'}${rounded.toFixed(2)}`;
};

/** 페이지당 가속도 글자: 1P를 풀 때마다 늘어나는 속도라 단위는 P/h per P. 값이 없으면 "측정 필요" */
export const describePageAcceleration = (value: number | null | undefined, label = 'P') => (
  typeof value === 'number' && Number.isFinite(value) ? `${formatSignedHundredth(value)}${label}/h/${label}` : '측정 필요'
);

/** "−0.4분/P" 같은 글자(공부량 증가: 한 페이지에 쓴 시간의 변화). 값이 없으면 "측정 필요" */
export const describeStudyAmountGrowth = (value: number | null | undefined, label = 'P') => (
  typeof value === 'number' && Number.isFinite(value) ? `${formatSignedTenth(value)}분/${label}` : '측정 필요'
);

/** 학습시간 가속도 글자(추이 분석): 속도(P/h)가 공부 1시간마다 늘어나는 양이라 단위는 P/h² 다. 값이 없으면 "측정 필요" */
export const describeAcceleration = (value: number | null | undefined, label = 'P') => (
  typeof value === 'number' && Number.isFinite(value) ? `${formatSignedTenth(value)}${label}/h²` : '측정 필요'
);
