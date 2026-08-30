export interface TagDefinition {
  id: string;
  name: string;
  color: string;
  isVisible: boolean;
  parentId?: string;
}

export interface FollowUpSubject {
  id: string;
  name: string;
  startPage: number;
  endPage: number;
  completedPage: number;
}

export interface Subject {
  id: string;
  name: string;
  materialType?: 'problem' | 'concept';
  createdAt?: string;
  planResetDate?: string;
  startPage?: number;
  totalPages: number;
  completedPages: number;
  targetDate: string;
  initialAverageTimePerPage?: number;
  tagIds?: string[];
  reviewEnabled?: boolean;
  reviewSubjectIds?: string[];
  isRequired?: boolean;
  scheduledWeekdays?: number[];
  scheduledWeekdayPages?: Record<string, number>;
  scheduledWeekdayWeights?: Record<string, number>;
  scheduledWeekdayRemainderDay?: number;
  followUpSubjects?: FollowUpSubject[];
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
  studyDate?: string;
  studyWeekday?: number;
  photoBase64?: string;
  isReviewed?: boolean;
  reviewStep?: number;
  nextReviewDate?: string;
  isCondensed?: boolean;
  reviewEnabled?: boolean;
  reviewSubjectId?: string;
  reviewTimeSpentMinutes?: number;
  reviewCompletedPages?: number;
  basicReviewTimeRecords?: Array<{
    minutes: number;
    pages: number;
    timestamp: string;
  }>;
  reviewSubjectTimeRecords?: Array<{
    subjectId: string;
    minutes: number;
    pages: number;
    timestamp: string;
  }>;
  reviewMemo?: string;
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
