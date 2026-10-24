/** "과목·폴더 관리"에서 폴더(또는 맨 위) 안의 순서를 직접 정했을 때만 있다. parentId는 맨 위면 'root'. */
export interface ListOrder {
  parentId: string;
  index: number;
}

export interface TagDefinition {
  id: string;
  name: string;
  color: string;
  isVisible: boolean;
  parentId?: string;
  listOrder?: ListOrder;
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

/** 단원: 과목을 만들 때 미리 정해 둔 공부 범위(예: 1~10, 20~30). 페이지 순서대로 단원이라 부르고, 단원 사이 페이지는 공부하지 않는다. */
export interface SubjectChapter {
  startPage: number;
  endPage: number;
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
  /**
   * 단원 목록(일반 과목 · 복습과목 모두). 있으면 공부 범위는 이 단원들이고 startPage · totalPages는 첫 단원의 시작 · 마지막 단원의 끝과 같다.
   * 끝 페이지는 푼 장수로 단원 사이를 건너뛰며 계산하고, 학습 진척도는 지금 공부하는 단원 기준이다. 없으면 startPage~totalPages 한 범위다.
   */
  chapters?: SubjectChapter[];
  /** 효율을 초기화하는 페이지 단위(끝 페이지 기준). 0이면 단위 없음. */
  growthPageUnit?: number;
  /** 화면에서 "페이지"를 부르는 글자(기본 P). 예: n, 회, 단원 */
  pageLabel?: string;
  reviewGrowthDisplay?: 'review' | 'unit';
  listOrder?: ListOrder;
  /** 정리노트의 `=`·`-` 단축어(논리어로 읽기). 없으면 예전 기기 설정(기본 켜짐)을 따른다. */
  noteShorthand?: boolean;
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
  /** 단원이 있는 과목의 기록: 시작~끝 페이지 사이에서 단원 안에 든 페이지 수(단원 사이를 건너뛴 만큼 빠진다). 진척으로 센다. */
  progressPages?: number;
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
  /**
   * 페이지 단위가 있는 과목의 공부 기록은 복습을 바로 등록하지 않고 "단위 복습 대기"로 둔다(이때 복습 제외와 같은 모양으로 저장된다).
   * 단위 끝 페이지까지 풀면 그 단위 범위의 기록들이 한꺼번에 복습에 등록되고 이 표시는 사라진다.
   */
  unitReviewPending?: boolean;
  /** 단위 복습으로 등록됐을 때 그 단위의 페이지 범위(예: 1~8). 단위로 등록되지 않은 기록에는 없다. */
  reviewUnitRange?: { start: number; end: number };
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
  /** 과목을 끝낸 뒤 고른 난도 피드백(다시·어려움·보통·쉬움). 속도 평균과 함께 다음 추천에 쓴다. */
  feedbackGrade?: 'again' | 'hard' | 'good' | 'easy';
  /** 과목 단위 FSRS-6 기억(안정도·난이도·횟수·마지막 평가 시각). 난도 피드백이 쌓이면 다음 복습 날짜를 정한다. */
  reviewFsrs?: { stability: number; difficulty: number; reps: number; lapses: number; lastReviewMs: number };
  reviewGatePendingResult?: 'correct' | 'wrong';
  reviewQuestionSchedules?: Record<string, ReviewQuestionSchedule>;
  /** 복습에서 뺀 문제(문제 key → 기록). 노트 글은 그대로 두고 복습에만 나오지 않는다. */
  reviewRemoved?: Record<string, ReviewRemovedQuestion>;
  /** 노트에서 고치기 전의 줄들(최근 것부터 위). 충돌한 값을 모을 때 "이전 값"으로 쓴다. */
  reviewMemoOldLines?: ReviewMemoOldLine[];
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

/** 복습에서 뺀 이유: 논리적 관계에 안 맞아서 / 중요도가 떨어져서 / 같은 문제가 다른 노트에 이미 있어서(주기가 더 짧은 쪽이 남는다) */
export type ReviewRemovedReason = 'logic' | 'low' | 'duplicate';

export interface ReviewRemovedQuestion {
  reason: ReviewRemovedReason;
  at: string;
  /** 뺄 때의 문제 글(목록에 보이려고 남긴다) */
  prompt: string;
  answer: string;
  /** 논리 이유로 뺀 경우 `[!]`를 붙인 줄(노트에서 그 줄이 고쳐지면 `[!]`가 빠지며 문제도 다시 나온다) */
  markedLines?: string[];
  /** `#` 틀이 펼친 줄 하나를 막으려고 노트에 새로 넣은 `[!]` 줄(되돌리면 이 줄은 지운다) */
  addedLines?: string[];
  /** 논리 이유로 뺄 때 모은 충돌 데이터: 같은 값이 나오는 다른 줄들과 고치기 전의 이전 값들 */
  related?: string[];
}

export interface ReviewMemoOldLine {
  text: string;
  /** 고치기 전의 이 줄이 바뀐 때 */
  at: string;
  /** 바뀐 뒤의 줄(있으면) */
  replacedBy?: string;
}

export interface ReviewQuestionSchedule {
  reviewStep: number;
  nextReviewDate: string;
  wrongCount?: number;
  attempts?: number;
  intervalMs?: number;
  masked?: boolean;
  /** FSRS-6 기억 상태(안정도·난이도·횟수·마지막 복습 시각). 등급이 기록된 복습부터 쌓인다. */
  fsrs?: { stability: number; difficulty: number; reps: number; lapses: number; lastReviewMs: number };
  /** 능력 변환 문제의 자유도(0~3). 쉬움을 고를수록 오르고 오답이면 내려간다. */
  freedom?: number;
  /** 첫 시도에서 정답 확인까지 걸린 시간(ms), 최근 몇 번. 걸린 시간으로 난도를 추천할 때의 기준이 된다. */
  responseMs?: number[];
}

export interface ReviewMeasurement {
  pagesRead: number;
  baselineTimePerPage: number;
  lastEndPage: number;
  measurementId: string;
  timeAttackMinutes?: number;
  baselineTimeAttackPerPage?: number;
}

export interface Stats {
  averageTimePerPage: number;
  standardDeviation: number;
  totalTimeSpent: number;
  estimatedRemainingTime: number;
}
