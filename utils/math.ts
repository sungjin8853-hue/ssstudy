import { StudyLog, PredictionInputs, Stats } from '../types';

const RECENT_STUDY_MINUTES_LIMIT = 15 * 60;

const takeRecentStudyMinutes = (logs: StudyLog[]) => {
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

export const calculateRecentCompletedDayAverage = (
  logs: StudyLog[],
  _dailyTargetPages: number
): { averageTimePerPage: number; standardDeviation: number } => {
  const recentLogs = takeRecentStudyMinutes(logs);

  if (recentLogs.length === 0) {
    return { averageTimePerPage: 0, standardDeviation: 0 };
  }

  const totalTime = recentLogs.reduce((acc, log) => acc + log.timeSpentMinutes, 0);
  const totalPages = recentLogs.reduce((acc, log) => acc + log.pagesRead, 0);
  const averageTimePerPage = totalPages > 0 ? totalTime / totalPages : 0;
  const samples = recentLogs.map(log => log.timeSpentMinutes / log.pagesRead);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / samples.length;

  return {
    averageTimePerPage,
    standardDeviation: Math.sqrt(variance)
  };
};

export const calculateStats = (logs: StudyLog[], remainingPages: number, dailyTargetPages = 0): Stats => {
  const validLogs = logs.filter(log => log.pagesRead > 0 && log.timeSpentMinutes > 0);

  if (validLogs.length === 0) {
    return {
      averageTimePerPage: 0,
      standardDeviation: 0,
      totalTimeSpent: 0,
      estimatedRemainingTime: 0
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
