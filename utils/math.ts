
import { PredictionInputs, StudyLog } from '../types';

/**
 * 필요 복습 횟수 계산 (단순화된 효율 지표)
 * 수식: (tTest / tRec) ^ 2.5
 */
export const calculateRequiredReviewCount = (tTest: number, tRec: number) => {
  if (tRec <= 0 || tTest <= 0) return 0;
  return Math.pow(tTest / tRec, 2.5);
};

/**
 * 멘탈 부하량(Mental Burden) 계산 - 복습 중요도 지표
 * 제공된 파이썬 수식을 수치 적분을 통해 구현
 */
export const calculateMentalBurden = (h1: number, h2: number, x: number, tStudy: number, tTest: number, tRec: number) => {
  if (h1 <= 0 || x <= 0 || tRec <= 0 || h2 <= 0) return { total: 0, init: 0, length: 0 };

  try {
    // 1. 상수 C (학습 밀도 계수) 계산
    const volumeNumerator = Math.pow(h1 + h2, 3);
    const volumeDenominator = Math.pow(h1 + h2, 3) - Math.pow(h1, 3);
    const volumeRatio = volumeNumerator / volumeDenominator;
    const efficiency = tStudy / x;
    const C = volumeRatio * efficiency;

    // 2. Part A: 초기 부하 (A=2일 때의 값)
    const initialValue = C * Math.pow(2, 0.4);

    // 3. Part B: 그래프의 길이 (인내의 과정)
    const A_start = 2.0;
    const timeRatio = tTest / tRec;
    const A_end = Math.pow(timeRatio, 2.5);

    let arcLength = 0;
    if (A_end > A_start) {
      // 수치 적분 (사다리꼴 공식 적용, 50단계)
      const steps = 50;
      const h = (A_end - A_start) / steps;
      
      const f = (A: number) => {
        const dy_dA = 0.4 * C * Math.pow(A, -0.6);
        return Math.sqrt(1 + Math.pow(dy_dA, 2));
      };

      let sum = 0.5 * (f(A_start) + f(A_end));
      for (let i = 1; i < steps; i++) {
        sum += f(A_start + i * h);
      }
      arcLength = sum * h;
    }

    return {
      total: initialValue + arcLength,
      init: initialValue,
      length: arcLength
    };
  } catch (e) {
    return { total: 0, init: 0, length: 0 };
  }
};

/**
 * 학습량 예측 (Cubic 모델)
 */
export const calculateStudyBurdenV2 = (inputs: PredictionInputs) => {
  const { h1, h2, b, h3 } = inputs;
  if (h1 <= 0 || b <= 0 || h2 <= 0) return { total: 0 };

  try {
    const ratio1 = Math.pow((h1 + h2) / h1, 3);
    const term1 = b + (b / (ratio1 - 1));
    const ratio2 = Math.pow((h1 + h2 + h3) / (h1 + h2), 3);
    const term2 = ratio2 - 1;
    const cubicB = term1 * term2;

    return { total: Math.max(0, cubicB) };
  } catch (e) {
    return { total: 0 };
  }
};

export const calculateStats = (logs: StudyLog[], remainingPages: number) => {
  if (logs.length === 0) return { averageTimePerPage: 0, standardDeviation: 0, totalTimeSpent: 0, estimatedRemainingTime: 0 };
  const times = logs.filter(l => l.pagesRead > 0).map(l => l.timeSpentMinutes / l.pagesRead);
  if (times.length === 0) return { averageTimePerPage: 0, standardDeviation: 0, totalTimeSpent: 0, estimatedRemainingTime: 0 };
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const std = Math.sqrt(times.map(t => Math.pow(t - avg, 2)).reduce((a, b) => a + b, 0) / times.length);
  return { 
    averageTimePerPage: avg, 
    standardDeviation: std, 
    totalTimeSpent: logs.reduce((a, b) => a + b.timeSpentMinutes, 0), 
    estimatedRemainingTime: avg * remainingPages 
  };
};
