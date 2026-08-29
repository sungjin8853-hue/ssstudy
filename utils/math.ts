import { StudyLog, PredictionInputs, Stats } from '../types';

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

export const calculateBasicReviewAverageTimePerPage = (logs: StudyLog[], parentSubjectId: string) => {
  const samples = logs
    .filter(log => log.subjectId === parentSubjectId)
    .flatMap<TimedPageSample>(log => {
      if (log.basicReviewTimeRecords?.length) {
        return log.basicReviewTimeRecords.map(record => ({
          pagesRead: record.pages,
          timeSpentMinutes: record.minutes,
          timestamp: record.timestamp
        }));
      }

      if ((log.reviewTimeSpentMinutes || 0) > 0 && (log.reviewCompletedPages || 0) > 0) {
        return [{
          pagesRead: log.reviewCompletedPages || 0,
          timeSpentMinutes: log.reviewTimeSpentMinutes || 0,
          timestamp: log.timestamp
        }];
      }

      return [];
    });

  return calculateRecentTimedPageAverage(samples).averageTimePerPage;
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

export const resolveBasicReviewAverageTimePerPage = (logs: StudyLog[], parentSubjectId: string) => {
  const basicReviewAverage = calculateBasicReviewAverageTimePerPage(logs, parentSubjectId);
  if (basicReviewAverage > 0) return basicReviewAverage;

  return calculateRecentCompletedDayAverage(
    logs.filter(log => log.subjectId === parentSubjectId),
    0
  ).averageTimePerPage;
};

export const resolveSubjectReviewAverageTimePerPage = (
  logs: StudyLog[],
  parentSubjectId: string,
  reviewSubjectId: string
) => {
  const subjectReviewAverage = calculateSubjectReviewAverageTimePerPage(logs, parentSubjectId, reviewSubjectId);
  if (subjectReviewAverage > 0) return subjectReviewAverage;

  return resolveBasicReviewAverageTimePerPage(logs, parentSubjectId);
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
