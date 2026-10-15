export interface TagDefinition {
  id: string;
  name: string;
  color: string;
  isVisible: boolean;
  parentId?: string;
}

export interface FollowUpSubject {
  id: string;
  sourceSubjectId?: string;
  name: string;
  startPage: number;
  endPage: number;
  completedPage: number;
  reviewSubjectIds?: string[];
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
  reviewStartPage?: number;
  tagIds?: string[];
  reviewEnabled?: boolean;
  reviewSubjectIds?: string[];
  isRequired?: boolean;
  scheduledWeekdays?: number[];
  scheduledWeekdayPages?: Record<string, number>;
  scheduledWeekdayWeights?: Record<string, number>;
  scheduledWeekdayRemainderDay?: number;
  followUpSubjects?: FollowUpSubject[];
  growthPageUnit?: number;
  growthComparisonUnits?: number;
  reviewGrowthDisplay?: 'review' | 'unit';
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

export interface ReviewMemoLogicalOperator {
  index: number;
  operator: 'and' | 'or' | 'sequence';
}

export type ReviewMemoChildrenRelation = {
  separatorIndex: number;
  operator: 'and';
  type: 'part';
} | {
  separatorIndex: number;
  operator: 'or';
  type: 'alternative';
};

export type ReviewMemoLogicalExpression = {
  type: 'text';
  startIndex: number;
  endIndex: number;
} | {
  type: 'group';
  startIndex: number;
  endIndex: number;
  expression: ReviewMemoLogicalExpression;
} | {
  type: 'and' | 'or' | 'sequence';
  operands: ReviewMemoLogicalExpression[];
};

export interface ReviewMemoNode {
  id: string;
  parentId: string | null;
  type: 'text' | 'toggle';
  text: string;
  order: number;
  logicalOperators?: ReviewMemoLogicalOperator[];
  logicalExpressions?: ReviewMemoLogicalExpression[];
  relationSeparators?: number[];
  childrenRelation?: ReviewMemoChildrenRelation;
}

export interface ReviewMemoDocument {
  version: 1;
  nodes: ReviewMemoNode[];
}

export interface StudyLog {
  id: string;
  subjectId: string;
  subjectNameSnapshot?: string;
  subjectStageId?: string;
  subjectStageNameSnapshot?: string;
  reviewSubjectIdsSnapshot?: string[];
  folderSnapshots?: Array<{
    id: string;
    name: string;
    parentId?: string;
  }>;
  pagesRead: number;
  pageCountIsExplicit?: boolean;
  pomodoroSession?: boolean;
  startPage?: number;
  endPage?: number;
  timeSpentMinutes: number;
  timeAttackMinutes?: number;
  organizationMinutes?: number;
  reviewBaselineTimePerPage?: number;
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
  reviewParentSubjectId?: string;
  reviewPageRangeBased?: boolean;
  isRepeatReview?: boolean;
  reviewRepeatStartPage?: number;
  basicReviewTimeRecords?: Array<{
    minutes: number;
    pages: number;
    timestamp: string;
    reviewNumber?: number;
  }>;
  reviewSubjectTimeRecords?: Array<{
    subjectId: string;
    completed?: boolean;
    reviewNumber?: number;
    minutes: number;
    pages: number;
    timestamp: string;
    measurementId?: string;
    includedMeasurementIds?: string[];
    baselineTimePerPage?: number;
    timeAttackMinutes?: number;
    organizationMinutes?: number;
    baselineTimeAttackPerPage?: number;
    timeChangePercent?: number;
    lastEndPage?: number;
  }>;
  reviewMemo?: string;
  reviewMemoDocument?: ReviewMemoDocument;
  reviewGatePendingResult?: 'correct' | 'wrong';
  reviewQuestionSchedules?: Record<string, ReviewQuestionSchedule>;
  reviewQuestionFormat?: 2;
  reviewGateLevel?: number;
  reviewGatePendingSchedules?: Record<string, ReviewQuestionSchedule>;
  reviewGatePendingSteps?: Record<string, number>;
  reviewGateRetry?: {
    dueAt: string;
    intervalMs: number;
    reviewStep: number;
    questionKeys: string[];
  };
}

export interface ReviewQuestionSchedule {
  reviewStep: number;
  nextReviewDate: string;
  wrongCount?: number;
  attempts?: number;
  intervalMs?: number;
  masked?: boolean;
}

export interface ReviewMeasurement {
  pagesRead: number;
  baselineTimePerPage: number;
  lastEndPage: number;
  measurementId: string;
  timeAttackMinutes?: number;
  baselineTimeAttackPerPage?: number;
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
