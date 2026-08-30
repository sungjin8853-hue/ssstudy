import { StudyLog, PredictionInputs, Stats, Subject } from '../types';

const RECENT_STUDY_MINUTES_LIMIT = 15 * 60;

interface TimedPageSample {
  pagesRead: number;
  timeSpentMinutes: number;
  timestamp: string;
}

const takeRecentStudyMinutes = (logs: TimedPageSample[]) => {
  let remainingMinutes = RECENT_STUDY_MINUTES_LIMIT;
  const samples: Array<{ pagesRead: number; timeSpentMinutes: number; timestamp: string }> = [];

  logs
    .filter(log => log.pagesRead > 0 && log.timeSpentMinutes > 0)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .some(log => {
      if (remainingMinutes <= 0) return true;

      const minutes = Math.min(log.timeSpentMinutes, remainingMinutes);
      const ratio = minutes / log.timeSpentMinutes;
      samples.push({
        pagesRead: log.pagesRead * ratio,
        timeSpentMinutes: minutes,
        timestamp: log.timestamp
      });
      remainingMinutes -= minutes;

      return remainingMinutes <= 0;
    });

  return samples;
};

export const calculateRecentTimedPageAverage = (
  samples: TimedPageSample[]
): { averageTimePerPage: number; standardDeviation: number } => {
  const recentSamples = takeRecentStudyMinutes(samples);

  if (recentSamples.length === 0) {
    return { averageTimePerPage: 0, standardDeviation: 0 };
  }

  const totalTime = recentSamples.reduce((acc, sample) => acc + sample.timeSpentMinutes, 0);
  const totalPages = recentSamples.reduce((acc, sample) => acc + sample.pagesRead, 0);
  const averageTimePerPage = totalPages > 0 ? totalTime / totalPages : 0;
  const timePerPageSamples = recentSamples.map(sample => sample.timeSpentMinutes / sample.pagesRead);
  const mean = timePerPageSamples.reduce((a, b) => a + b, 0) / timePerPageSamples.length;
  const variance = timePerPageSamples.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / timePerPageSamples.length;

  return {
    averageTimePerPage,
    standardDeviation: Math.sqrt(variance)
  };
};

export const calculateRecentCompletedDayAverage = (
  logs: StudyLog[],
  _dailyTargetPages: number
): { averageTimePerPage: number; standardDeviation: number } => {
  return calculateRecentTimedPageAverage(logs);
};

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
  const samples = logs
    .filter(log => log.subjectId === parentSubjectId)
    .flatMap(log => (log.reviewSubjectTimeRecords || [])
      .filter(record => record.subjectId === reviewSubjectId)
      .map<TimedPageSample>(record => ({
        pagesRead: record.pages,
        timeSpentMinutes: record.minutes,
        timestamp: record.timestamp
      })));

  return calculateRecentTimedPageAverage(samples).averageTimePerPage;
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
  subjects: Subject[] = []
) => {
  const subjectReviewAverage = calculateSubjectReviewAverageTimePerPage(logs, parentSubjectId, reviewSubjectId);
  if (subjectReviewAverage > 0) return subjectReviewAverage;

  return resolveBasicReviewAverageTimePerPage(logs, parentSubjectId, subjects);
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
