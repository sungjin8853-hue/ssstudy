import { StudyLog, Stats, Subject } from '../types';
import { getRepeatedReviewRange } from './review';
import { calculateUnitEfficiency, getGrowthDelta, GrowthChange, GrowthDelta, pagesPerReferenceTime, roundGrowthDelta } from './pageGrowth';
import { getLocalDateKey } from './schedule';

const isSubjectReviewSource = (log: StudyLog, parentSubjectId: string) => (
  log.subjectId === parentSubjectId || (log.isRepeatReview && log.reviewParentSubjectId === parentSubjectId)
);

interface TimedPageSample {
  pagesRead: number;
  timeSpentMinutes: number;
  timestamp: string;
  timeAttackMinutes?: number;
  startPage?: number;
  endPage?: number;
}

export const calculateRecentTimedPageAverage = (
  samples: TimedPageSample[]
): { averageTimePerPage: number; standardDeviation: number } => {
  const result = calculateUnitEfficiency(samples);
  return { averageTimePerPage: result.averageTimePerPage, standardDeviation: result.standardDeviation };
};

export const calculateRecentCompletedDayAverage = (
  logs: StudyLog[],
  _dailyTargetPages: number
): { averageTimePerPage: number; standardDeviation: number } => {
  return calculateRecentTimedPageAverage(logs);
};

export const calculateTimeAttackAverage = (logs: StudyLog[]) => (
  calculateUnitEfficiency(logs).timeAttackAverageTimePerPage
);

export interface BasicReviewEfficiencyPoint {
  reviewNumber: number;
  averageTimePerPage: number;
  totalMinutes: number;
  totalPages: number;
  sampleCount: number;
}

export const calculateBasicReviewEfficiencyByNumber = (
  logs: StudyLog[],
  parentSubjectId: string
): BasicReviewEfficiencyPoint[] => {
  const samples = logs
    .filter(log => log.subjectId === parentSubjectId)
    .flatMap(log => {
      if (log.basicReviewTimeRecords?.length) {
        return log.basicReviewTimeRecords.map((record, index) => ({
          reviewNumber: Math.max(1, Math.round(record.reviewNumber ?? index + 1)),
          pages: record.pages,
          minutes: record.minutes
        }));
      }

      if ((log.reviewTimeSpentMinutes || 0) > 0 && (log.reviewCompletedPages || 0) > 0) {
        return [{
          reviewNumber: Math.max(1, Math.round(log.reviewStep || 1)),
          pages: log.reviewCompletedPages || 0,
          minutes: log.reviewTimeSpentMinutes || 0
        }];
      }

      return [];
    })
    .filter(sample => sample.pages > 0 && sample.minutes > 0);

  const grouped = new Map<number, {
    totalMinutes: number;
    totalPages: number;
    sampleCount: number;
  }>();

  samples.forEach(sample => {
    const current = grouped.get(sample.reviewNumber) || {
      totalMinutes: 0,
      totalPages: 0,
      sampleCount: 0
    };
    current.totalMinutes += sample.minutes;
    current.totalPages += sample.pages;
    current.sampleCount += 1;
    grouped.set(sample.reviewNumber, current);
  });

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .map(([reviewNumber, value]) => ({
      reviewNumber,
      averageTimePerPage: value.totalPages > 0 ? value.totalMinutes / value.totalPages : 0,
      totalMinutes: value.totalMinutes,
      totalPages: value.totalPages,
      sampleCount: value.sampleCount
    }));
};

export const calculateBasicReviewAverageTimePerPage = (
  logs: StudyLog[],
  parentSubjectId: string,
  reviewNumber?: number
) => {
  const points = calculateBasicReviewEfficiencyByNumber(logs, parentSubjectId);

  if (reviewNumber !== undefined) {
    return points.find(point => point.reviewNumber === reviewNumber)?.averageTimePerPage || 0;
  }

  const totalMinutes = points.reduce((sum, point) => sum + point.totalMinutes, 0);
  const totalPages = points.reduce((sum, point) => sum + point.totalPages, 0);

  return totalPages > 0 ? totalMinutes / totalPages : 0;
};

export const calculateSubjectReviewAverageTimePerPage = (
  logs: StudyLog[],
  parentSubjectId: string,
  reviewSubjectId: string
) => {
  return calculateRecentTimedPageAverage(getReviewEfficiencySamples(logs, parentSubjectId, reviewSubjectId)).averageTimePerPage;
};

export const getReviewEfficiencySamples = (logs: StudyLog[], parentSubjectId: string, subjectId: string): TimedPageSample[] => {
  const ownLogs = logs.filter(log => log.subjectId === subjectId && log.reviewParentSubjectId === parentSubjectId);
  const ownIds = new Set(ownLogs.map(log => log.id));
  const records = logs.filter(log => isSubjectReviewSource(log, parentSubjectId))
    .flatMap(log => (log.reviewSubjectTimeRecords || []).filter(record => record.subjectId === subjectId
      && record.completed !== false && Boolean(record.measurementId)));
  const skipOwnIds = new Set<string>();
  const legacy = new Map<string, TimedPageSample>();
  records.forEach(record => {
    const ids = record.includedMeasurementIds || [record.measurementId!];
    if (ids.every(id => ownIds.has(id))) return;
    ids.forEach(id => skipOwnIds.add(id));
    const sample = legacy.get(record.measurementId!) || { pagesRead: 0, timeSpentMinutes: 0, timeAttackMinutes: 0, timestamp: record.timestamp };
    sample.pagesRead += record.pages;
    sample.timeSpentMinutes += record.minutes;
    sample.timeAttackMinutes! += record.timeAttackMinutes ?? record.minutes;
    // 기록에 남은 마지막 끝 페이지로 대략의 페이지 범위를 만든다(페이지 단위로 효율을 나눌 때 쓴다).
    if (record.lastEndPage !== undefined) {
      sample.endPage = Math.max(sample.endPage ?? 0, record.lastEndPage);
      sample.startPage = sample.endPage - Math.max(1, Math.ceil(sample.pagesRead)) + 1;
    }
    legacy.set(record.measurementId!, sample);
  });
  return [...ownLogs.filter(log => !skipOwnIds.has(log.id)), ...legacy.values()];
};

export const resolveBasicReviewAverageTimePerPage = (
  logs: StudyLog[],
  parentSubjectId: string,
  subjects: Subject[] = [],
  reviewNumber?: number
) => {
  const basicReviewAverage = calculateBasicReviewAverageTimePerPage(
    logs,
    parentSubjectId,
    reviewNumber
  );
  if (basicReviewAverage > 0) return basicReviewAverage;

  const parentSubject = subjects.find(subject => subject.id === parentSubjectId);
  const lastReviewSubject = [...(parentSubject?.reviewSubjectIds || [])]
    .reverse()
    .map(subjectId => subjects.find(subject => subject.id === subjectId))
    .find((subject): subject is Subject => Boolean(subject));
  const fallbackSubjects = [lastReviewSubject, parentSubject]
    .filter((subject, index, items): subject is Subject => (
      Boolean(subject) && items.findIndex(item => item?.id === subject?.id) === index
    ));

  for (const fallbackSubject of fallbackSubjects) {
    const measuredAverage = calculateRecentCompletedDayAverage(
      logs.filter(log => log.subjectId === fallbackSubject.id),
      0
    ).averageTimePerPage;
    const studyAverage = measuredAverage || fallbackSubject.initialAverageTimePerPage || 0;
    // 기본 복습 시간의 임시값: 공부 시간의 1/4(31일 요청, 전에는 1/2)
    if (studyAverage > 0) return studyAverage / 4;
  }

  return 0;
};

export const calculateBasicReviewGroupTiming = (
  logs: StudyLog[],
  parentSubjectId: string,
  subjects: Subject[],
  reviewLogs: StudyLog[]
) => {
  const totalPages = reviewLogs.reduce((sum, log) => sum + Math.max(0, log.pagesRead), 0);
  const estimatedMinutes = reviewLogs.reduce((sum, log) => {
    const reviewNumber = (log.reviewStep || 0) + 1;
    const average = resolveBasicReviewAverageTimePerPage(
      logs,
      parentSubjectId,
      subjects,
      reviewNumber
    );
    return sum + Math.max(0, log.pagesRead) * average;
  }, 0);

  return {
    averageTimePerPage: totalPages > 0 ? estimatedMinutes / totalPages : 0,
    estimatedMinutes
  };
};

export const resolveSubjectReviewAverageTimePerPage = (
  logs: StudyLog[],
  parentSubjectId: string,
  reviewSubjectId: string,
  subjects: Subject[] = [],
  reviewLogs?: StudyLog[],
  reviewSubjectIds?: string[]
) => {
  return calculateReviewSubjectTiming(logs, parentSubjectId, reviewSubjectId, subjects, reviewLogs, reviewSubjectIds).averageTimePerPage;
};

export const calculateReviewTimeChangeAverage = (
  logs: StudyLog[], parentSubjectId: string, subjectId: string, reviewNumber?: number, timeAttack = false
) => {
  const measurements = new Map<string, { minutes: number; baselineMinutes: number }>();
  logs.filter(log => isSubjectReviewSource(log, parentSubjectId)).forEach(log => {
    (log.reviewSubjectTimeRecords || []).forEach((record, index) => {
      const baseline = timeAttack ? record.baselineTimeAttackPerPage ?? record.baselineTimePerPage : record.baselineTimePerPage;
      const minutes = timeAttack ? record.timeAttackMinutes ?? record.minutes : record.minutes;
      if (record.subjectId !== subjectId || record.completed === false || record.pages <= 0
        || !(baseline! > 0) || !(minutes > 0)
        || (reviewNumber !== undefined && record.reviewNumber !== reviewNumber)) return;
      const key = record.measurementId || `${log.id}:${index}`;
      const value = measurements.get(key) || { minutes: 0, baselineMinutes: 0 };
      value.minutes += minutes;
      value.baselineMinutes += record.pages * baseline!;
      measurements.set(key, value);
    });
  });
  const changes = [...measurements.values()].map(value => (value.minutes / value.baselineMinutes - 1) * 100);
  return changes.length > 0 ? changes.reduce((sum, value) => sum + value, 0) / changes.length : null;
};

export const calculateReviewSpeedChanges = (logs: StudyLog[], parentSubjectId: string, subjectId: string, measurementDate?: string) => {
  const measurements = new Map<string, { minutes: number; baselineMinutes: number; hasBaseline: boolean; timestamp: string }>();
  logs.filter(log => isSubjectReviewSource(log, parentSubjectId)).forEach(log => {
    (log.reviewSubjectTimeRecords || []).forEach(record => {
      if (record.subjectId !== subjectId || !record.completed || !record.measurementId || record.pages <= 0) return;
      const value = measurements.get(record.measurementId)
        || { minutes: 0, baselineMinutes: 0, hasBaseline: true, timestamp: record.timestamp };
      value.minutes += record.minutes;
      value.baselineMinutes += record.pages * (record.baselineTimePerPage || 0);
      value.hasBaseline &&= (record.baselineTimePerPage || 0) > 0;
      if (record.timestamp > value.timestamp) value.timestamp = record.timestamp;
      measurements.set(record.measurementId, value);
    });
  });
  const values = [...measurements.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .map(value => ({
      timestamp: value.timestamp,
      percent: value.hasBaseline && value.minutes > 0 ? (value.baselineMinutes / value.minutes - 1) * 100 : null
    }));
  const measured = values.filter(value => value.percent !== null);
  const latest = measurementDate ? values.find(value => getLocalDateKey(new Date(value.timestamp)) === measurementDate) : values[0];
  return {
    average: measured.length > 0 ? measured.reduce((sum, value) => sum + value.percent!, 0) / measured.length : null,
    latest: latest?.percent ?? null
  };
};

/**
 * 복습과목의 측정 회차별 속도(기준 시간에 푸는 장수). 증가율 칸과 같은 측정(measurementId)을 시간순으로 한 점씩 돌려준다.
 * baseline은 그 측정의 기준(이전·상위과목) 장당 시간으로 계산한 같은 값이고, 기준이 없으면 null.
 */
export const getReviewSpeedSeries = (logs: StudyLog[], parentSubjectId: string, subjectId: string) => {
  const measurements = new Map<string, { minutes: number; baselineMinutes: number; pages: number; hasBaseline: boolean; timestamp: string }>();
  logs.filter(log => isSubjectReviewSource(log, parentSubjectId)).forEach(log => {
    (log.reviewSubjectTimeRecords || []).forEach(record => {
      if (record.subjectId !== subjectId || !record.completed || !record.measurementId || record.pages <= 0) return;
      const value = measurements.get(record.measurementId)
        || { minutes: 0, baselineMinutes: 0, pages: 0, hasBaseline: true, timestamp: record.timestamp };
      value.minutes += record.minutes;
      value.pages += record.pages;
      value.baselineMinutes += record.pages * (record.baselineTimePerPage || 0);
      value.hasBaseline &&= (record.baselineTimePerPage || 0) > 0;
      if (record.timestamp > value.timestamp) value.timestamp = record.timestamp;
      measurements.set(record.measurementId, value);
    });
  });
  return [...measurements.values()].filter(value => value.minutes > 0)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map(value => ({
      timestamp: value.timestamp,
      pages: value.pages,
      minutes: value.minutes,
      pagesPerReference: pagesPerReferenceTime(value.minutes / value.pages),
      baselinePagesPerReference: value.hasBaseline && value.baselineMinutes > 0 ? pagesPerReferenceTime(value.baselineMinutes / value.pages) : null,
      minutesPerPage: value.minutes / value.pages,
      baselineMinutesPerPage: value.hasBaseline && value.baselineMinutes > 0 ? value.baselineMinutes / value.pages : null
    }));
};

/**
 * 복습과목의 "평균 · 이번 복습" 변화를 사람이 읽는 두 정수로 돌려준다(퍼센트 아님).
 * 속도 = 1시간에 푸는 장수의 차이, 공부량 = 한 페이지에 쓴 시간(분)의 차이. 측정마다 구한 값의 평균을 소수 첫째 자리로 반올림한다.
 * 기준(이전 복습·상위과목)이 없는 측정은 평균에서 빠진다. latest는 measurementDate의 가장 최근 측정(없으면 전체 중 가장 최근).
 */
export const calculateReviewChangeAmounts = (
  logs: StudyLog[], parentSubjectId: string, subjectId: string, measurementDate?: string
): { average: GrowthChange | null; latest: GrowthChange | null } => {
  const points = getReviewSpeedSeries(logs, parentSubjectId, subjectId).map(point => ({
    timestamp: point.timestamp,
    delta: getGrowthDelta(point.baselineMinutesPerPage, point.minutesPerPage)
  })).reverse();
  const measured = points.map(point => point.delta).filter((delta): delta is GrowthDelta => delta !== null);
  const latest = measurementDate ? points.find(point => getLocalDateKey(new Date(point.timestamp)) === measurementDate) : points[0];
  const mean = (pick: (delta: GrowthDelta) => number) => measured.reduce((sum, delta) => sum + pick(delta), 0) / measured.length;
  return {
    average: measured.length > 0 ? roundGrowthDelta({ speedPages: mean(delta => delta.speedPages), studyMinutes: mean(delta => delta.studyMinutes) }) : null,
    latest: roundGrowthDelta(latest?.delta)
  };
};

export const calculateReviewSubjectTiming = (
  logs: StudyLog[], parentSubjectId: string, subjectId: string, subjects: Subject[] = [],
  reviewLogs = logs.filter(log => log.subjectId === parentSubjectId), reviewSubjectIds?: string[], timeAttack = false
) => {
  let pages = 0;
  let baselineMinutes = 0;
  let estimatedMinutes = 0;
  let pendingPages = 0;
  let known = true;
  const changes = new Map<string, number>();
  const rateFor = (id: string) => {
    const samples = id === parentSubjectId ? logs.filter(log => log.subjectId === id)
      : getReviewEfficiencySamples(logs, parentSubjectId, id);
    const efficiency = calculateUnitEfficiency(samples);
    return timeAttack ? efficiency.timeAttackAverageTimePerPage : efficiency.averageTimePerPage;
  };
  const parentRate = rateFor(parentSubjectId);
  const getChange = (id: string, round: number) => {
    const key = `${id}:${round}`;
    if (!changes.has(key)) changes.set(key, calculateReviewTimeChangeAverage(logs, parentSubjectId, id, round, timeAttack) || 0);
    return changes.get(key)!;
  };
  for (const log of reviewLogs) {
    const sequence = log.reviewSubjectIdsSnapshot?.length ? log.reviewSubjectIdsSnapshot
      : subjects.find(subject => subject.id === parentSubjectId)?.reviewSubjectIds || reviewSubjectIds || [];
    const index = sequence.indexOf(subjectId);
    const reviewNumber = (log.reviewStep || 0) + 1;
    let incomingPages = Math.max(0, log.pagesRead);
    let incomingMinutes = Math.max(0, timeAttack ? log.timeAttackMinutes ?? log.timeSpentMinutes : log.timeSpentMinutes);
    if (!log.isRepeatReview && parentRate > 0) incomingMinutes = incomingPages * parentRate;
    const repeatedSubject = log.isRepeatReview ? subjects.find(subject => subject.id === log.subjectId) : undefined;
    if (repeatedSubject && incomingPages > 0) {
      const repeatedPages = Math.min(incomingPages, getRepeatedReviewRange(log, repeatedSubject).initialRemainingPages);
      incomingMinutes *= repeatedPages / incomingPages;
      incomingPages = repeatedPages;
    }
    // Each stage inherits the preceding completed measurement, not another book's average.
    for (const precedingId of sequence.slice(0, Math.max(0, index))) {
      const records = (log.reviewSubjectTimeRecords || []).filter(record => (
        record.subjectId === precedingId && record.completed !== false && record.reviewNumber === reviewNumber && Boolean(record.measurementId)
      ));
      if (records.length > 0) {
        incomingPages = records.reduce((sum, record) => sum + Math.max(0, record.pages), 0);
        incomingMinutes = records.reduce((sum, record) => sum + Math.max(0, timeAttack ? record.timeAttackMinutes ?? record.minutes : record.minutes), 0);
        const precedingRate = rateFor(precedingId);
        if (precedingRate > 0) incomingMinutes = incomingPages * precedingRate;
      } else {
        const change = getChange(precedingId, reviewNumber);
        incomingMinutes *= 1 + change / 100;
      }
    }
    const change = getChange(subjectId, reviewNumber);
    pages += incomingPages;
    baselineMinutes += incomingMinutes;
    estimatedMinutes += incomingMinutes * (1 + change / 100);
    if (incomingPages > 0 && incomingMinutes <= 0) known = false;
    pendingPages += (log.reviewSubjectTimeRecords || []).filter(record => (
      record.subjectId === subjectId && record.completed === false && record.reviewNumber === reviewNumber
    )).reduce((sum, record) => sum + Math.max(0, record.pages), 0);
  }
  const ownEfficiency = calculateUnitEfficiency(getReviewEfficiencySamples(logs, parentSubjectId, subjectId));
  const measuredRate = timeAttack ? ownEfficiency.timeAttackAverageTimePerPage : ownEfficiency.averageTimePerPage;
  const averageTimePerPage = ownEfficiency.basis ? measuredRate : known && pages > 0 ? estimatedMinutes / pages : 0;
  const remainingPages = Math.max(0, pages - pendingPages);
  return {
    pages, remainingPages,
    baselineTimePerPage: known && pages > 0 ? baselineMinutes / pages : 0,
    averageTimePerPage,
    estimatedMinutes: remainingPages * averageTimePerPage,
    averageChangePercent: baselineMinutes > 0 ? (averageTimePerPage * pages / baselineMinutes - 1) * 100 : null
  };
};

export const calculateStats = (
  logs: StudyLog[],
  remainingPages: number,
  dailyTargetPages = 0,
  fallbackAverageTimePerPage = 0
): Stats => {
  const validLogs = logs.filter(log => log.pagesRead > 0 && log.timeSpentMinutes > 0);

  if (validLogs.length === 0) {
    const fallbackAverage = Math.max(0, fallbackAverageTimePerPage);
    return {
      averageTimePerPage: fallbackAverage,
      standardDeviation: 0,
      totalTimeSpent: 0,
      estimatedRemainingTime: fallbackAverage * remainingPages
    };
  }

  const totalTime = validLogs.reduce((acc, log) => acc + log.timeSpentMinutes, 0);
  const recentAverage = calculateRecentCompletedDayAverage(validLogs, dailyTargetPages);

  return {
    averageTimePerPage: recentAverage.averageTimePerPage,
    standardDeviation: recentAverage.standardDeviation,
    totalTimeSpent: totalTime,
    estimatedRemainingTime: recentAverage.averageTimePerPage * remainingPages
  };
};
