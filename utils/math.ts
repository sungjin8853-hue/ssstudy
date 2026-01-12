
import { PredictionInputs, StudyLog } from '../types';

/**
 * [제공된 파이썬 수식 정밀 이식]
 * 그래프 길이 분석 (시험 점수 · 시간 절약 · 공부량 분석)
 * h1: 이전 점수, h2: 점수 변화량, x: 공부량(b), t_study: 공부 시간, t_test: 시험 시간, t_rec: 권장 시간
 */
export const calculateGraphLengthAnalysis = (inputs: PredictionInputs) => {
  const { h1, h2, b: x, tStudy, tTest, tRec } = inputs;

  // 필수 조건 체크 (분모가 0이 되거나 데이터가 부적절한 경우 방지)
  if (h1 <= 0 || x <= 0 || tRec <= 0) return { total: 0, C: 0 };

  try {
    // 1. 상수 C (기울기/증폭 계수) 계산
    // volume_ratio = ((h1 + h2)**3) / ((h1 + h2)**3 - h1**3)
    const h_sum_cube = Math.pow(h1 + h2, 3);
    const h1_cube = Math.pow(h1, 3);
    const denominator = h_sum_cube - h1_cube;
    
    if (denominator === 0) return { total: 0, C: 0 };

    const volume_ratio = h_sum_cube / denominator;
    const efficiency = tStudy / x; // t_study / x
    const C = volume_ratio * efficiency;

    // 2. x축 구간 설정
    // x_start = 2.0
    // x_end = (k**2.5) + 1  (k = t_test / t_rec)
    const k = tTest / tRec;
    const x_start = 2.0;
    const x_end = Math.pow(k, 2.5) + 1;

    // 구간이 역전되거나 없을 때 (수식상의 예외 처리)
    if (x_end <= x_start) {
      return { total: 0, C };
    }

    // 3. 적분할 함수 정의
    // y = C * x^0.4
    // dy_dx = 0.4 * C * x^(-0.6)
    // integrand = sqrt(1 + (dy/dx)^2)
    const integrand = (val_x: number) => {
      const dy_dx = 0.4 * C * Math.pow(val_x, -0.6);
      return Math.sqrt(1 + Math.pow(dy_dx, 2));
    };

    // 4. 수치 적분 (사다리꼴 공식 적용, 2000개 구간으로 정밀도 확보)
    const n = 2000;
    const length = trapezoidalIntegration(integrand, x_start, x_end, n);
    
    return { total: length, C };
  } catch (e) {
    console.error("Analysis Integration Error:", e);
    return { total: 0, C: 0 };
  }
};

/**
 * 학습량 예측 (Cubic 모델)
 * 수식: (b + b / (((h1 + h2) / h1)^3 - 1)) * (((h1 + h2 + h3) / (h1 + h2))^3 - 1)
 */
export const calculateStudyBurdenV2 = (inputs: PredictionInputs) => {
  const { h1, h2, b, h3 } = inputs;
  if (h1 <= 0 || b <= 0 || h2 <= 0) return { total: 0 };

  try {
    // 파이썬 수식의 구조를 그대로 반영
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

/**
 * 수치 적분 도우미 (사다리꼴 공식)
 */
const trapezoidalIntegration = (f: (x: number) => number, a: number, b: number, n: number) => {
  const h = (b - a) / n;
  let s = (f(a) + f(b)) / 2;
  for (let i = 1; i < n; i++) {
    s += f(a + i * h);
  }
  return s * h;
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
