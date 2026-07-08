import { StudyLog, PredictionInputs, Stats } from '../types';

const RECENT_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

export const calculateRecentCompletedDayAverage = (
  logs: StudyLog[],
  dailyTargetPages: number
): { averageTimePerPage: number; standardDeviation: number } => {
  const validLogs = logs.filter(log => log.pagesRead > 0 && log.timeSpentMinutes > 0);

  if (validLogs.length === 0) {
    return { averageTimePerPage: 0, standardDeviation: 0 };
  }

  const cutoff = Date.now() - RECENT_DAYS_MS;
  const dailyMap = new Map<string, { pages: number; minutes: number }>();

  validLogs
    .filter(log => new Date(log.timestamp).getTime() >= cutoff)
    .forEach(log => {
      const dayKey = new Date(log.timestamp).toLocaleDateString();
      const current = dailyMap.get(dayKey) || { pages: 0, minutes: 0 };
      current.pages += log.pagesRead;
      current.minutes += log.timeSpentMinutes;
      dailyMap.set(dayKey, current);
    });

  const completedDays = Array.from(dailyMap.values()).filter(day =>
    dailyTargetPages > 0 ? day.pages >= dailyTargetPages : day.pages > 0
  );

  if (completedDays.length === 0) {
    return { averageTimePerPage: 0, standardDeviation: 0 };
  }

  const totalTime = completedDays.reduce((acc, day) => acc + day.minutes, 0);
  const totalPages = completedDays.reduce((acc, day) => acc + day.pages, 0);
  const averageTimePerPage = totalPages > 0 ? totalTime / totalPages : 0;
  const dailySamples = completedDays.map(day => day.minutes / day.pages);
  const mean = dailySamples.reduce((a, b) => a + b, 0) / dailySamples.length;
  const variance = dailySamples.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / dailySamples.length;

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
