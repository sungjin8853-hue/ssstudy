import { StudyLog } from '../types';
import { getLocalDateKey, getLogStudyDate, parseStudyDate } from './schedule';
import { isFamilyStudyLog, SubjectFamily } from './subjectChain';

/**
 * 과목 하나(지금 공부하는 단계)만 볼 때의 "현재 과목 학습 : 기본복습" 시간 비율의 재료.
 *  - 학습: 그 단계의 공부 기록에 적힌 시간(복습 세션은 세지 않는다).
 *  - 기본복습: 그 공부 기록들을 기본복습하며 쓴 시간(기록마다 남는 기본복습 시간 기록). 복습과목에서 쓴 시간은 들어가지 않는다.
 * 둘 다 실제로 기록한 시간이다(계획이 아니다). 범위는 날짜(그날부터 오늘까지)나 요일(그 요일의 기록만)로 좁힐 수 있다.
 */
export interface StudyTimeSplit {
  study: number;
  basicReview: number;
}

export interface StudyTimeScope {
  /** 이 날짜(YYYY-MM-DD)부터의 기록만 */
  fromDateKey?: string;
  /** 이 요일(0=일 … 6=토)의 기록만 */
  weekday?: number | null;
}

const inScope = (dateKey: string, scope: StudyTimeScope) => {
  if (scope.fromDateKey && dateKey < scope.fromDateKey) return false;
  if (scope.weekday !== undefined && scope.weekday !== null && parseStudyDate(dateKey).getDay() !== scope.weekday) return false;
  return true;
};

export const splitStudyAndBasicReviewMinutes = (logs: StudyLog[], family: SubjectFamily, scope: StudyTimeScope = {}): StudyTimeSplit => {
  const unscoped = !scope.fromDateKey && (scope.weekday === undefined || scope.weekday === null);
  let study = 0;
  let basicReview = 0;
  logs.filter(log => isFamilyStudyLog(family, log)).forEach(log => {
    if (inScope(getLogStudyDate(log), scope)) study += Math.max(0, log.timeSpentMinutes || 0);
    const records = log.basicReviewTimeRecords || [];
    if (records.length > 0) {
      records.forEach(record => {
        const at = new Date(record.timestamp);
        if (Number.isFinite(at.getTime()) && inScope(getLocalDateKey(at), scope)) basicReview += Math.max(0, record.minutes || 0);
      });
    } else if (unscoped) {
      // 예전 기록: 날짜가 없는 합계라 범위를 정하지 않을 때만 센다
      basicReview += Math.max(0, log.reviewTimeSpentMinutes || 0);
    }
  });
  return { study, basicReview };
};
