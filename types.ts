export interface TagDefinition {
  id: string;
  name: string;
  color: string;
  isVisible: boolean;
  parentId?: string;
}

export interface Subject {
  id: string;
  name: string;
  totalPages: number;
  completedPages: number;
  targetDate: string;
  tagIds?: string[];
  reviewEnabled?: boolean;
}

export interface TestRecord {
  id: string;
  timestamp: string;
  h1: number;
  b: number;
  tStudy: number;
  tTest: number;
  tRec: number;
  subjectIds?: string[];
}

export interface TestDifficultySpace {
  id: string;
  name: string;
  records: TestRecord[];
  subjectIds?: string[];
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
  subjectNameSnapshot?: string;
  folderSnapshots?: Array<{
    id: string;
    name: string;
    parentId?: string;
  }>;
  pagesRead: number;
  startPage?: number;
  endPage?: number;
  timeSpentMinutes: number;
  timestamp: string;
  photoBase64?: string;
  isReviewed?: boolean;
  reviewStep?: number;
  nextReviewDate?: string;
  isCondensed?: boolean;
  reviewEnabled?: boolean;
  reviewMemo?: string;
  sessionTimerId?: string;
  timerBreakdown?: Array<{
    timerId: string;
    timerDifficulty?: 'easy' | 'medium' | 'hard';
    pages: number;
    timeSpentMinutes: number;
  }>;
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
