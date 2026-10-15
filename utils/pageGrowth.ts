import { StudyLog, Subject } from '../types';
import { getLocalDateKey } from './schedule';

export const DEFAULT_GROWTH_PAGE_UNIT = 10;
export const normalizeGrowthUnit = (value?: number, fallback = DEFAULT_GROWTH_PAGE_UNIT) => (
  Number.isFinite(value) && value! >= 1 ? Math.floor(value!) : fallback
);

export const normalizePageGrowthSettings = (subject: Subject) => ({
  growthPageUnit: normalizeGrowthUnit(subject.growthPageUnit),
  growthComparisonUnits: normalizeGrowthUnit(subject.growthComparisonUnits, 1),
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

export const calculateUnitEfficiency = (logs: PageEfficiencySample[], pageUnit?: number) => {
  const units = buildPageEfficiencyUnits(logs, pageUnit);
  const basis = [...units].reverse().find(unit => unit.complete) || units[0] || null;
  return { basis, averageTimePerPage: basis?.averageTimePerPage || 0,
    timeAttackAverageTimePerPage: basis?.timeAttackAverageTimePerPage || 0,
    standardDeviation: basis?.standardDeviation || 0 };
};

export const calculatePageUnitGrowth = (logs: StudyLog[], subjectId: string, pageUnit?: number, comparisonUnits = 1) => {
  const unitSize = normalizeGrowthUnit(pageUnit);
  const lookback = normalizeGrowthUnit(comparisonUnits, 1);
  const units = buildPageEfficiencyUnits(logs.filter(log => log.subjectId === subjectId), unitSize);
  const current = units[units.length - 1] || null;
  const reference = units[units.length - 1 - lookback] || null;
  return { unitSize, lookback, units, current, reference,
    speedChangePercent: current && reference ? (reference.averageTimePerPage / current.averageTimePerPage - 1) * 100 : null };
};

export type GrowthComparison = 1 | 2 | 3 | 'older';

export const getGrowthComparison = (units: PageEfficiencyUnit[], comparison: GrowthComparison) => {
  const current = units[units.length - 1] || null;
  const referenceIndex = comparison === 'older' ? -1 : units.length - 1 - comparison;
  const previous = comparison === 'older' ? units.slice(0, Math.max(0, units.length - 4))
    : referenceIndex >= 0 ? [units[referenceIndex]] : [];
  const actualComparison = previous.length > 0 ? comparison : 1;
  const references = previous.length > 0 ? previous : units.slice(-2, -1);
  const pages = references.reduce((sum, unit) => sum + unit.pages, 0);
  const totalRate = pages > 0 ? references.reduce((sum, unit) => sum + unit.minutes, 0) / pages : 0;
  const attackRate = pages > 0 ? references.reduce((sum, unit) => sum + unit.timeAttackMinutes, 0) / pages : 0;
  return { comparison: actualComparison, current, referenceTimePerPage: totalRate, referenceAttackTimePerPage: attackRate,
    overallGrowth: current && totalRate > 0 && current.averageTimePerPage > 0 ? (totalRate / current.averageTimePerPage - 1) * 100 : null,
    attackGrowth: current && attackRate > 0 && current.timeAttackAverageTimePerPage > 0
      ? (attackRate / current.timeAttackAverageTimePerPage - 1) * 100 : null };
};

export const nextGrowthComparison = (units: PageEfficiencyUnit[], comparison: GrowthComparison): GrowthComparison => {
  const next = comparison === 1 ? 2 : comparison === 2 ? 3 : comparison === 3 ? 'older' : 1;
  return getGrowthComparison(units, next).comparison;
};
