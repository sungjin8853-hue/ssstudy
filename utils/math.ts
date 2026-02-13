import { StudyLog, PredictionInputs, Stats } from '../types';

/**
 * 학습 기록을 바탕으로 평균 효율, 표준편차 등을 계산합니다.
 */
export const calculateStats = (logs: StudyLog[], remainingPages: number): Stats => {
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
  const totalPages = validLogs.reduce((acc, log) => acc + log.pagesRead, 0);
  const averageTimePerPage = totalPages > 0 ? totalTime / totalPages : 0; // 1페이지당 걸리는 분

  // 표준편차 계산 (분/페이지 기준)
  const timePerPageSamples = validLogs.map(log => log.timeSpentMinutes / log.pagesRead);
  const mean = timePerPageSamples.reduce((a, b) => a + b, 0) / timePerPageSamples.length;
  const variance = timePerPageSamples.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / timePerPageSamples.length;
  const standardDeviation = Math.sqrt(variance);

  return {
    averageTimePerPage,
    standardDeviation,
    totalTimeSpent: totalTime,
    estimatedRemainingTime: averageTimePerPage * remainingPages
  };
};

/**
 * 시험 소요 시간과 권장 시간을 비교하여 필요한 복습 횟수를 산출합니다.
 */
export const calculateRequiredReviewCount = (tTest: number, tRec: number): number => {
  if (tRec === 0) return 0;
  
  // 실제 시험 시간이 권장 시간보다 길수록 숙련도가 낮다고 판단하여 복습 횟수 증가
  const ratio = tTest / tRec;
  
  if (ratio <= 1.0) return 0; // 권장 시간 내 완료
  if (ratio <= 1.2) return 1; // 20% 초과
  if (ratio <= 1.5) return 2; // 50% 초과
  return 3; // 그 이상
};

/**
 * 학습 부하(Mental Burden)를 계산합니다.
 */
export const calculateMentalBurden = (
  h1: number, 
  h2: number, 
  b: number, 
  tStudy: number, 
  tTest: number, 
  tRec: number
): { total: number, init: number, length: number } => {
   // 모델: L = f(b, tStudy, intensity)
   // 공부량(b)과 시간(tStudy)이 많을수록, 그리고 시험 강도가 높을수록 부하가 큼
   
   const burdenFromVolume = b * 0.05; // 페이지당 가중치
   const burdenFromTime = tStudy * 0.5; // 시간당 가중치
   const burdenFromIntensity = (tTest / (tRec || 1)) * 2;
   
   const total = burdenFromVolume + burdenFromTime + burdenFromIntensity;
   
   return {
     total,
     init: total * 0.3, // 초기 진입 장벽
     length: total * 0.7 // 지속성 요구량
   };
};

/**
 * 목표 달성을 위한 예측 학습량(Burden Prediction)을 계산합니다.
 */
export const calculateStudyBurdenV2 = (inputs: PredictionInputs): { total: number } => {
  // 3차 성장 모델 기반 예측 (간소화된 로직)
  // 효율성이 낮을수록(시간이 오래 걸릴수록) 더 많은 학습량이 필요하다고 예측
  
  const efficiencyFactor = inputs.tStudy > 0 && inputs.b > 0 
    ? inputs.b / inputs.tStudy // 시간당 페이지
    : 10; // 기본값
    
  const targetBoost = inputs.h3; // 목표 점수 상승분
  
  // 점수 1점을 올리기 위해 필요한 평균 페이지 수를 가정 (효율성에 따라 변동)
  const basePagesPerPoint = 30;
  const predictedTotalPages = (targetBoost * basePagesPerPoint) * (10 / (efficiencyFactor || 10));
  
  return {
    total: parseFloat(predictedTotalPages.toFixed(1))
  };
};
