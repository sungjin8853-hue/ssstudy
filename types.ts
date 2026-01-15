
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
  timeSpentMinutes: number;
  timestamp: string;
  photoBase64?: string;
  isReviewed?: boolean;
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
