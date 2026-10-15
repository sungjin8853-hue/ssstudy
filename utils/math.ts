import { StudyLog, PredictionInputs, Stats, Subject } from '../types';
import { getRepeatedReviewRange } from './review';
import { calculateUnitEfficiency } from './pageGrowth';
import { getLocalDateKey } from './schedule';

const isSubjectReviewSource = (log: StudyLog, parentSubjectId: string) => (
  log.subjectId === parentSubjectId || (log.isRepeatReview && log.reviewParentSubjectId === parentSubjectId)
);

interface TimedPageSample {
  pagesRead: number;
  timeSpentMinutes: number;
  timestamp: string;
  timeAttackMinutes?: number;
}

export const calculateRecentTimedPageAverage = (
  samples: TimedPageSample[], pageUnit?: number
): { averageTimePerPage: number; standardDeviation: number } => {
  const result = calculateUnitEfficiency(samples, pageUnit);
  return { averageTimePerPage: result.averageTimePerPage, standardDeviation: result.standardDeviation };
};

export const calculateRecentCompletedDayAverage = (
  logs: StudyLog[],
  _dailyTargetPages: number, pageUnit?: number
): { averageTimePerPage: number; standardDeviation: number } => {
  return calculateRecentTimedPageAverage(logs, pageUnit);
};

export const calculateTimeAttackAverage = (logs: StudyLog[], pageUnit?: number) => (
  calculateUnitEfficiency(logs, pageUnit).timeAttackAverageTimePerPage
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
  reviewSubjectId: string, pageUnit?: number
) => {
  return calculateRecentTimedPageAverage(getReviewEfficiencySamples(logs, parentSubjectId, reviewSubjectId), pageUnit).averageTimePerPage;
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
      0, fallbackSubject.growthPageUnit
    ).averageTimePerPage;
    const studyAverage = measuredAverage || fallbackSubject.initialAverageTimePerPage || 0;
    if (studyAverage > 0) return studyAverage / 2;
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
    const subject = subjects.find(item => item.id === id);
    const samples = id === parentSubjectId ? logs.filter(log => log.subjectId === id)
      : getReviewEfficiencySamples(logs, parentSubjectId, id);
    const efficiency = calculateUnitEfficiency(samples, subject?.growthPageUnit);
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
  const ownEfficiency = calculateUnitEfficiency(getReviewEfficiencySamples(logs, parentSubjectId, subjectId),
    subjects.find(subject => subject.id === subjectId)?.growthPageUnit);
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
  fallbackAverageTimePerPage = 0, pageUnit?: number
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
  const recentAverage = calculateRecentCompletedDayAverage(validLogs, dailyTargetPages, pageUnit);

  return {
    averageTimePerPage: recentAverage.averageTimePerPage,
    standardDeviation: recentAverage.standardDeviation,
    totalTimeSpent: totalTime,
    estimatedRemainingTime: recentAverage.averageTimePerPage * remainingPages
  };
};

export const calculateRequiredReviewCount = (tTest: number, tRec: number): number => {
  if (tRec === 0) return 0;

  const ratio = tTest / tRec;

  if (ratio <= 1.0) return 0;
  if (ratio <= 1.2) return 1;
  if (ratio <= 1.5) return 2;
  return 3;
};

export const calculateMentalBurden = (
  h1: number,
  h2: number,
  b: number,
  tStudy: number,
  tTest: number,
  tRec: number
): { total: number, init: number, length: number } => {
  const burdenFromVolume = b * 0.05;
  const burdenFromTime = tStudy * 0.5;
  const burdenFromIntensity = (tTest / (tRec || 1)) * 2;

  const total = burdenFromVolume + burdenFromTime + burdenFromIntensity;

  return {
    total,
    init: total * 0.3,
    length: total * 0.7
  };
};

export const calculateStudyBurdenV2 = (inputs: PredictionInputs): { total: number } => {
  const efficiencyFactor = inputs.tStudy > 0 && inputs.b > 0
    ? inputs.b / inputs.tStudy
    : 10;

  const targetBoost = inputs.h3;
  const basePagesPerPoint = 30;
  const predictedTotalPages = (targetBoost * basePagesPerPoint) * (10 / (efficiencyFactor || 10));

  return {
    total: parseFloat(predictedTotalPages.toFixed(1))
  };
};
