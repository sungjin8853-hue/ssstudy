
export interface TagDefinition {
  id: string;
  name: string;
  color: string;
  isVisible: boolean;
  parentId?: string; // 부모 폴더 ID
}

export interface Subject {
  id: string;
  name: string;
  totalPages: number;
  completedPages: number;
  targetDate: string; // ISO string
  tagIds?: string[];
}

export interface TestRecord {
  id: string;
  timestamp: string;
  h1: number;      // 시험 점수
  b: number;       // 공부량 (페이지 수)
  tStudy: number;  // 공부 소요 시간 (시간 단위)
  tTest: number;   // 실제 시험 시간 (분 단위)
  tRec: number;    // 시험 권장 시간 (분 단위)
  subjectIds?: string[]; // 연동된 과목 ID 목록
}

export interface TestDifficultySpace {
  id: string;
  name: string;
  records: TestRecord[];
  subjectIds?: string[]; // 연동된 과목 ID 목록
}

export interface TestCategory {
  id: string;
  name: string;
  subjectId?: string;
  difficultySpaces: TestDifficultySpace[];
}

export interface StudyLog {
  id: string;
  subjectId: string;
  pagesRead: number;
  startPage?: number; // 시작 페이지
  endPage?: number;   // 종료 페이지
  timeSpentMinutes: number;
  timestamp: string;
  photoBase64?: string;
  
  // 복습 관련 필드 확장
  isReviewed?: boolean; // (Legacy) 단순 복습 여부
  reviewStep?: number;  // 현재 복습 단계 (0부터 시작)
  nextReviewDate?: string; // 다음 복습 예정 시간 (ISO String)
  isCondensed?: boolean;   // 축약(졸업) 여부 - true면 복습 목록에서 제외
}

export interface PredictionInputs {
  h1: number;
  h2: number;
  h3: number;
  b: number;
  tStudy: number;
  tTest: number;
  tRec: number;
}

export interface Stats {
  averageTimePerPage: number;
  standardDeviation: number;
  totalTimeSpent: number;
  estimatedRemainingTime: number;
}
