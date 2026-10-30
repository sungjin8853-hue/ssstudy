import { formatDoneMinutes } from '../utils/studyReport';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Subject, StudyLog, ReviewMemoDocument, ReviewMeasurement } from '../types';
import type { ReviewRemovedReason } from '../types';
import {
  calculateBasicReviewGroupTiming,
  calculateRecentCompletedDayAverage,
  calculateTimeAttackAverage,
  calculateReviewSubjectTiming
} from '../utils/math';
import { BASIC_REVIEW_DETAIL_PREFIX, createRepeatedSubjectReview, getRepeatedReviewRange, getReviewDetailKey, getReviewStartPage, willWaitForReview } from '../utils/review';
import { endPageForSolved, pagesBetween, positionAfterSolved, splitByChapter } from '../utils/subjectChapters';
import { createPageMeasurement, getAutoSolvedPageCount, getLogProgressPages, getMeasurementGoalEndPage, getMeasurementRemainingPages, getPomodoroPageTarget, getPomodoroProgress, getSessionTimes, isPomodoroGoalExceeded, PomodoroPlan } from '../utils/measurement';
import { applyReviewGateOutcomes, getDueReviewGateRetries, getDueReviewGateQuestionKeys, getReviewGateQuestionKeys, getReviewGateRetryKeys, getReviewQuestionSchedules, parseReviewGateMemo, previewReviewCompletionIntervals, ReviewGateOutcome } from '../utils/reviewGate';
import { calculateQuestionPerformance, getPracticeBatch, getReviewPracticeLevel, gradeReviewPractice, previewGradeIntervals, reconcileReviewPractice, setReviewPracticeLevel, startReviewPractice, ReviewPractice, ReviewGrade } from '../utils/reviewPractice';
import { ReviewQuestionTools } from './ReviewQuestionTools';
import type { QuestionLineEdit } from './ReviewQuestionTools';
import { planReviewRemoval, replaceMemoLine, REMOVE_REASON_LABELS } from '../utils/reviewRemoval';
import type { RemovalCover, RemovalMemo, RemovalUpdate } from '../utils/reviewRemoval';
import { readEditIntake } from '../utils/reviewEditIntake';
import { convertLabel, foldConvertUnit, isConvertUnitKey, planConvertReview } from '../utils/abilityConvert';
import { planPairReview } from '../utils/pairReview';
import { formatResponseSeconds, recommendReviewGrade } from '../utils/gradeRecommendation';
import { basicReviewFeedbackOf, formatSpeed, gradeSubjectCard, mostCommonFirstGrade, pastSessions, previewSubjectIntervals, recommendSubjectGrade, speedPerHour, SUBJECT_GRADE_LABELS, SUBJECT_GRADES, summarizeSpeedFeedback } from '../utils/subjectFeedback';
import type { FeedbackKind, SubjectGrade } from '../utils/subjectFeedback';
import { ReviewQuestionContent } from './ReviewQuestionContent';
import { ReviewNoteSummary } from './ReviewNoteSummary';
import { DEFAULT_PAGE_LABEL, getPageLabel, pagePositionLabel } from '../utils/pageLabel';
import { adjustSubjectProgress, calculateFreshWeekdayPagePlan, getActiveSubjectStage, getRecommendedEndPage, getStageChapters, getAllSubjectReviewIds, getDiffDays, getLocalDateKey, getLogStudyDate, getPastCarryoverPages, getPastPlanBalance, getPlanningDayCount, getSubjectDayRemainingPages, getSubjectDayTarget, getSubjectRemainingPageCount, getSubjectStageReviewSubjectIds, getSubjectStages, isSubjectRequiredNow, normalizeWeekdays, WEEKDAYS } from '../utils/schedule';
import { NoteSetEditContext, NoteSetSourceContext, ReviewMemoEditor } from './ReviewMemoEditor';
import type { NoteSetRewriter } from './ReviewMemoEditor';
import { NoteTutorial } from './Tutorials';
import { MemoColorTextarea } from './MemoColorTextarea';
import { createSessionMemoRecord, readSessionMemos, writeSessionMemo } from '../utils/sessionMemo';
import { IdleSummaryContext, LaterMemberData, ReviewPlanContext, ReviewScopeData, StartButton, stepRowKey, TaskCardData, TaskMemberData, TaskQueueList } from './TodayTasks';
import { PomodoroNotice } from './PomodoroNotice';
import { PomodoroLength } from './PomodoroMinutesStepper';
import { usePomodoroMinutes } from '../utils/pomodoroSetting';
import { buildCompletedDetailRows, buildCompletedSubjectSummaries } from './TodaySummary';
import { formatReviewInterval, ReviewPracticeScreen, ReviewRailItem } from './ReviewPracticeScreen';
import { compareReviewQuestionDifficulty } from '../utils/reviewDifficulty';
import { REVIEW_QUESTION_KIND_LABELS } from '../utils/reviewQuestions';
import type { NoteQuestion } from '../utils/reviewQuestions';
import { carriedNoteLogs } from '../utils/noteUnits';
import { mergeSheetParts, SheetPart, SheetUpdate, splitNoteSheet } from '../utils/noteSheet';
import { mergeNoteIntoEarlier } from '../utils/noteMerge';
import { recordNoteMerges } from '../utils/noteMergeLog';
import { setNoteShorthand, withLogShorthand } from '../utils/noteShorthand';
import { useSubjectNoteShorthand } from '../utils/useNoteShorthand';

interface Props {
  subjects: Subject[];
  logs: StudyLog[];
  activeWeekday: number;
  activeStudyDate: string;
  detailSubjectId: string;
  onDetailSubjectChange: (subjectId: string) => void;
  renderSummary: (taskSelector: React.ReactNode, onSelectSubject: (subjectId: string) => void, completedStudySubjectIds: string[], pomodoroPlan: PomodoroPlan | null, idle?: IdleSummaryContext) => React.ReactNode;
  onLogSession: (log: StudyLog) => void;
  onUpdateSubjects?: (subjects: Subject[]) => void;
  onReviewAction: (logIds: string[], action: 'complete' | 'condense', reviewTimeSpentMinutes?: number, feedbackGrade?: SubjectGrade) => void;
  onAdvanceReviewSubject: (logIds: string[], completedReviewSubjectId: string, nextReviewSubjectId: string | null, reviewTimeSpentMinutes: number, measurement: ReviewMeasurement, feedbackGrade?: SubjectGrade) => void;
  onRecordReviewSubjectTime: (logIds: string[], completedReviewSubjectId: string, reviewTimeSpentMinutes: number, measurement: ReviewMeasurement) => void;
  onUpdateReviewMemo: (logId: string, memo: string, document?: ReviewMemoDocument) => void;
  /** 복습에서 문제를 뺀다(논리 이유는 그 줄에 [!]를 붙인 글도 함께 저장한다) */
  onRemoveReviewQuestions?: (updates: RemovalUpdate[]) => void;
  /** 복습에서 뺀 문제를 되돌린다 */
  onRestoreReviewQuestion?: (logId: string, questionKey: string) => void;
  onFinishReviewGate: (outcomes: ReviewGateOutcome[], isRetry: boolean) => void;
  onClearReviewGateRetries: (logIds: string[]) => void;
  sessionMemoOverrides?: Record<string, string>;
}

interface SessionTimer {
  id: string;
  name: string;
}

interface StudyOrderItem {
  subject: Subject;
  scopedPages: number;
  carryoverPages: number;
  remainingDayPages: number;
  averageTimePerPage: number;
  speedChangePercent: number | null;
  estimatedMinutes: number;
}

interface ReviewQueueGroup {
  id: string;
  parentSubjectId: string;
  parentSubjectName: string;
  subjectId: string;
  subjectName: string;
  subject?: Subject;
  reviewType: 'basic' | 'subject';
  isGateRetry?: boolean;
  reviewSubjectIds: string[];
  logs: StudyLog[];
  earliestReviewTime: number;
  averageTimePerPage: number;
  estimatedMinutes: number;
  /** 같은 복습과목의 범위별 복습(`:range-N`)을 한 묶음으로 합쳤을 때 원래의 범위별 묶음들(상세 칸의 범위 탭에 쓴다) */
  rangeGroups?: ReviewQueueGroup[];
}

type StudyRunQueueItem =
  | {
      kind: 'review';
      key: string;
      reviewGroup: ReviewQueueGroup;
      isRequired: boolean;
      estimatedMinutes: number;
      name: string;
    }
  | {
      kind: 'study';
      key: string;
      studyItem: StudyOrderItem;
      isRequired: boolean;
      estimatedMinutes: number;
      name: string;
    };

export const getSelectedRunQueueItem = (items: StudyRunQueueItem[], selectedKey: string) => (
  items.find(item => item.key === selectedKey) || items[0]
);

/**
 * 오늘 할 일의 한 칸 = 한 과목. 일반 과목의 기본 복습은 그 과목(현재 과목) 칸에, 복습과목의 기본 복습과 복습과목의 복습은 그 복습과목 칸에 들어간다.
 * 칸 안에서는 기본 복습이 먼저, 그다음 과목(학습 · 복습과목의 복습) 차례이고, 지금 할 차례(앞의 것)만 자세히 보이고 뒷순서는 한 줄 정보만 둔다.
 */
export const runQueueCellId = (item: StudyRunQueueItem) => (item.kind === 'study' ? item.studyItem.subject.id
  : item.reviewGroup.reviewType === 'basic' ? item.reviewGroup.parentSubjectId : item.reviewGroup.subjectId);
const runQueueCellRank = (item: StudyRunQueueItem) => (item.kind === 'review' && item.reviewGroup.reviewType === 'basic' ? 0 : 1);
/** 그 항목이 든 칸에서 지금 할 차례인 항목(같은 순서면 대기열에서 앞선 것) */
export const getRunQueueCellLead = (items: StudyRunQueueItem[], item: StudyRunQueueItem | undefined) => {
  if (!item) return item;
  const cell = items.filter(other => runQueueCellId(other) === runQueueCellId(item));
  return cell.reduce((best, other) => (runQueueCellRank(other) < runQueueCellRank(best) ? other : best), cell[0]);
};

type Step = 'idle' | 'timer' | 'organize' | 'pages';

const formatTime = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hrs > 0 ? hrs + ':' : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export const MeasurementProgress: React.FC<{ pages: number; target: number | null; elapsed: string; label?: string }> = ({ pages, target, elapsed, label = DEFAULT_PAGE_LABEL }) => {
  const exceeded = isPomodoroGoalExceeded(pages, target);
  const labelClass = `mb-2 text-sm font-black ${exceeded ? 'text-amber-600' : 'text-slate-500'}`;
  // 순서: 경과 시간(뽀모도로 바로 옆) → 이번 측정. 남은 페이지는 보이지 않는다
  return <>
    <span className="flex min-w-0 shrink-0 flex-col">
      <span className={labelClass}>경과 시간</span>
      <span data-testid="measurement-elapsed" className={`font-mono text-2xl font-black tabular-nums sm:text-3xl ${exceeded ? 'text-amber-600' : 'text-slate-900'}`}>{elapsed}</span>
    </span>
    <span className="flex min-w-0 shrink-0 flex-col border-l border-slate-200 pl-3 sm:pl-4">
      <span className={labelClass}>이번 측정</span>
      <span data-testid="measurement-pages" className={`whitespace-nowrap font-mono text-2xl font-black tabular-nums sm:text-3xl ${exceeded ? 'text-amber-600' : 'text-indigo-700'}`}>
        {formatPageNumber(pages)} / {target !== null ? formatPageNumber(target) : '-'}{label}
      </span>
    </span>
  </>;
};

export const OrganizationTimer: React.FC<{ seconds: number; baseSeconds?: number; running: boolean; onToggle: () => void; onComplete: () => void }> = ({ seconds, baseSeconds = 0, running, onToggle, onComplete }) => (
  <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="min-w-0 flex-1">
      <h3 className="text-xl font-black text-slate-900">막힌 부분 정리</h3>
      <p className="mt-2 text-sm font-bold text-slate-500">총 학습 시간</p>
      <p className="mt-1 font-mono text-4xl font-black tabular-nums text-slate-900">{formatTime(baseSeconds + seconds)}</p>
      <p className="mt-1 text-sm font-bold text-slate-500">풀이 {formatTime(baseSeconds)} · 정리 {formatTime(seconds)}</p>
    </div>
    <button type="button" onClick={onToggle} className={`rounded-xl px-5 py-3.5 text-sm font-black ${running ? 'bg-slate-200 text-slate-800 hover:bg-slate-300' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
      {running ? '일시정지' : '다시 시작'}
    </button>
    <button type="button" onClick={onComplete} className="rounded-xl bg-rose-500 px-5 py-3.5 text-sm font-black text-white hover:bg-rose-600">완료</button>
  </div>
);

const getRunQueueDetailKey = (item: StudyRunQueueItem) => item.kind === 'review'
  ? getReviewDetailKey(item.reviewGroup.reviewType, item.reviewGroup.parentSubjectId, item.reviewGroup.subjectId)
  : item.studyItem.subject.id;
type TimerMode = 'remainingPages' | 'elapsedTime' | 'sessionMemo';
type PreSessionReviewMode = 'before-study' | 'after-study' | 'interrupt';

interface ActiveReviewRun {
  logIds: string[];
  parentSubjectId: string;
  reviewSubjectIds: string[];
  currentIndex: number;
  sourceName: string;
  startPage?: number;
  stageId?: string;
  /** 앞서 푼 복습 문제들의 첫 답변 중 가장 많은 등급: 복습과목 난도 피드백의 추천이 된다(고르는 것은 사용자) */
  questionGrade?: SubjectGrade | null;
}

interface GateReviewQuestion {
  id: string;
  questionKey: string;
  logId: string;
  range: string;
  level: number;
  priority: number;
  recallUnits: number;
  providedUnits: number;
  difficulty: number;
  importance?: number;
  blankStart?: number;
  /** 결합·자유도로 만든 능력 변환 문제: 이 문제가 맡은 단위 문제들(일정은 단위마다 따로 쌓인다) */
  covered?: { logId: string; questionKey: string }[];
  /** 결합 문제는 노트에 없는 문제라 만든 문제를 그대로 들고 있다 */
  presentation?: NoteQuestion;
  /** 관계쌍 묶음: 이 문제 하나로 같은 쌍의 문제들(covered)이 결과를 함께 받는다. 빼기는 이 문제만 뺀다. */
  bundled?: boolean;
}

type GateReviewResult = ReviewGrade;

const REVIEW_SESSION_PREF_KEY = 'swp_session_review_preferences';
const SESSION_MEMO_COLLAPSED_KEY = 'swp_session_memo_collapsed';
const getSoundSrc = (path: string) => {
  const basePath = new URL('.', window.location.href).pathname;
  return `${basePath}${path}`;
};
const PAGE_TURN_SOUND_SRC = getSoundSrc('sounds/page-turn.mp3');
const DEFAULT_SESSION_TIMER: SessionTimer = {
  id: 'none',
  name: '중간 타이머'
};

const soundCache = new Map<string, HTMLAudioElement>();

const getSound = (src: string) => {
  const cached = soundCache.get(src);
  if (cached) return cached;

  const audio = new Audio(src);
  audio.preload = 'auto';
  audio.volume = 1;
  soundCache.set(src, audio);
  return audio;
};

const unlockSound = async (src: string) => {
  const audio = getSound(src);
  try {
    audio.muted = true;
    audio.currentTime = 0;
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
  } catch {
    // iOS Safari may still reject until a direct tap; the normal play call will retry later.
  } finally {
    audio.muted = false;
  }
};

// 뽀모도로가 끝났을 때 내는 소리: 코드로 만든 "삐삐삐삐" 알람(파일 없음).
// 파일이 없어도 나고, 브라우저가 소리를 막으면(사용자가 누른 적이 없을 때) 쪽 넘김 소리로 대신한다.
type ChimeWindow = Window & { webkitAudioContext?: typeof AudioContext };
let chimeContext: AudioContext | null = null;

const getChimeContext = () => {
  if (chimeContext) return chimeContext;
  if (typeof window === 'undefined') return null;
  const Context = window.AudioContext || (window as ChimeWindow).webkitAudioContext;
  if (!Context) return null;
  try {
    chimeContext = new Context();
  } catch {
    chimeContext = null;
  }
  return chimeContext;
};

const unlockChime = () => {
  const context = getChimeContext();
  if (context && context.state === 'suspended') void context.resume().catch(() => undefined);
};

/** 뽀모도로가 끝났을 때의 알람: "삐삐삐삐"(짧은 삐 소리 4번)를 이만큼 되풀이한다(30일 요청, 예전 세 음 종소리 대신) */
export const POMODORO_ALARM_REPEATS = 3;
export const POMODORO_BEEPS = 4;
const BEEP_FREQUENCY = 2000;
const BEEP_SECONDS = 0.09;
const BEEP_GAP_SECONDS = 0.07;
const ALARM_GAP_SECONDS = 0.9;

const ringChime = (context: AudioContext) => {
  const firstAt = context.currentTime + 0.04;
  for (let repeat = 0; repeat < POMODORO_ALARM_REPEATS; repeat += 1) {
    const groupAt = firstAt + repeat * (POMODORO_BEEPS * (BEEP_SECONDS + BEEP_GAP_SECONDS) + ALARM_GAP_SECONDS);
    for (let beep = 0; beep < POMODORO_BEEPS; beep += 1) ringBeep(context, groupAt + beep * (BEEP_SECONDS + BEEP_GAP_SECONDS));
  }
};
/** 디지털 알람시계 같은 짧은 "삐": 네모파 한 음, 시작 · 끝을 아주 짧게 다듬어 딸깍 소리가 나지 않게 한다 */
const ringBeep = (context: AudioContext, startAt: number) => {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'square';
  oscillator.frequency.value = BEEP_FREQUENCY;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.005);
  gain.gain.setValueAtTime(0.18, startAt + BEEP_SECONDS - 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + BEEP_SECONDS);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + BEEP_SECONDS + 0.01);
};

const unlockSounds = () => {
  unlockChime();
  void (async () => {
    await unlockSound(PAGE_TURN_SOUND_SRC);
  })();
};

const playSound = (src: string, startAtSeconds = 0, durationSeconds?: number) => {
  const audio = getSound(src);
  audio.volume = 1;
  audio.muted = false;

  const play = () => {
    audio.pause();
    audio.currentTime = startAtSeconds;
    void audio.play().catch(() => undefined);
    if (durationSeconds) {
      window.setTimeout(() => {
        audio.pause();
        audio.currentTime = startAtSeconds;
      }, durationSeconds * 1000);
    }
  };

  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
    play();
    return;
  }

  audio.addEventListener('loadedmetadata', play, { once: true });
  audio.load();
};

const playPageTurnSound = () => playSound(PAGE_TURN_SOUND_SRC);
const playPomodoroEndSound = () => {
  const context = getChimeContext();
  if (!context) {
    playPageTurnSound();
    return;
  }
  if (context.state === 'running') {
    ringChime(context);
    return;
  }
  context.resume().then(() => ringChime(context), () => playPageTurnSound());
};

const formatPageNumber = (value: number) => {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/\.?0+$/, '');
};

const calculateEndPageValue = (start: number, amount: number) => {
  const endPage = Number.isInteger(start) && Number.isInteger(amount)
    ? start + amount - 1
    : start + amount;
  return Number(endPage.toFixed(2));
};

const calculateSpeedChangePercent = (logs: StudyLog[]) => {
  const dailySamples = Array.from(
    logs
      .filter(log => log.pagesRead > 0 && log.timeSpentMinutes > 0)
      .reduce((map, log) => {
        const key = getLogStudyDate(log);
        const current = map.get(key) || { date: key, pages: 0, minutes: 0 };
        current.pages += log.pagesRead;
        current.minutes += log.timeSpentMinutes;
        map.set(key, current);
        return map;
      }, new Map<string, { date: string; pages: number; minutes: number }>())
      .values()
  ).sort((a, b) => a.date.localeCompare(b.date));

  if (dailySamples.length < 2) return null;

  const firstDay = dailySamples[0];
  const recentFourDays = dailySamples.slice(-4);
  const recentPages = recentFourDays.reduce((sum, day) => sum + day.pages, 0);
  const recentMinutes = recentFourDays.reduce((sum, day) => sum + day.minutes, 0);
  const firstTimePerPage = firstDay.pages > 0 ? firstDay.minutes / firstDay.pages : 0;
  const recentTimePerPage = recentPages > 0 ? recentMinutes / recentPages : 0;

  return firstTimePerPage > 0 && recentTimePerPage > 0
    ? ((firstTimePerPage / recentTimePerPage) - 1) * 100
    : null;
};

const formatReviewRange = (log: StudyLog, label = DEFAULT_PAGE_LABEL) => {
  if (typeof log.startPage === 'number' && typeof log.endPage === 'number') {
    return `${formatPageNumber(log.startPage)}~${formatPageNumber(log.endPage)}`;
  }
  return `${formatPageNumber(log.pagesRead)}${label}`;
};

const getReviewRange = (log: StudyLog) => {
  if (typeof log.startPage === 'number' && typeof log.endPage === 'number') {
    return {
      start: Math.min(log.startPage, log.endPage),
      end: Math.max(log.startPage, log.endPage)
    };
  }
  if (typeof log.endPage === 'number' && log.pagesRead > 0) {
    return {
      start: Math.max(1, log.endPage - log.pagesRead + 1),
      end: log.endPage
    };
  }
  return null;
};

const getAvailableReviewSubjectIds = (reviewSubjectIds: string[], parentSubject: Subject | undefined, sourceSubjects: Subject[]) => (
  Array.from(new Set(reviewSubjectIds))
    .filter(id => id !== parentSubject?.id && sourceSubjects.some(subject => (
      subject.id === id && (getSubjectRemainingPageCount(subject) > 0 || Boolean(subject.reviewStartPage))
    )))
);

const findReviewSubjectOwner = (reviewSubjectId: string, sourceSubjects: Subject[]) => {
  for (const subject of sourceSubjects) {
    if ((subject.reviewSubjectIds || []).includes(reviewSubjectId)) {
      return { subject, stageId: subject.id };
    }

    const followUp = (subject.followUpSubjects || []).find(stage => (
      (stage.reviewSubjectIds || []).includes(reviewSubjectId)
    ));
    if (followUp) return { subject, stageId: followUp.id };
  }

  return null;
};

const getReviewSubjectIdsForLog = (log: StudyLog, parentSubject: Subject | undefined, sourceSubjects: Subject[]) => {
  if (log.isRepeatReview) return sourceSubjects.some(subject => subject.id === log.subjectId) ? [log.subjectId] : [];
  const configuredIds = Array.isArray(log.reviewSubjectIdsSnapshot) && log.reviewSubjectIdsSnapshot.length > 0
    ? log.reviewSubjectIdsSnapshot
    : parentSubject
      ? getSubjectStageReviewSubjectIds(parentSubject, log.subjectStageId || parentSubject.id)
      : [];

  return getAvailableReviewSubjectIds(configuredIds, parentSubject, sourceSubjects);
};

const getEffectiveReviewSubjectId = (log: StudyLog, sourceSubjects: Subject[]) => {
  if (log.isRepeatReview) return log.subjectId;
  const ownerByLogSubject = findReviewSubjectOwner(log.subjectId, sourceSubjects);
  const parentSubject = sourceSubjects.find(subject => subject.id === log.subjectId)
    || ownerByLogSubject?.subject;
  const availableReviewSubjectIds = getReviewSubjectIdsForLog(log, parentSubject, sourceSubjects);

  if (log.reviewSubjectId) {
    if (availableReviewSubjectIds.includes(log.reviewSubjectId)) return log.reviewSubjectId;
    return availableReviewSubjectIds[0] || parentSubject?.id || log.subjectId;
  }

  if (ownerByLogSubject) return log.subjectId;

  return availableReviewSubjectIds[0] || log.subjectId;
};

const getReviewParentSubject = (log: StudyLog, reviewSubjectId: string, sourceSubjects: Subject[]) => {
  if (log.isRepeatReview) return sourceSubjects.find(subject => subject.id === log.reviewParentSubjectId);
  const directSubject = sourceSubjects.find(subject => subject.id === log.subjectId);
  if (directSubject) return directSubject;

  const ownerByLogSubject = findReviewSubjectOwner(log.subjectId, sourceSubjects);
  if (ownerByLogSubject) return ownerByLogSubject.subject;

  return findReviewSubjectOwner(reviewSubjectId, sourceSubjects)?.subject;
};

const compareReviewLogsByRange = (a: StudyLog, b: StudyLog) => {
  const rangeA = getReviewRange(a);
  const rangeB = getReviewRange(b);

  if (rangeA && rangeB) {
    return rangeA.start - rangeB.start || rangeA.end - rangeB.end;
  }
  if (rangeA) return -1;
  if (rangeB) return 1;

  return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
};

const sortReviewLogsByRange = (logs: StudyLog[]) => [...logs].sort(compareReviewLogsByRange);

const formatMergedReviewRanges = (logs: StudyLog[], label = DEFAULT_PAGE_LABEL) => {
  const merged = logs
    .map(getReviewRange)
    .filter((range): range is { start: number; end: number } => Boolean(range))
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .reduce<Array<{ start: number; end: number }>>((ranges, range) => {
      const previous = ranges[ranges.length - 1];
      if (previous && range.start <= previous.end + 1) {
        previous.end = Math.max(previous.end, range.end);
        return ranges;
      }
      ranges.push({ ...range });
      return ranges;
    }, []);

  if (merged.length === 0) return logs.map(log => formatReviewRange(log, label)).join(', ');
  return merged.map(range => `${formatPageNumber(range.start)}~${formatPageNumber(range.end)}`).join(', ');
};

const readReviewSessionPreferences = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(REVIEW_SESSION_PREF_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

const writeReviewSessionPreference = (subjectId: string, skipReview: boolean) => {
  const preferences = readReviewSessionPreferences();
  preferences[subjectId] = skipReview;
  localStorage.setItem(REVIEW_SESSION_PREF_KEY, JSON.stringify(preferences));
};

const readSessionMemoCollapsed = () => {
  return localStorage.getItem(SESSION_MEMO_COLLAPSED_KEY) === 'true';
};

const writeSessionMemoCollapsed = (collapsed: boolean) => {
  localStorage.setItem(SESSION_MEMO_COLLAPSED_KEY, String(collapsed));
};

const getMemoTextSize = (_text: string) => 'text-lg';

const AutoResizeTextarea = ({
  minHeight = 64,
  maxHeight,
  value,
  className = '',
  style,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minHeight?: number; maxHeight?: number }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const hasContent = String(value ?? '').trim().length > 0;
    textarea.style.height = '0px';
    const contentHeight = Math.max(minHeight + (hasContent ? 24 : 0), textarea.scrollHeight);
    const nextHeight = maxHeight ? Math.min(maxHeight, contentHeight) : contentHeight;
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = maxHeight && contentHeight > maxHeight ? 'auto' : 'hidden';
  }, [maxHeight, minHeight, value]);

  return (
    <textarea
      {...props}
      ref={textareaRef}
      value={value}
      className={`${className} resize-none`}
      style={{ ...style, minHeight, maxHeight }}
    />
  );
};

const getSubjectStudyPlanForDate = (
  subject: Subject,
  logs: StudyLog[],
  targetWeekday: number,
  targetStudyDate: string,
  today = new Date()
) => {
  const { scopedPages, remainingDayPages, carryoverPages } = getSubjectDayRemainingPages(
    subject,
    logs,
    targetWeekday,
    targetStudyDate,
    today
  );
  const subjectLogs = logs.filter(log => (
    log.subjectId === subject.id
    && log.pagesRead > 0
    && log.timeSpentMinutes > 0
  ));
  const measuredAverage = calculateRecentCompletedDayAverage(subjectLogs, remainingDayPages).averageTimePerPage;
  const averageTimePerPage = measuredAverage > 0
    ? measuredAverage
    : Math.max(0, subject.initialAverageTimePerPage || 0);
  const estimatedMinutes = remainingDayPages * averageTimePerPage;

  return {
    scopedPages,
    carryoverPages,
    remainingDayPages,
    averageTimePerPage,
    speedChangePercent: calculateSpeedChangePercent(subjectLogs),
    estimatedMinutes
  };
};

export const buildStudyOrderForDate = (
  sourceSubjects: Subject[],
  sourceLogs: StudyLog[],
  targetWeekday: number,
  targetStudyDate: string,
  today = new Date()
): StudyOrderItem[] => {
  const todayDateKey = getLocalDateKey(today);
  return sourceSubjects
    .filter(subject => getSubjectRemainingPageCount(subject) > 0)
    .map(subject => {
      const basePlan = getSubjectStudyPlanForDate(subject, sourceLogs, targetWeekday, targetStudyDate, today);
      if (getPlanningDayCount(getDiffDays(subject.targetDate, today)) < 7) {
        return { subject, ...basePlan };
      }
      // 지난날까지의 계획 대비 차이: 밀린 양은 오늘에 더해 쌓이고, 미리 한 양은 오늘 할 양에서 뺀다(29일 요청)
      const balance = getPastPlanBalance(subject, sourceLogs, targetStudyDate, todayDateKey);
      const rawCarryoverPages = Math.max(0, balance);
      const aheadPages = Math.max(0, -balance);
      const remainingSubjectPages = getSubjectRemainingPageCount(subject);
      const remainingBeforeStudyDate = remainingSubjectPages + basePlan.scopedPages;
      const dayTarget = getSubjectDayTarget(
        subject,
        remainingBeforeStudyDate,
        getDiffDays(subject.targetDate, today),
        targetWeekday,
        today
      );
      const carryoverPaidPages = Math.min(rawCarryoverPages, basePlan.scopedPages);
      const carryoverPages = Math.min(
        remainingSubjectPages,
        Math.max(0, rawCarryoverPages - carryoverPaidPages)
      );
      const activeDayPagesAfterCarryover = Math.max(0, basePlan.scopedPages - carryoverPaidPages);
      const currentDayRemainingPages = Math.max(0, dayTarget - aheadPages - activeDayPagesAfterCarryover);
      const remainingDayPages = Math.min(
        remainingSubjectPages,
        Math.max(0, carryoverPages + currentDayRemainingPages)
      );
      const estimatedMinutes = remainingDayPages * basePlan.averageTimePerPage;

      return {
        subject,
        ...basePlan,
        carryoverPages,
        remainingDayPages,
        estimatedMinutes
      };
    })
    .filter(item => item.remainingDayPages > 0)
    .sort((a, b) => {
      const requiredDiff = Number(isSubjectRequiredNow(b.subject)) - Number(isSubjectRequiredNow(a.subject));
      if (requiredDiff !== 0) return requiredDiff;

      const timeDiff = a.estimatedMinutes - b.estimatedMinutes;
      const knownTimeDiff = Number(a.averageTimePerPage <= 0) - Number(b.averageTimePerPage <= 0);
      if (knownTimeDiff !== 0) return knownTimeDiff;
      if (timeDiff !== 0) return timeDiff;

      const pagesDiff = a.remainingDayPages - b.remainingDayPages;
      if (pagesDiff !== 0) return pagesDiff;

      return a.subject.name.localeCompare(b.subject.name, 'ko');
    });
};

export const buildCompletedStudySubjectIds = (
  sourceSubjects: Subject[], sourceLogs: StudyLog[], targetWeekday: number, targetStudyDate: string, today = new Date()
) => {
  const recordedPages = new Map<string, number>();
  sourceLogs.filter(log => getLogStudyDate(log) === targetStudyDate && log.pagesRead > 0).forEach(log => {
    recordedPages.set(log.subjectId, (recordedPages.get(log.subjectId) || 0) + getLogProgressPages(log));
  });
  const subjectsBeforeToday = sourceSubjects.map(subject => adjustSubjectProgress(subject, -(recordedPages.get(subject.id) || 0)));
  const logsBeforeToday = sourceLogs.filter(log => getLogStudyDate(log) !== targetStudyDate);
  const plannedIds = new Set(buildStudyOrderForDate(subjectsBeforeToday, logsBeforeToday, targetWeekday, targetStudyDate, today).map(item => item.subject.id));
  const pendingIds = new Set(buildStudyOrderForDate(sourceSubjects, sourceLogs, targetWeekday, targetStudyDate, today).map(item => item.subject.id));
  return sourceSubjects.filter(subject => recordedPages.has(subject.id) && plannedIds.has(subject.id) && !pendingIds.has(subject.id)).map(subject => subject.id);
};

const getReviewGroupSignature = (logs: StudyLog[]) => (
  logs.map(log => log.id).sort().join('|')
);

export const buildDueReviewGroups = (
  sourceLogs: StudyLog[],
  sourceSubjects: Subject[],
  nowMs: number,
  handledRegularIds: Set<string> = new Set()
): ReviewQueueGroup[] => {
  const groups = new Map<string, ReviewQueueGroup>();

  const seenLogIds = new Set<string>();

  sourceLogs
    .filter(log => {
      const nextReviewTime = log.nextReviewDate ? new Date(log.nextReviewDate).getTime() : NaN;
      const isDue = log.reviewEnabled !== false
        && !log.isCondensed
        && Number.isFinite(nextReviewTime)
        && nextReviewTime <= nowMs;

      if (!isDue || seenLogIds.has(log.id) || handledRegularIds.has(log.id)) return false;
      // 삭제한 과목의 기록은 남지만(기록·통계 유지) 오늘 할 일의 복습으로는 올리지 않는다
      if (!sourceSubjects.some(subject => subject.id === log.subjectId)) return false;
      seenLogIds.add(log.id);
      return true;
    })
    .sort((a, b) => {
      const timeA = a.nextReviewDate ? new Date(a.nextReviewDate).getTime() : 0;
      const timeB = b.nextReviewDate ? new Date(b.nextReviewDate).getTime() : 0;
      return timeA - timeB;
    })
    .forEach(log => {
      const reviewSubjectId = getEffectiveReviewSubjectId(log, sourceSubjects);
      const parentSubject = getReviewParentSubject(log, reviewSubjectId, sourceSubjects);
      const parentSubjectId = parentSubject?.id || log.subjectId;
      const subject = sourceSubjects.find(item => item.id === reviewSubjectId);
      const subjectName = subject?.name || log.subjectNameSnapshot || '삭제된 과목';
      const parentSubjectName = parentSubject?.name || log.subjectNameSnapshot || subjectName;
      const reviewType = reviewSubjectId === parentSubjectId ? 'basic' : 'subject';
      const reviewSubjectIds = getReviewSubjectIdsForLog(log, parentSubject, sourceSubjects);
      const reviewTime = log.nextReviewDate ? new Date(log.nextReviewDate).getTime() : nowMs;
      const reviewSequenceKey = reviewSubjectIds.join('>') || 'basic';
      const gateCompleted = log.reviewGatePendingSteps !== undefined || log.reviewGatePendingResult !== undefined || Boolean(log.reviewSubjectId);
      const groupId = `${parentSubjectId}:${reviewSubjectId}:${reviewSequenceKey}:${gateCompleted ? 'subjects' : 'gate'}${log.isRepeatReview ? `:repeat:${log.id}` : ''}`;
      const group = groups.get(groupId) || {
        id: groupId,
        parentSubjectId,
        parentSubjectName,
        subjectId: reviewSubjectId,
        subjectName,
        subject,
        reviewType,
        reviewSubjectIds,
        logs: [],
        earliestReviewTime: reviewTime,
        averageTimePerPage: 0,
        estimatedMinutes: 0
      };

      group.logs.push(log);
      group.reviewSubjectIds = Array.from(new Set([...group.reviewSubjectIds, ...reviewSubjectIds]));
      group.earliestReviewTime = Math.min(group.earliestReviewTime, reviewTime);
      groups.set(groupId, group);
    });

  getDueReviewGateRetries(sourceLogs, nowMs).forEach(log => {
    const subject = sourceSubjects.find(item => item.id === log.subjectId);
    if (!subject) return;
    const subjectName = subject?.name || log.subjectNameSnapshot || '삭제된 과목';
    const groupId = `gate-retry:${log.subjectId}`;
    const retry = log.reviewGateRetry!;
    const reviewTime = Date.parse(retry.dueAt);
    const group: ReviewQueueGroup = groups.get(groupId) || {
      id: groupId,
      parentSubjectId: log.subjectId,
      parentSubjectName: subjectName,
      subjectId: log.subjectId,
      subjectName,
      subject,
      reviewType: 'basic',
      isGateRetry: true,
      reviewSubjectIds: [],
      logs: [],
      earliestReviewTime: reviewTime,
      averageTimePerPage: 0,
      estimatedMinutes: 0
    };
    group.logs.push({ ...log, reviewStep: retry.reviewStep });
    group.earliestReviewTime = Math.min(group.earliestReviewTime, reviewTime);
    groups.set(groupId, group);
  });

  const rangeScopedGroups = Array.from(groups.values()).flatMap(group => {
    if (group.isGateRetry || group.reviewType !== 'subject') return [group];

    const clusters = sortReviewLogsByRange(group.logs).reduce<StudyLog[][]>((result, log) => {
      const range = getReviewRange(log);
      const currentCluster = result[result.length - 1];
      const previousRange = currentCluster?.length
        ? getReviewRange(currentCluster[currentCluster.length - 1])
        : null;

      if (currentCluster && range && previousRange && range.start <= previousRange.end + 1) {
        currentCluster.push(log);
      } else {
        result.push([log]);
      }
      return result;
    }, []);

    return clusters.map((clusterLogs, index) => ({
      ...group,
      id: `${group.id}:range-${index}`,
      logs: clusterLogs,
      earliestReviewTime: Math.min(...clusterLogs.map(log => (
        log.nextReviewDate ? Date.parse(log.nextReviewDate) : group.earliestReviewTime
      )))
    }));
  });

  return rangeScopedGroups
    .map(group => {
      const subjectReviewTiming = group.reviewType === 'subject'
        ? calculateReviewSubjectTiming(
          sourceLogs,
          group.parentSubjectId,
          group.subjectId,
          sourceSubjects,
          group.logs,
          group.reviewSubjectIds
        )
        : null;
      const basicReviewTiming = group.reviewType === 'basic'
        ? calculateBasicReviewGroupTiming(
          sourceLogs,
          group.parentSubjectId,
          sourceSubjects,
          group.logs
        )
        : null;
      const estimatedMinutes = basicReviewTiming?.estimatedMinutes
        ?? subjectReviewTiming?.estimatedMinutes ?? 0;
      const averageTimePerPage = basicReviewTiming?.averageTimePerPage
        ?? subjectReviewTiming?.averageTimePerPage ?? 0;

      return {
        ...group,
        logs: sortReviewLogsByRange(group.logs),
        averageTimePerPage,
        estimatedMinutes
      };
    })
    .sort((a, b) => {
      const requiredDiff = Number(isSubjectRequiredNow(b.subject)) - Number(isSubjectRequiredNow(a.subject));
      if (requiredDiff !== 0) return requiredDiff;

      const knownTimeDiff = Number(a.averageTimePerPage <= 0) - Number(b.averageTimePerPage <= 0);
      if (knownTimeDiff !== 0) return knownTimeDiff;

      const timeDiff = a.estimatedMinutes - b.estimatedMinutes;
      if (timeDiff !== 0) return timeDiff;

      const reviewTimeDiff = a.earliestReviewTime - b.earliestReviewTime;
      if (reviewTimeDiff !== 0) return reviewTimeDiff;

      return a.subjectName.localeCompare(b.subjectName, 'ko');
    });
};

const reviewGroupBaseId = (group: ReviewQueueGroup) => group.id.replace(/:range-\d+$/, '');

/**
 * 오늘 할 일 칸으로 올리기 전에 같은 종류의 복습을 한 묶음으로 합친다. 학습 · 기본 복습 · 복습과목은 따로따로 칸이다.
 *  - 기본 복습: 같은 과목은 한 칸(그 과목의 대기 중인 기본 복습 기록을 모두 합친다). 같은 과목이 여러 칸 나오지 않는다.
 *  - 복습과목: 범위로만 나뉜 복습(같은 복습과목 · 같은 순서 · 같은 관문 상태)은 한 칸으로 합치고, 원래의 범위별 묶음은 rangeGroups에 둔다.
 *  - 오답 복습과 반복 복습은 합치지 않는다.
 * 칸의 순서는 합치기 전 가장 앞선 묶음의 자리를 따른다.
 */
export const mergeQueueReviewGroups = (groups: ReviewQueueGroup[], sourceLogs: StudyLog[], sourceSubjects: Subject[]): ReviewQueueGroup[] => {
  const slots: Array<ReviewQueueGroup | { bucket: ReviewQueueGroup[] }> = [];
  const buckets = new Map<string, ReviewQueueGroup[]>();
  groups.forEach(group => {
    const key = group.isGateRetry || group.logs.some(log => log.isRepeatReview) ? null
      : group.reviewType === 'basic' ? `basic:${group.parentSubjectId}` : `subject:${reviewGroupBaseId(group)}`;
    if (!key) { slots.push(group); return; }
    let bucket = buckets.get(key);
    if (!bucket) { bucket = []; buckets.set(key, bucket); slots.push({ bucket }); }
    bucket.push(group);
  });
  const combine = (bucket: ReviewQueueGroup[]): ReviewQueueGroup => {
    if (bucket.length === 1) return bucket[0];
    const [first] = bucket;
    const seen = new Set<string>();
    const logs = sortReviewLogsByRange(bucket.flatMap(group => group.logs).filter(log => (seen.has(log.id) ? false : (seen.add(log.id), true))));
    const reviewSubjectIds = Array.from(new Set(bucket.flatMap(group => group.reviewSubjectIds)));
    const timing = first.reviewType === 'basic'
      ? calculateBasicReviewGroupTiming(sourceLogs, first.parentSubjectId, sourceSubjects, logs)
      : calculateReviewSubjectTiming(sourceLogs, first.parentSubjectId, first.subjectId, sourceSubjects, logs, reviewSubjectIds);
    return {
      ...first,
      id: first.reviewType === 'basic' ? `${first.parentSubjectId}:basic:all` : `${reviewGroupBaseId(first)}:all`,
      logs,
      reviewSubjectIds,
      earliestReviewTime: Math.min(...bucket.map(group => group.earliestReviewTime)),
      estimatedMinutes: timing?.estimatedMinutes ?? bucket.reduce((sum, group) => sum + Math.max(0, group.estimatedMinutes), 0),
      averageTimePerPage: timing?.averageTimePerPage ?? first.averageTimePerPage,
      ...(first.reviewType === 'subject' ? { rangeGroups: bucket } : {})
    };
  };
  return slots.map(slot => ('bucket' in slot ? combine(slot.bucket) : slot));
};

const formatPlanMinutes = (minutes: number) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0분';
  // 올림을 먼저 해야 119.5분이 "1시간 60분"이 아니라 "2시간"이 된다
  const total = Math.ceil(minutes);
  if (total < 60) return `${total}분`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest > 0 ? `${hours}시간 ${rest}분` : `${hours}시간`;
};

export const buildStudyRunQueue = (reviewGroups: ReviewQueueGroup[], studyOrder: StudyOrderItem[]): StudyRunQueueItem[] => {
  const reviewItems: StudyRunQueueItem[] = reviewGroups.map(group => ({
    kind: 'review', key: `review-${group.id}`, reviewGroup: group,
    isRequired: isSubjectRequiredNow(group.subject), estimatedMinutes: group.estimatedMinutes, name: group.subjectName
  }));
  const studyItems: StudyRunQueueItem[] = studyOrder.map(item => ({
    kind: 'study', key: `study-${item.subject.id}`, studyItem: item,
    isRequired: isSubjectRequiredNow(item.subject), estimatedMinutes: item.estimatedMinutes, name: item.subject.name
  }));
  return [...reviewItems, ...studyItems].sort((a, b) => (
    Number(a.kind !== 'review') - Number(b.kind !== 'review')
    || Number(b.isRequired) - Number(a.isRequired)
    || Number(a.estimatedMinutes <= 0) - Number(b.estimatedMinutes <= 0)
    || a.estimatedMinutes - b.estimatedMinutes
    || a.name.localeCompare(b.name, 'ko')
  ));
};

export const SessionLogger: React.FC<Props> = ({ subjects, logs, activeWeekday: liveWeekday, activeStudyDate: liveStudyDate, detailSubjectId, onDetailSubjectChange, renderSummary, onLogSession, onUpdateSubjects, onReviewAction, onAdvanceReviewSubject, onRecordReviewSubjectTime, onUpdateReviewMemo, onRemoveReviewQuestions, onRestoreReviewQuestion, onFinishReviewGate, onClearReviewGateRetries, sessionMemoOverrides }) => {
  const reviewSubjectIdSet = useMemo(() => (
    new Set(subjects.flatMap(getAllSubjectReviewIds))
  ), [subjects]);
  const followUpSourceSubjectIdSet = useMemo(() => (
    new Set(subjects.flatMap(subject => (
      (subject.followUpSubjects || []).flatMap(stage => stage.sourceSubjectId ? [stage.sourceSubjectId] : [])
    )))
  ), [subjects]);
  const ordinarySubjects = useMemo(
    () => subjects.filter(subject => (
      !reviewSubjectIdSet.has(subject.id) && !followUpSourceSubjectIdSet.has(subject.id)
    )),
    [followUpSourceSubjectIdSet, reviewSubjectIdSet, subjects]
  );
  const [step, setStep] = useState<Step>('idle');
  // 공부를 시작한 날: 측정 중에 자정이 지나도 이번 기록은 시작한 날의 공부로 남긴다(끝나고 홈으로 돌아오면 새 날로 바뀐다)
  const sessionDayRef = useRef<{ date: string; weekday: number } | null>(null);
  if (step === 'idle') sessionDayRef.current = null;
  else if (!sessionDayRef.current) sessionDayRef.current = { date: liveStudyDate, weekday: liveWeekday };
  const activeStudyDate = sessionDayRef.current?.date ?? liveStudyDate;
  const activeWeekday = sessionDayRef.current?.weekday ?? liveWeekday;
  const [subjectId, setSubjectId] = useState('');
  const [activeReviewRun, setActiveReviewRun] = useState<ActiveReviewRun | null>(null);
  const selectedSubject = subjects.find(subject => subject.id === subjectId);
  const isSubjectReviewDisabled = selectedSubject?.reviewEnabled === false;
  const pageLabel = getPageLabel(selectedSubject);
  const pagePos = pagePositionLabel(pageLabel);
  const activeReviewRunLogs = activeReviewRun
    ? logs.filter(log => activeReviewRun.logIds.includes(log.id))
    : [];
  const activeReviewRunMemoItems = sortReviewLogsByRange(activeReviewRunLogs)
    .map(log => ({
      id: log.id,
      range: formatReviewRange(log, pageLabel),
      memo: log.reviewMemo || '',
      document: log.reviewMemoDocument
    }))
    .filter(item => item.memo.trim().length > 0);
  const nextReviewRunSubjectId = activeReviewRun
    ? activeReviewRun.reviewSubjectIds[activeReviewRun.currentIndex + 1] || null
    : null;
  const nextReviewRunSubject = nextReviewRunSubjectId
    ? subjects.find(subject => subject.id === nextReviewRunSubjectId)
    : undefined;

  const [startPage, setStartPage] = useState('');
  const [readAmount, setReadAmount] = useState('');
  const [solvedPageCount, setSolvedPageCount] = useState('');
  /** 과목을 끝낸 뒤 고른 난도 피드백. 고르지 않으면 속도로 권한 평가(없으면 보통)로 저장한다. */
  const [feedbackChoice, setFeedbackChoice] = useState<SubjectGrade | null>(null);
  // 기본 복습(복습과목 없음)을 마칠 때 고른 난도. 고르지 않으면 추천(없으면 보통)
  const [basicFeedbackChoice, setBasicFeedbackChoice] = useState<SubjectGrade | null>(null);
  const [initialReadAmount, setInitialReadAmount] = useState('');
  const [skipReview, setSkipReview] = useState(false);
  const [minutes, setMinutes] = useState(0);
  const [timerMode, setTimerMode] = useState<TimerMode>('remainingPages');
  const [seconds, setSeconds] = useState(0);
  const [studySeconds, setStudySeconds] = useState(0);
  const [organizationSeconds, setOrganizationSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [sessionMemo, setSessionMemo] = useState('');
  const [reviewMemo, setReviewMemo] = useState('');
  const [reviewMemoDocument, setReviewMemoDocument] = useState<ReviewMemoDocument>();
  // 이어 쓰는 노트지: 학습을 시작할 때 이어 붙여 채운 기록들과, 저장할 때 고쳐진 이전 기록의 노트
  const sheetPartsRef = useRef<SheetPart[]>([]);
  const sheetUpdatesRef = useRef<SheetUpdate[]>([]);
  const [colorMemoColons, setColorMemoColons] = useState(() => localStorage.getItem('swp_memo_colon_colors') !== 'false');
  const [isReviewNotePanelOpen, setIsReviewNotePanelOpen] = useState(false);
  const [showNoteTutorial, setShowNoteTutorial] = useState(false);
  const [isReviewCondensePanelOpen, setIsReviewCondensePanelOpen] = useState(false);
  const [isMemoCollapsed, setIsMemoCollapsed] = useState(readSessionMemoCollapsed);
  const [selectedTaskKey, setSelectedTaskKey] = useState('');
  // 범위로 나뉜 복습 칸에서 지금 보는 탭(칸 키 → 범위 번호, 없거나 -1이면 전체)
  const [rangeTabs, setRangeTabs] = useState<Record<string, number>>({});
  const [inspectedRecordDetailId, setInspectedRecordDetailId] = useState('');
  const [selectedSessionTimerId, setSelectedSessionTimerId] = useState('none');
  const [attackCompletedPages, setAttackCompletedPages] = useState(0);
  const [pageElapsedSeconds, setPageElapsedSeconds] = useState(0);
  const [pageAttackTargetSeconds, setPageAttackTargetSeconds] = useState(0);
  const [sessionTimerSeconds, setSessionTimerSeconds] = useState<Record<string, number>>({});
  const [sessionTimerCompletedSeconds, setSessionTimerCompletedSeconds] = useState<Record<string, number>>({});
  const [sessionTimerPages, setSessionTimerPages] = useState<Record<string, number>>({});
  const [sessionTimerPageSeconds, setSessionTimerPageSeconds] = useState<Record<string, number[]>>({});
  const [preSessionReviewLogs, setPreSessionReviewLogs] = useState<StudyLog[]>([]);
  const [preSessionReviewDrafts, setPreSessionReviewDrafts] = useState<Record<string, string>>({});
  const [preSessionReviewSeconds, setPreSessionReviewSeconds] = useState(0);
  const [preSessionReviewTargetSeconds, setPreSessionReviewTargetSeconds] = useState(0);
  const [preSessionReviewParentSubjectId, setPreSessionReviewParentSubjectId] = useState('');
  const [preSessionReviewGroup, setPreSessionReviewGroup] = useState<ReviewQueueGroup | null>(null);
  const [isPreSessionReviewRunning, setIsPreSessionReviewRunning] = useState(false);
  const [preSessionReviewSubjectName, setPreSessionReviewSubjectName] = useState('');
  const [preSessionReviewMode, setPreSessionReviewMode] = useState<PreSessionReviewMode>('before-study');
  const [gatePractice, setGatePractice] = useState<ReviewPractice | null>(null);
  // 이번 복습에서 뺀(또는 고쳐서 건너뛴) 문제 칸 번호와, 바로 되돌릴 수 있는 안내
  const [gateDroppedIds, setGateDroppedIds] = useState<string[]>([]);
  const [gateRemovalNotice, setGateRemovalNotice] = useState<{ kind: 'removed'; ids: string[]; reason: ReviewRemovedReason; covers: RemovalCover[]; text: string } | { kind: 'edited'; text: string } | null>(null);
  const gateQuestionQueue = gatePractice?.queue || [];
  const gateRoundQuestionCount = gatePractice?.roundSize || 0;
  const gateRoundAnsweredCount = gatePractice?.roundAnswered || 0;
  const gateRoundNumber = gatePractice?.round || 1;
  const gateStartedAtRef = useRef(0);
  const [isGateAnswerRevealed, setIsGateAnswerRevealed] = useState(false);
  const [resumeStudyTimerAfterReview, setResumeStudyTimerAfterReview] = useState(false);
  const [dismissedReviewSignature, setDismissedReviewSignature] = useState('');
  const [handledReviewLogIds, setHandledReviewLogIds] = useState<string[]>([]);
  const [, setPostSaveNextSubjectId] = useState<string | null>(null);
  const [pendingImmediateStartSubjectId, setPendingImmediateStartSubjectId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pendingAutoAdvanceLogId, setPendingAutoAdvanceLogId] = useState<string | null>(null);

  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const accumulatedSecondsRef = useRef(0);
  const lastAttackSecondRef = useRef(0);
  const activeTimerSecondsRef = useRef<Record<string, number>>({});
  const activeTimerCompletedSecondsRef = useRef<Record<string, number>>({});
  const activeTimerPagesRef = useRef<Record<string, number>>({});
  const activeTimerPageSecondsRef = useRef<Record<string, number[]>>({});
  const currentPageMeasuredSecondsRef = useRef(0);
  const selectedSessionTimerIdRef = useRef('none');
  const gateQuestionCardRef = useRef<HTMLDivElement | null>(null);

  const preSessionGateMemoItems = useMemo(() => (
    sortReviewLogsByRange(preSessionReviewLogs).map(log => {
      const memo = preSessionReviewDrafts[log.id] ?? log.reviewMemo ?? '';
      return {
        log,
        memo,
        range: formatReviewRange(log, pageLabel),
        parsed: withLogShorthand(log, () => parseReviewGateMemo(memo)),
        criterion: createSessionMemoRecord(sessionMemoOverrides?.[log.subjectId] ?? readSessionMemos()[log.subjectId] ?? '').classificationCriterion
      };
    }).filter(item => item.memo.trim().length > 0)
  ), [preSessionReviewDrafts, preSessionReviewLogs, sessionMemoOverrides, sessionMemo]);

  const gateReviewQuestions = useMemo<GateReviewQuestion[]>(() => {
    const isRetry = Boolean(preSessionReviewGroup?.isGateRetry);
    const pending = preSessionGateMemoItems.flatMap(item => {
      const keys = isRetry
        ? new Set(getReviewGateRetryKeys(item.log))
        : new Set(getDueReviewGateQuestionKeys(item.log, gateStartedAtRef.current, true));
      return item.parsed.questions.filter(question => keys.has(question.key)).map(question => ({ item, question }));
    });
    const toGate = (item: typeof preSessionGateMemoItems[number], question: NoteQuestion): GateReviewQuestion => ({
      id: `${item.log.id}:${question.key}`,
      questionKey: question.key,
      logId: item.log.id,
      range: item.range,
      level: question.level,
      priority: question.priority,
      recallUnits: question.recallUnits,
      providedUnits: question.providedUnits,
      difficulty: question.difficulty,
      importance: question.importance,
      blankStart: question.blankStart
    });
    // 능력 변환 단위 문제는 같이 복습할 때가 된 것끼리 결합한다(같은 복습에 모인 다른 노트·과목의 노트와도 이어진다). 오답 복습은 낱개 그대로 낸다.
    const candidates = isRetry ? [] : pending
      .filter(({ question }) => question.kind === 'convert' && question.convert?.form === 'unit' && !question.convert.variation)
      .map(({ item, question }) => {
        const schedule = getReviewQuestionSchedules(item.log)[question.key];
        return { logId: item.log.id, question, state: { freedom: schedule?.freedom || 0, reps: schedule?.fsrs?.reps ?? schedule?.reviewStep ?? 0 } };
      });
    const plan = planConvertReview(candidates);
    const itemOf = new Map(preSessionGateMemoItems.map(item => [item.log.id, item] as const));
    const stateOf = new Map(candidates.map(candidate => [`${candidate.logId}\u0000${candidate.question.key}`, candidate.state] as const));
    // 보통 문제는 관계쌍으로 묶어 쌍마다 한 문제만 낸다(자유도가 오르면 한 문제가 이웃 쌍까지 덮는다). 오답 다시 풀기는 낱개 그대로.
    const pairPlan = isRetry ? { planned: [], absorbed: new Set<string>() } : planPairReview(pending
      .filter(({ question }) => question.kind !== 'convert' && question.kind !== 'recall')
      .map(({ item, question }) => ({ logId: item.log.id, question, freedom: getReviewQuestionSchedules(item.log)[question.key]?.freedom || 0 })));
    const pairLead = new Map(pairPlan.planned.map(planned => [`${planned.logId}\u0000${planned.question.key}`, planned] as const));
    const singles = pending
      .filter(({ item, question }) => !plan.absorbed.has(`${item.log.id}\u0000${question.key}`) && !pairPlan.absorbed.has(`${item.log.id}\u0000${question.key}`))
      .map(({ item, question }) => {
        // 자유도가 1 이상인 능력 변환 단위는 출력 값의 `숫자 기호 숫자`를 계산된 값으로 보인다(`3*(sin x)^(3-1)` → `3*(sin x)^2`)
        const state = stateOf.get(`${item.log.id}\u0000${question.key}`);
        const shown = state ? foldConvertUnit(question, state) : question;
        const lead = pairLead.get(`${item.log.id}\u0000${question.key}`);
        if (lead) return { ...toGate(item, question), covered: lead.covered, bundled: true };
        return shown === question ? toGate(item, question) : { ...toGate(item, question), presentation: shown };
      });
    const combined = plan.planned.map((planned): GateReviewQuestion => {
      const first = itemOf.get(planned.covered[0].logId)!;
      const levels = planned.covered.map(cover => pending.find(entry => entry.item.log.id === cover.logId && entry.question.key === cover.questionKey)?.question.level ?? 1);
      const ranges = Array.from(new Set(planned.covered.map(cover => itemOf.get(cover.logId)!.range))).join(' · ');
      return { ...toGate(first, planned.question), level: Math.max(...levels), range: ranges, covered: planned.covered, presentation: planned.question };
    });
    const dropped = new Set(gateDroppedIds);
    return [...singles, ...combined].filter(question => !dropped.has(question.id));
  }, [preSessionGateMemoItems, preSessionReviewGroup?.isGateRetry, gateDroppedIds]);

  const gateReviewQuestionSignature = gateReviewQuestions.map(question => question.id).join('|');
  const currentGateQuestion = gateReviewQuestions.find(question => question.id === gateQuestionQueue[0]);
  const isGateReviewComplete = gatePractice !== null && gateQuestionQueue.length === 0;
  const gateWrongCount = Object.values(gatePractice?.wrongCounts || {}).filter(count => count > 0).length;
  const currentGateMemoItem = currentGateQuestion
    ? preSessionGateMemoItems.find(item => item.log.id === currentGateQuestion.logId)
    : undefined;
  // `=`·`-` 단축어는 과목마다다: 복습 중에는 지금 문제의 과목, 아니면 고른 과목(복습 묶음이면 그 묶음의 과목)으로 노트를 읽는다
  const noteShorthandSubjectId = currentGateMemoItem?.log.subjectId ?? (subjectId || preSessionReviewParentSubjectId || null);
  const noteShorthand = useSubjectNoteShorthand(noteShorthandSubjectId);
  const toggleNoteShorthand = () => {
    const target = subjects.find(subject => subject.id === noteShorthandSubjectId);
    if (target && onUpdateSubjects) onUpdateSubjects([{ ...target, noteShorthand: !noteShorthand }]);
    else setNoteShorthand(!noteShorthand);
  };

  // 걸린 시간: 문제가 보인 때부터 정답을 확인하기까지(잠시 중단한 시간은 뺀다). 첫 시도의 시간만 기록해 난도 추천과 다음 추천에 쓴다.
  const gateShownAtRef = useRef(0);
  const gatePausedAtRef = useRef(0);
  const gateFirstResponseMsRef = useRef<Record<string, number>>({});
  const [gateRevealMs, setGateRevealMs] = useState<number | null>(null);
  useEffect(() => {
    gateShownAtRef.current = Date.now();
    gatePausedAtRef.current = 0;
    setGateRevealMs(null);
  }, [currentGateQuestion?.id, gateRoundNumber]);
  useEffect(() => {
    // 문제가 떠 있는 동안 잠시 중단한 시간만 걸린 시간에서 뺀다(복습을 열기 전의 시간은 세지 않는다)
    if (!currentGateQuestion) { gatePausedAtRef.current = 0; return; }
    if (!isPreSessionReviewRunning) { if (!gatePausedAtRef.current) gatePausedAtRef.current = Date.now(); return; }
    if (gatePausedAtRef.current) {
      gateShownAtRef.current += Date.now() - gatePausedAtRef.current;
      gatePausedAtRef.current = 0;
    }
  }, [isPreSessionReviewRunning, currentGateQuestion?.id, gateRoundNumber]);

  const todayStudyOrder = useMemo(
    () => buildStudyOrderForDate(ordinarySubjects, logs, activeWeekday, activeStudyDate),
    [activeStudyDate, activeWeekday, logs, ordinarySubjects]
  );

  const rawDueReviewGroups = useMemo(
    () => buildDueReviewGroups(logs, subjects, nowMs),
    [logs, nowMs, subjects]
  );

  const dueReviewGroups = useMemo(() => {
    const handledIds = new Set(handledReviewLogIds);
    return buildDueReviewGroups(
      logs,
      subjects,
      nowMs,
      handledIds
    );
  }, [handledReviewLogIds, logs, nowMs, subjects]);

  // 오늘 끝낸 복습 칸에서 "추가 학습하기"를 누르면 앞당겨 할 복습: 아직 기한이 안 된 복습까지 모두 모아, 칸(상세 키)마다 가장 이른 것 하나.
  // 오늘 이미 한 복습 기록(handledReviewLogIds)과 오답 복습(기한이 정해져 있다)은 빼고, 모든 복습을 마쳤으면 그 칸에는 없다.
  const extraReviewGroups = useMemo(() => {
    const groups = new Map<string, ReviewQueueGroup>();
    buildDueReviewGroups(logs, subjects, Number.MAX_SAFE_INTEGER, new Set(handledReviewLogIds)).forEach(group => {
      if (group.isGateRetry) return;
      const key = getReviewDetailKey(group.reviewType, group.parentSubjectId, group.subjectId);
      if (!groups.has(key)) groups.set(key, group);
    });
    return groups;
  }, [handledReviewLogIds, logs, subjects]);

  const todayStudyPlanMap = useMemo(() => (
    new Map(todayStudyOrder.map(item => [item.subject.id, item]))
  ), [todayStudyOrder]);

  const [pomodoroMinutes] = usePomodoroMinutes();
  const runQueueItems = useMemo(
    () => buildStudyRunQueue(mergeQueueReviewGroups(dueReviewGroups, logs, subjects), todayStudyOrder),
    [dueReviewGroups, todayStudyOrder, logs, subjects]
  );
  const selectedRunQueueItem = getRunQueueCellLead(runQueueItems, getSelectedRunQueueItem(runQueueItems, selectedTaskKey));
  const idlePomodoroPlan: PomodoroPlan | null = selectedRunQueueItem ? (() => {
    const taskSubject = selectedRunQueueItem.kind === 'study' ? selectedRunQueueItem.studyItem.subject : selectedRunQueueItem.reviewGroup.subject;
    if (!taskSubject) return null;
    const repeatLog = selectedRunQueueItem.kind === 'review' ? selectedRunQueueItem.reviewGroup.logs.find(log => log.isRepeatReview) : undefined;
    return { subjectId: taskSubject.id, minutes: pomodoroMinutes,
      remainingTaskPages: selectedRunQueueItem.kind === 'study' ? selectedRunQueueItem.studyItem.remainingDayPages
        : selectedRunQueueItem.reviewGroup.averageTimePerPage > 0
          ? selectedRunQueueItem.reviewGroup.estimatedMinutes / selectedRunQueueItem.reviewGroup.averageTimePerPage
          : selectedRunQueueItem.reviewGroup.logs.reduce((sum, log) => sum + log.pagesRead, 0),
      pages: getPomodoroPageTarget(selectedRunQueueItem.kind === 'study'
        ? selectedRunQueueItem.studyItem.averageTimePerPage : selectedRunQueueItem.reviewGroup.averageTimePerPage,
        repeatLog ? getRepeatedReviewRange(repeatLog, taskSubject).remainingPages : getMeasurementRemainingPages(taskSubject), pomodoroMinutes) };
  })() : null;
  const completedStudySubjectIds = useMemo(() => buildCompletedStudySubjectIds(
    ordinarySubjects, logs, activeWeekday, activeStudyDate
  ), [ordinarySubjects, logs, activeWeekday, activeStudyDate]);

  const selectSubjectForMeasurement = (subject: Subject) => {
    setSubjectId(subject.id);
  };

  const selectedSubjectLogs = useMemo(
    () => logs.filter(log => log.subjectId === subjectId && log.pagesRead > 0 && log.timeSpentMinutes > 0),
    [logs, subjectId]
  );

  const activeSubjectStage = selectedSubject ? (activeReviewRun?.stageId
    ? getSubjectStages(selectedSubject).find(stage => stage.id === activeReviewRun.stageId) || getActiveSubjectStage(selectedSubject)
    : getActiveSubjectStage(selectedSubject)) : null;
  const aggregateRemainingSubjectPages = selectedSubject ? getSubjectRemainingPageCount(selectedSubject) : 0;
  const reviewStartPage = activeReviewRun?.startPage ?? (selectedSubject ? getReviewStartPage(selectedSubject) || 1 : 1);
  const remainingSubjectPages = activeReviewRun
    ? Math.max(0, (activeSubjectStage?.endPage || selectedSubject?.totalPages || 0) - reviewStartPage + 1)
    : activeSubjectStage?.remainingPages || 0;
  // 단원이 있는 본 과목 단계를 공부 중이면 끝 페이지·푼 장수·진척도가 단원 사이를 건너뛰어 계산된다(복습 범위에는 적용되지 않는다)
  const stageChapters = useMemo(
    () => (selectedSubject && !activeReviewRun ? getStageChapters(selectedSubject, activeSubjectStage) : []),
    [selectedSubject, activeReviewRun, activeSubjectStage]
  );
  // 난도 피드백: 같은 과목의 지난 기록으로 평균 속도와 그때 고른 평가를 모으고, 이번 속도로 평가를 권한다.
  const feedbackKind: FeedbackKind = activeReviewRun ? 'review' : 'study';
  const feedbackInfo = useMemo(() => {
    if (step !== 'pages' || !subjectId) return null;
    const measurement = createPageMeasurement(parseFloat(startPage), parseFloat(readAmount), Number(solvedPageCount), remainingSubjectPages, stageChapters);
    const speed = speedPerHour(measurement?.pagesRead ?? 0, getSessionTimes(studySeconds, organizationSeconds).timeSpentMinutes);
    const summary = summarizeSpeedFeedback(pastSessions(logs, subjectId, feedbackKind));
    // 복습과목은 앞서 푼 복습 문제들의 첫 답변 중 가장 많은 등급을 추천한다(28일 요청). 문제가 없었으면 전처럼 속도로 권한다
    const fromQuestions = activeReviewRun?.questionGrade ?? null;
    return { speed, summary, recommended: fromQuestions ?? recommendSubjectGrade(speed, summary.averageSpeed), fromQuestions };
  }, [step, subjectId, startPage, readAmount, solvedPageCount, remainingSubjectPages, stageChapters, studySeconds, organizationSeconds, logs, feedbackKind, activeReviewRun]);
  const activeDaySubjectPages = useMemo(
    () => logs
      .filter(log => log.subjectId === subjectId && getLogStudyDate(log) === activeStudyDate)
      .reduce((sum, log) => sum + log.pagesRead, 0),
    [activeStudyDate, logs, subjectId]
  );

  const recommendedDailyPages = useMemo(() => {
    if (!selectedSubject) return 0;
    const selectedPlan = todayStudyPlanMap.get(selectedSubject.id);
    if (selectedPlan) return Math.min(aggregateRemainingSubjectPages, selectedPlan.remainingDayPages);

    const today = new Date();
    const remainingBeforeActiveDay = aggregateRemainingSubjectPages + activeDaySubjectPages;
    const diffDays = getDiffDays(selectedSubject.targetDate, today);
    const dayTarget = getSubjectDayTarget(selectedSubject, remainingBeforeActiveDay, diffDays, activeWeekday, today);
    return Math.min(aggregateRemainingSubjectPages, Math.max(0, dayTarget - activeDaySubjectPages));
  }, [activeDaySubjectPages, activeWeekday, aggregateRemainingSubjectPages, selectedSubject, todayStudyPlanMap]);

  const overallAverage = useMemo(() => {
    const measuredAverage = calculateRecentCompletedDayAverage(
      selectedSubjectLogs,
      recommendedDailyPages
    ).averageTimePerPage;
    return measuredAverage > 0
      ? measuredAverage
      : Math.max(0, selectedSubject?.initialAverageTimePerPage || 0);
  }, [selectedSubject, selectedSubjectLogs, recommendedDailyPages]);

  const activeReviewTiming = useMemo(() => {
    if (!activeReviewRun || !selectedSubject) return null;
    return calculateReviewSubjectTiming(
      logs,
      activeReviewRun.parentSubjectId,
      selectedSubject.id,
      subjects,
      logs.filter(log => activeReviewRun.logIds.includes(log.id)),
      activeReviewRun.reviewSubjectIds
    );
  }, [activeReviewRun, logs, selectedSubject, subjects]);

  const averageTimePerPage = activeReviewRun ? activeReviewTiming?.averageTimePerPage || 0 : overallAverage;
  const activeReviewAttackTiming = useMemo(() => activeReviewRun && selectedSubject
    ? calculateReviewSubjectTiming(logs, activeReviewRun.parentSubjectId, selectedSubject.id, subjects,
      logs.filter(log => activeReviewRun.logIds.includes(log.id)), activeReviewRun.reviewSubjectIds, true)
    : null, [activeReviewRun, logs, selectedSubject, subjects]);
  const timeAttackAverage = useMemo(() => activeReviewRun ? activeReviewAttackTiming?.averageTimePerPage || 0
    : selectedSubjectLogs.length > 0 ? calculateTimeAttackAverage(selectedSubjectLogs)
      : Math.max(0, selectedSubject?.initialAverageTimePerPage || 0), [activeReviewRun, activeReviewAttackTiming, selectedSubjectLogs, selectedSubject]);
  const averageSecondsPerPage = timeAttackAverage > 0 ? Math.max(1, Math.round(timeAttackAverage * 60)) : 0;
  const pomodoroPageTarget = getPomodoroPageTarget(averageTimePerPage, remainingSubjectPages, pomodoroMinutes);
  const timeTargetPages = attackCompletedPages;
  const progressBasePages = activeReviewRun ? reviewStartPage : activeSubjectStage?.currentPage || 1;
  const progressCurrentPages = stageChapters.length > 0
    ? positionAfterSolved(stageChapters, progressBasePages, timeTargetPages)
    : activeSubjectStage
    ? Math.min(activeSubjectStage.endPage, progressBasePages + timeTargetPages)
    : progressBasePages + timeTargetPages;
  const goalEndPage = (stageChapters.length > 0 && pomodoroPageTarget
    ? endPageForSolved(stageChapters, progressBasePages, pomodoroPageTarget)
    : getMeasurementGoalEndPage(progressBasePages, pomodoroPageTarget)) || progressBasePages;
  const progressTargetPages = activeSubjectStage ? Math.min(activeSubjectStage.endPage, goalEndPage) : goalEndPage;
  // 단원이 있으면 진행 칸을 단원 기준으로 나눈다: 지금 하는 곳(현재 페이지 / 단원 끝)과, 이번 뽀모도로가 단원 끝을 넘을 때만 다음 단원(시작 / 이번 뽀모도로 끝 페이지)
  const progressSplit = stageChapters.length > 0 && !activeReviewRun && averageTimePerPage > 0
    ? splitByChapter(stageChapters, progressCurrentPages, progressTargetPages) : null;
  const expectedReadAmount = Math.min(remainingSubjectPages, Math.max(1, timeTargetPages));
  const currentReadAmount = Number(solvedPageCount) || 0;
  const hasPageProgress = currentReadAmount > 0;
  const hasChangedEndPage = readAmount.trim() !== ''
    && initialReadAmount.trim() !== ''
    && Number(readAmount) !== Number(initialReadAmount);
  const currentTimePerPage = currentReadAmount > 0 ? minutes / currentReadAmount : 0;
  const speedDeltaMinutes = currentTimePerPage > 0 && averageTimePerPage > 0
    ? currentTimePerPage - averageTimePerPage
    : 0;
  const previousExpectedPages = averageTimePerPage > 0 ? minutes / averageTimePerPage : 0;
  const actualPages = currentReadAmount;
  const speedRatioPercent = previousExpectedPages > 0 && actualPages > 0
    ? (actualPages / previousExpectedPages) * 100
    : 0;
  const activePageAttackTargetSeconds = pageAttackTargetSeconds > 0 ? pageAttackTargetSeconds : averageSecondsPerPage;
  const pageAttackRemainingSeconds = activePageAttackTargetSeconds > 0
    ? Math.max(0, activePageAttackTargetSeconds - pageElapsedSeconds)
    : 0;
  const hasSessionMemo = false;

  useEffect(() => {
    const refreshNow = () => setNowMs(Date.now());
    const currentTime = Date.now();
    const futureReviewTimes = logs.flatMap(log => {
      const times = [
        log.nextReviewDate ? Date.parse(log.nextReviewDate) : NaN,
        log.reviewGateRetry ? Date.parse(log.reviewGateRetry.dueAt) : NaN
      ];
      return times.filter(time => Number.isFinite(time) && time > currentTime);
    });
    const nextReviewTime = futureReviewTimes.length > 0 ? Math.min(...futureReviewTimes) : null;
    const dueTimer = nextReviewTime === null
      ? null
      : window.setTimeout(refreshNow, Math.max(0, nextReviewTime - currentTime + 50));
    const interval = window.setInterval(refreshNow, 1000);
    const handleVisibilityChange = () => {
      if (!document.hidden) refreshNow();
    };

    refreshNow();
    window.addEventListener('focus', refreshNow);
    window.addEventListener('pageshow', refreshNow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (dueTimer !== null) window.clearTimeout(dueTimer);
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshNow);
      window.removeEventListener('pageshow', refreshNow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [logs]);

  useEffect(() => {
    if (handledReviewLogIds.length === 0) return;

    const stillDueIds = new Set(rawDueReviewGroups
      .filter(group => !group.isGateRetry)
      .flatMap(group => group.logs.map(log => log.id)));
    const nextHandledIds = handledReviewLogIds.filter(id => stillDueIds.has(id));

    if (nextHandledIds.length !== handledReviewLogIds.length) {
      setHandledReviewLogIds(nextHandledIds);
    }
  }, [handledReviewLogIds, rawDueReviewGroups]);

  useEffect(() => {
    selectedSessionTimerIdRef.current = selectedSessionTimerId;
  }, [selectedSessionTimerId]);

  useEffect(() => {
    if (!activeReviewRun) {
      setIsReviewNotePanelOpen(false);
      setIsReviewCondensePanelOpen(false);
    }
  }, [activeReviewRun]);

  useEffect(() => {
    if (isTimerRunning) {
      startTimeRef.current = Date.now();
      timerRef.current = window.setInterval(() => {
        if (startTimeRef.current !== null) {
          const now = Date.now();
          const currentElapsed = Math.floor((now - startTimeRef.current) / 1000);
          setSeconds(accumulatedSecondsRef.current + currentElapsed);
        }
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        if (startTimeRef.current !== null) {
          accumulatedSecondsRef.current += Math.floor((Date.now() - startTimeRef.current) / 1000);
        }
      }
      startTimeRef.current = null;
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isTimerRunning, step]);

  useEffect(() => {
    const times = step === 'organize' ? getSessionTimes(studySeconds, seconds)
      : step === 'pages' ? getSessionTimes(studySeconds, organizationSeconds)
      : getSessionTimes(seconds, organizationSeconds);
    setMinutes(times.timeSpentMinutes);
  }, [seconds, step, studySeconds, organizationSeconds]);

  useEffect(() => {
    if (step !== 'timer') {
      lastAttackSecondRef.current = seconds;
      return;
    }

    const delta = seconds - lastAttackSecondRef.current;
    if (delta <= 0) return;
    lastAttackSecondRef.current = seconds;

    const timerId = selectedSessionTimerIdRef.current;
    activeTimerSecondsRef.current[timerId] =
      (activeTimerSecondsRef.current[timerId] || 0) + delta;
    currentPageMeasuredSecondsRef.current += delta;
    setSessionTimerSeconds(prev => ({
      ...prev,
      [timerId]: activeTimerSecondsRef.current[timerId] || 0
    }));

    if (averageSecondsPerPage <= 0) return;

    setPageElapsedSeconds(prev => {
      let nextElapsed = prev + delta;
      let completed = 0;
      const targetSeconds = activePageAttackTargetSeconds || averageSecondsPerPage;

      while (nextElapsed >= targetSeconds) {
        nextElapsed -= targetSeconds;
        completed += 1;
      }

      if (completed > 0) {
        const completedTimerId = selectedSessionTimerIdRef.current;
        setAttackCompletedPages(current => current + completed);
        setPageAttackTargetSeconds(averageSecondsPerPage);
        const completedSeconds = Math.max(1, currentPageMeasuredSecondsRef.current - nextElapsed);
        activeTimerPagesRef.current[completedTimerId] =
          (activeTimerPagesRef.current[completedTimerId] || 0) + completed;
        activeTimerCompletedSecondsRef.current[completedTimerId] =
          (activeTimerCompletedSecondsRef.current[completedTimerId] || 0) + completedSeconds;
        activeTimerPageSecondsRef.current[completedTimerId] = [
          ...(activeTimerPageSecondsRef.current[completedTimerId] || []),
          completedSeconds
        ];
        currentPageMeasuredSecondsRef.current = Math.max(0, nextElapsed);
        setSessionTimerPages(prev => ({
          ...prev,
          [completedTimerId]: activeTimerPagesRef.current[completedTimerId] || 0
        }));
        setSessionTimerCompletedSeconds(prev => ({
          ...prev,
          [completedTimerId]: activeTimerCompletedSecondsRef.current[completedTimerId] || 0
        }));
        setSessionTimerPageSeconds(prev => ({
          ...prev,
          [completedTimerId]: activeTimerPageSecondsRef.current[completedTimerId] || []
        }));
      }

      return nextElapsed;
    });
  }, [activePageAttackTargetSeconds, averageSecondsPerPage, seconds, selectedSessionTimerId, step]);

  // 측정 중에는 장마다 내던 소리(반쯤 · 1분 전 · 장 넘김)를 내지 않는다(29일 요청). 소리는 뽀모도로가 끝날 때만 난다(playPomodoroEndSound).

  // 기본 복습 시간: "복습 완료"를 누를 때까지 잰다. 복습 문제를 다 풀어도 멈추지 않는다(28일 요청: 문제가 복습의 전부가 아니라서,
  // 문제를 맞힌 뒤에도 노트·페이지를 더 보는 추가 복습 시간을 준다).
  useEffect(() => {
    if (!isPreSessionReviewRunning || preSessionReviewLogs.length === 0) return;

    const interval = window.setInterval(() => {
      setPreSessionReviewSeconds(prev => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [isPreSessionReviewRunning, preSessionReviewLogs.length]);

  // 기본 복습의 뽀모도로: 예상 시간이 25분 이하면 그 시간이 한 회, 넘으면 25분씩 나눠 회차로 센다(마지막 회차는 남는 시간).
  // 회차가 끝나거나 예상 시간이 모두 지나도 화면은 닫지 않는다. 시간 글자, 닫을 수 있는 안내 띠, 짧은 소리 한 번으로만 알리고 복습은 계속된다.
  const reviewPomodoro = getPomodoroProgress(preSessionReviewTargetSeconds, preSessionReviewSeconds, pomodoroMinutes);
  const isReviewTimeUp = Boolean(reviewPomodoro?.finished);
  const reviewCompletedRounds = reviewPomodoro?.completedRounds ?? 0;
  const reviewRoundsSeenRef = useRef(0);
  const [dismissedReviewRound, setDismissedReviewRound] = useState(0);
  useEffect(() => {
    if (reviewCompletedRounds === 0) { reviewRoundsSeenRef.current = 0; setDismissedReviewRound(0); return; }
    if (reviewCompletedRounds > reviewRoundsSeenRef.current) {
      reviewRoundsSeenRef.current = reviewCompletedRounds;
      playPomodoroEndSound();
    } else if (reviewCompletedRounds < reviewRoundsSeenRef.current) {
      // 복습 도중 뽀모도로 시간을 늘려 끝난 회차 수가 줄었다: 그 값부터 다시 센다.
      reviewRoundsSeenRef.current = reviewCompletedRounds;
      setDismissedReviewRound(current => Math.min(current, reviewCompletedRounds));
    }
  }, [reviewCompletedRounds]);

  // 공부(측정) 중에도 뽀모도로가 끝날 때마다 알린다: 소리 한 번과 닫을 수 있는 안내 띠. 타이머는 멈추지 않고 화면도 그대로다.
  // 새 측정이 시작되면(풀이 시간 0) 처음부터 다시 센다.
  // 뽀모도로 시간(기본 25분)이 지날 때마다 한 회다(27일 요청: ▲로 늘린 시간이 바로 반영되고, 시간이 끝나면 알람이 울린다).
  // 예전에는 장당 시간을 알면 목표 장수를 풀 때마다 한 회라서 시간을 늘려도 끝나는 때가 그대로였다.
  const studyPomodoroRound = step !== 'timer' ? 0 : Math.floor(seconds / (pomodoroMinutes * 60));
  const studyPomodoroSeenRef = useRef(0);
  const [dismissedPomodoroRound, setDismissedPomodoroRound] = useState(0);
  useEffect(() => {
    if (step === 'idle' || (step === 'timer' && seconds === 0)) {
      studyPomodoroSeenRef.current = 0;
      setDismissedPomodoroRound(0);
      return;
    }
    if (studyPomodoroRound > studyPomodoroSeenRef.current) {
      studyPomodoroSeenRef.current = studyPomodoroRound;
      playPomodoroEndSound();
    } else if (studyPomodoroRound < studyPomodoroSeenRef.current) {
      // 공부 도중 뽀모도로 시간을 바꿔 끝난 회차 수가 줄었다: 그 값부터 다시 센다.
      studyPomodoroSeenRef.current = studyPomodoroRound;
      setDismissedPomodoroRound(current => Math.min(current, studyPomodoroRound));
    }
  }, [step, seconds, studyPomodoroRound]);

  useEffect(() => {
    if (!currentGateQuestion || !gateQuestionCardRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      gateQuestionCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentGateQuestion?.id]);

  useEffect(() => {
    if (preSessionReviewLogs.length === 0 || gatePractice) return;
    const unlocked = Object.fromEntries(preSessionReviewLogs.map(log => [log.id,
      preSessionReviewGroup?.isGateRetry
        ? Math.max(log.reviewGateLevel || 1, ...gateReviewQuestions.filter(question => question.logId === log.id).map(question => question.level))
        : log.reviewGateLevel || 1
    ]));
    // 한 번에 나오는 문제들의 순서는 기본이 랜덤이다(29일 요청). 중요한 묶음부터 나오는 것은 그대로
    setGatePractice(startReviewPractice(gateReviewQuestions, unlocked, Math.floor(Math.random() * 2 ** 31)));
  }, [gateReviewQuestionSignature, gateReviewQuestions, gatePractice, preSessionReviewLogs, preSessionReviewGroup?.isGateRetry]);

  // 문제를 복습에서 빼거나 되돌려 문제 목록이 바뀌면 풀이 상태를 목록에 맞춘다
  useEffect(() => {
    setGatePractice(previous => (previous ? reconcileReviewPractice(previous, gateReviewQuestions) : previous));
  }, [gateReviewQuestionSignature]);

  // 빼기 안내는 잠시 뒤 저절로 사라진다(되돌리기는 그동안 누를 수 있다)
  useEffect(() => {
    if (!gateRemovalNotice) return undefined;
    const timer = window.setTimeout(() => setGateRemovalNotice(null), 9000);
    return () => window.clearTimeout(timer);
  }, [gateRemovalNotice]);

  useEffect(() => {
    if (!subjectId) return;
    const savedPreference = readReviewSessionPreferences()[subjectId];
    const isLinkedReviewSubject = reviewSubjectIdSet.has(subjectId);
    setSkipReview(savedPreference ?? (isSubjectReviewDisabled || isLinkedReviewSubject));
  }, [subjectId, isSubjectReviewDisabled, reviewSubjectIdSet]);

  useEffect(() => {
    if (!subjectId) {
      setSessionMemo(readSessionMemos().global || '');
      setSelectedSessionTimerId('none');
      selectedSessionTimerIdRef.current = 'none';
      return;
    }
    setSessionMemo(readSessionMemos()[subjectId] || '');
    setSelectedSessionTimerId('none');
    selectedSessionTimerIdRef.current = 'none';
  }, [subjectId]);

  useEffect(() => {
    if (step !== 'idle') return;
    setPreSessionReviewLogs([]);
    setPreSessionReviewDrafts({});
    setPreSessionReviewSeconds(0);
    setPreSessionReviewTargetSeconds(0);
    setPreSessionReviewParentSubjectId('');
    setIsPreSessionReviewRunning(false);
    setPreSessionReviewSubjectName('');
    setResumeStudyTimerAfterReview(false);
    setDismissedReviewSignature('');
    setPostSaveNextSubjectId(null);
    setPendingImmediateStartSubjectId(null);
    setSelectedTaskKey('');
    setInspectedRecordDetailId('');
    setSubjectId('');
    setHandledReviewLogIds([]);
    setPendingAutoAdvanceLogId(null);
  }, [activeStudyDate, activeWeekday]);

  useEffect(() => {
    if (step !== 'idle' || pendingImmediateStartSubjectId || preSessionReviewLogs.length > 0) return;
    if (pendingAutoAdvanceLogId && !logs.some(log => log.id === pendingAutoAdvanceLogId)) return;
    if (pendingAutoAdvanceLogId) setPendingAutoAdvanceLogId(null);

    const nextDetailKey = selectedRunQueueItem ? getRunQueueDetailKey(selectedRunQueueItem) : '';
    if (selectedRunQueueItem && selectedTaskKey !== selectedRunQueueItem.key) {
      setSelectedTaskKey(selectedRunQueueItem.key);
    }
    const hasCompletedRecord = logs.some(log => (
      ((completedStudySubjectIds.includes(detailSubjectId) || log.pomodoroSession) && log.subjectId === detailSubjectId && getLogStudyDate(log) === activeStudyDate && log.pagesRead > 0)
      || (detailSubjectId === `basic-review:${log.subjectId}` && log.basicReviewTimeRecords?.some(record => getLocalDateKey(new Date(record.timestamp)) === activeStudyDate))
      || log.reviewSubjectTimeRecords?.some(record => record.subjectId === detailSubjectId && record.completed && getLocalDateKey(new Date(record.timestamp)) === activeStudyDate)
    ));
    if (hasCompletedRecord && inspectedRecordDetailId === detailSubjectId) return;
    if (detailSubjectId !== nextDetailKey) onDetailSubjectChange(nextDetailKey);
  }, [detailSubjectId, logs, onDetailSubjectChange, pendingAutoAdvanceLogId, pendingImmediateStartSubjectId,
      preSessionReviewLogs.length, selectedRunQueueItem, selectedTaskKey, completedStudySubjectIds, activeStudyDate, inspectedRecordDetailId, step]);

  const resetPageAttackTimer = (targetSeconds = 0) => {
    setPageAttackTargetSeconds(targetSeconds > 0 ? targetSeconds : 0);
    setPageElapsedSeconds(0);
    currentPageMeasuredSecondsRef.current = 0;
  };

  const getCurrentElapsedSeconds = () => (
    accumulatedSecondsRef.current + (
      startTimeRef.current !== null
        ? Math.floor((Date.now() - startTimeRef.current) / 1000)
        : 0
    )
  );

  const lockElapsedTimeToCurrentTimer = () => {
    if (step !== 'timer') return;
    const currentElapsed = getCurrentElapsedSeconds();
    const delta = currentElapsed - lastAttackSecondRef.current;
    if (delta <= 0) return;

    const timerId = selectedSessionTimerIdRef.current;
    activeTimerSecondsRef.current[timerId] =
      (activeTimerSecondsRef.current[timerId] || 0) + delta;
    currentPageMeasuredSecondsRef.current += delta;
    lastAttackSecondRef.current = currentElapsed;
    setSeconds(currentElapsed);
    setSessionTimerSeconds(prev => ({
      ...prev,
      [timerId]: activeTimerSecondsRef.current[timerId] || 0
    }));
  };

  const resetAll = () => {
    setStep('idle');
    setSeconds(0);
    setStudySeconds(0);
    setOrganizationSeconds(0);
    setAttackCompletedPages(0);
    setPageElapsedSeconds(0);
    setPageAttackTargetSeconds(0);
    setSessionTimerSeconds({});
    setSessionTimerCompletedSeconds({});
    setSessionTimerPages({});
    setSessionTimerPageSeconds({});
    accumulatedSecondsRef.current = 0;
    lastAttackSecondRef.current = 0;
    activeTimerSecondsRef.current = {};
    activeTimerCompletedSecondsRef.current = {};
    activeTimerPagesRef.current = {};
    activeTimerPageSecondsRef.current = {};
    currentPageMeasuredSecondsRef.current = 0;
    startTimeRef.current = null;
    setIsTimerRunning(false);
    setStartPage('');
    setReadAmount('');
    setSolvedPageCount('');
    setFeedbackChoice(null);
    setInitialReadAmount('');
    setReviewMemo('');
    setReviewMemoDocument(undefined);
    setIsConfirmingCancel(false);
    setTimerMode('remainingPages');
    selectedSessionTimerIdRef.current = 'none';
    setIsReviewNotePanelOpen(false);
    setIsReviewCondensePanelOpen(false);
    setActiveReviewRun(null);
  };

  const handleToggleSkipReview = () => {
    if (!subjectId) return;
    const nextSkipReview = !skipReview;
    setSkipReview(nextSkipReview);
    writeReviewSessionPreference(subjectId, nextSkipReview);
  };

  const handleMemoChange = (memo: string) => {
    setSessionMemo(memo);
    writeSessionMemo(subjectId, memo);
  };

  const toggleMemoCollapsed = () => {
    const next = !isMemoCollapsed;
    setIsMemoCollapsed(next);
    writeSessionMemoCollapsed(next);
  };

  const handleReadAmountChange = (value: string) => {
    setReadAmount(value);
    const amount = value.trim() && startPage.trim()
      ? stageChapters.length > 0 ? pagesBetween(stageChapters, Number(startPage), Number(value)) : getAutoSolvedPageCount(Number(startPage), Number(value))
      : null;
    setSolvedPageCount(amount !== null ? String(amount) : '');
  };

  // `[ ]` 안 추천에 쓸 같은 과목의 노트 글들(이어 쓰는 글 포함)
  const noteSetMemos = useMemo(
    () => [...logs.filter(log => log.subjectId === subjectId && (log.reviewMemo ?? '').trim()).map(log => log.reviewMemo ?? ''), reviewMemo],
    [logs, subjectId, reviewMemo]
  );

  // `[집합]()` 창에서 값을 고치면: 지금 쓰는 노트지와, 이 과목의 다른 기록 노트에 같은 고침을 적용한다.
  // (노트지에 이어 붙은 기록들은 노트지에 이미 들어 있어 저장할 때 원래 기록으로 나뉘어 돌아간다.)
  const rewriteSessionNotes = useMemo<NoteSetRewriter>(() => rewrite => {
    const inSheet = new Set(sheetPartsRef.current.map(part => part.logId));
    const changes = logs
      .filter(log => log.subjectId === subjectId && !inSheet.has(log.id))
      .map(log => ({ id: log.id, before: log.reviewMemo ?? '', after: rewrite(log.reviewMemo ?? '') }))
      .filter(change => change.after !== change.before);
    const sheetBefore = reviewMemo;
    const sheetAfter = rewrite(sheetBefore);
    if (!changes.length && sheetAfter === sheetBefore) return null;
    changes.forEach(change => onUpdateReviewMemo(change.id, change.after));
    if (sheetAfter !== sheetBefore) { setReviewMemo(sheetAfter); setReviewMemoDocument(undefined); }
    return () => {
      changes.forEach(change => onUpdateReviewMemo(change.id, change.before));
      if (sheetAfter !== sheetBefore) { setReviewMemo(sheetBefore); setReviewMemoDocument(undefined); }
    };
  }, [logs, subjectId, reviewMemo, onUpdateReviewMemo]);

  // 정리노트는 학습을 저장해도 바로 비우지 않는다. 이월 노트는 페이지 단위가 없는 과목과 똑같이 그날 하루(오늘 기록)만 같은 노트지에 이어 쓴다.
  // 그 날 이전 기록 노트를 오래된 순서로 이어 붙여 채우고, 저장할 때는 새로 쓴 부분만 이번 기록에 담는다.
  const seedCarriedNoteSheet = () => {
    const subject = subjects.find(item => item.id === subjectId);
    const carried = subject
      ? carriedNoteLogs(logs.filter(log => log.subjectId === subject.id), 0, subject.startPage ?? 1, activeStudyDate)
      : [];
    const parts = carried
      .filter(log => (log.reviewMemo ?? '').trim().length > 0)
      .map(log => ({ logId: log.id, memo: log.reviewMemo ?? '' }));
    sheetPartsRef.current = parts;
    sheetUpdatesRef.current = [];
    setReviewMemo(mergeSheetParts(parts));
    setReviewMemoDocument(undefined);
  };

  const startMeasurementNow = () => {
    unlockSounds();
    setStudySeconds(0);
    setOrganizationSeconds(0);
    setAttackCompletedPages(0);
    setPageAttackTargetSeconds(averageSecondsPerPage);
    setPageElapsedSeconds(0);
    selectedSessionTimerIdRef.current = 'none';
    setSelectedSessionTimerId('none');
    setSessionTimerSeconds({});
    setSessionTimerCompletedSeconds({});
    setSessionTimerPages({});
    activeTimerSecondsRef.current = {};
    activeTimerCompletedSecondsRef.current = {};
    activeTimerPagesRef.current = {};
    activeTimerPageSecondsRef.current = {};
    setSessionTimerPageSeconds({});
    currentPageMeasuredSecondsRef.current = 0;
    lastAttackSecondRef.current = 0;
    seedCarriedNoteSheet();
    setStep('timer');
    setIsTimerRunning(true);
  };

  const clearPreSessionReview = () => {
    setGatePractice(null);
    setPreSessionReviewLogs([]);
    setPreSessionReviewDrafts({});
    setPreSessionReviewSeconds(0);
    setPreSessionReviewTargetSeconds(0);
    setPreSessionReviewParentSubjectId('');
    setPreSessionReviewGroup(null);
    setIsPreSessionReviewRunning(false);
    setPreSessionReviewSubjectName('');
    setResumeStudyTimerAfterReview(false);
    setIsGateAnswerRevealed(false);
    setGateDroppedIds([]);
    setGateRemovalNotice(null);
    setBasicFeedbackChoice(null);
  };

  const openPreSessionReview = (group: ReviewQueueGroup, mode: PreSessionReviewMode) => {
    unlockSounds();
    gateStartedAtRef.current = Date.now();
    setGatePractice(null);
    setPreSessionReviewDrafts(
      group.logs.reduce<Record<string, string>>((drafts, log) => {
        drafts[log.id] = log.reviewMemo || '';
        return drafts;
      }, {})
    );
    setPreSessionReviewLogs(group.logs);
    setPreSessionReviewGroup(group);
    setPreSessionReviewSubjectName(group.parentSubjectName || group.subjectName);
    setPreSessionReviewMode(mode);
    setPreSessionReviewSeconds(0);
    setPreSessionReviewTargetSeconds(
      group.estimatedMinutes > 0
        ? Math.max(1, Math.round(group.estimatedMinutes * 60))
        : 0
    );
    setPreSessionReviewParentSubjectId(group.parentSubjectId);
    setIsPreSessionReviewRunning(true);
    setIsGateAnswerRevealed(false);
  };

  const startStudyOrderItem = (item: StudyOrderItem) => {
    selectSubjectForMeasurement(item.subject);
    setPostSaveNextSubjectId(null);
    setPendingImmediateStartSubjectId(item.subject.id);
  };

  const startReviewSubjectMeasurementRun = (group: ReviewQueueGroup, questionGrade: SubjectGrade | null = null) => {
    const parentSubjectId = group.parentSubjectId || group.logs[0]?.subjectId || group.subjectId;
    const parentSubject = subjects.find(subject => subject.id === parentSubjectId);
    const repeatedLog = group.logs.find(log => log.isRepeatReview);
    const reviewSubjectIds = repeatedLog ? [repeatedLog.subjectId] : getAvailableReviewSubjectIds(group.reviewSubjectIds, parentSubject, subjects);

    if (reviewSubjectIds.length === 0) {
      return;
    }

    const currentIndex = Math.max(0, reviewSubjectIds.indexOf(group.subjectId));
    const currentReviewSubject = subjects.find(subject => subject.id === reviewSubjectIds[currentIndex]);
    if (!currentReviewSubject) {
      return;
    }

    setActiveReviewRun({
      logIds: group.logs.map(log => log.id),
      parentSubjectId,
      reviewSubjectIds,
      currentIndex,
      sourceName: parentSubject?.name || group.subjectName,
      startPage: repeatedLog ? getRepeatedReviewRange(repeatedLog, currentReviewSubject).startPage : undefined,
      stageId: repeatedLog ? getRepeatedReviewRange(repeatedLog, currentReviewSubject).stageId : undefined,
      questionGrade
    });
    selectSubjectForMeasurement(currentReviewSubject);
    setPostSaveNextSubjectId(null);
    setPendingImmediateStartSubjectId(currentReviewSubject.id);
  };

  /** 이 복습 묶음에 지금 풀 문제가 하나라도 있는가(정리노트가 비었거나 풀 때가 된 문제가 없으면 false) */
  const groupHasGateQuestions = (group: ReviewQueueGroup) => group.logs.some(log => {
    const memo = log.reviewMemo ?? '';
    if (!memo.trim()) return false;
    const keys = new Set(group.isGateRetry ? getReviewGateRetryKeys(log) : getDueReviewGateQuestionKeys(log, Date.now(), true));
    return withLogShorthand(log, () => parseReviewGateMemo(memo)).questions.some(question => keys.has(question.key));
  });

  const startReviewMeasurementRun = (group: ReviewQueueGroup) => {
    if (!group.isGateRetry && group.reviewType === 'subject' && group.logs.every(log => (
      log.reviewGatePendingSteps !== undefined || log.reviewGatePendingResult !== undefined || Boolean(log.reviewSubjectId)
    ))) {
      startReviewSubjectMeasurementRun(group);
      return;
    }
    // 복습 문제가 없는데 이어서 할 복습과목이 있으면 문제 화면을 거치지 않고 바로 복습과목으로 간다.
    if (!group.isGateRetry && !groupHasGateQuestions(group)) {
      const parentSubject = subjects.find(subject => subject.id === (group.parentSubjectId || group.logs[0]?.subjectId || group.subjectId));
      const repeatedLog = group.logs.find(log => log.isRepeatReview);
      const reviewSubjectIds = repeatedLog ? [repeatedLog.subjectId] : getAvailableReviewSubjectIds(group.reviewSubjectIds, parentSubject, subjects);
      if (reviewSubjectIds.length > 0) {
        startReviewSubjectMeasurementRun(group);
        return;
      }
    }
    openPreSessionReview(group, 'before-study');
  };

  const startReviewGroup = (group: ReviewQueueGroup) => {
    setSubjectId('');
    setPostSaveNextSubjectId(null);
    startReviewMeasurementRun(group);
  };

  const handleRefreshStudyPlans = () => {
    if (!onUpdateSubjects) return;

    const resetDateKey = getLocalDateKey();
    const updatedSubjects = subjects.map(subject => ({
      ...subject,
      planResetDate: resetDateKey,
      scheduledWeekdayPages: calculateFreshWeekdayPagePlan(
        subject,
        getSubjectRemainingPageCount(subject),
        getDiffDays(subject.targetDate)
      )
    }));

    onUpdateSubjects(updatedSubjects);
  };

  const handleGateLevelChange = (level: number) => {
    setGatePractice(previous => previous ? setReviewPracticeLevel(previous, gateReviewQuestions, level) : previous);
    setIsGateAnswerRevealed(false);
  };

  const handleGateReveal = () => {
    if (currentGateQuestion) {
      const elapsed = Math.max(0, Date.now() - gateShownAtRef.current);
      setGateRevealMs(elapsed);
      if (!(currentGateQuestion.id in gateFirstResponseMsRef.current)) gateFirstResponseMsRef.current[currentGateQuestion.id] = elapsed;
    }
    setIsGateAnswerRevealed(true);
  };

  const handleGateReviewResult = (result: GateReviewResult) => {
    if (!currentGateQuestion || !isGateAnswerRevealed) return;
    setGatePractice(previous => previous ? gradeReviewPractice(previous, gateReviewQuestions, result) : previous);
    setIsGateAnswerRevealed(false);
  };

  // 복습에서 빼기: 지금 문제(결합 문제는 맡은 단위마다)를 이 복습과 앞으로의 복습에서 뺀다. 노트 글과 문제는 그대로 두고, 논리 이유는 그 줄에 [!]만 붙인다.
  // 관계쌍 묶음 문제는 보이는 문제 하나만 뺀다(함께 결과를 받던 문제들은 다음 복습에 다시 묶인다)
  const gateCoverOf = (question: GateReviewQuestion): RemovalCover[] => (question.covered && !question.bundled ? question.covered : [{ logId: question.logId, questionKey: question.questionKey }]);
  const gateRemovalMemos = useMemo<RemovalMemo[]>(() => preSessionGateMemoItems.map(item => ({ logId: item.log.id, memo: item.memo })), [preSessionGateMemoItems]);
  const gateSubjectNotes = useMemo(() => {
    const subjectIds = new Set(preSessionReviewLogs.map(log => log.subjectId));
    return logs.filter(log => subjectIds.has(log.subjectId) && (log.reviewMemo ?? '').trim());
  }, [logs, preSessionReviewLogs]);
  const gateSubjectMemos = useMemo<RemovalMemo[]>(() => gateSubjectNotes.map(log => ({ logId: log.id, memo: log.reviewMemo ?? '' })), [gateSubjectNotes]);
  const gateOldLines = useMemo(() => gateSubjectNotes.flatMap(log => log.reviewMemoOldLines ?? []), [gateSubjectNotes]);

  const handleRemoveGateQuestion = (reason: ReviewRemovedReason) => {
    if (!currentGateQuestion || !onRemoveReviewQuestions) return;
    const covers = gateCoverOf(currentGateQuestion);
    const liveMemos = gateRemovalMemos.map(item => ({ logId: item.logId, memo: logs.find(log => log.id === item.logId)?.reviewMemo ?? item.memo }));
    const gateLog = currentGateMemoItem?.log;
    const updates = withLogShorthand(gateLog, () => planReviewRemoval({ reason, covers, memos: gateRemovalMemos, liveMemos, relatedMemos: gateSubjectMemos, oldLines: gateOldLines, nowIso: new Date().toISOString() }));
    if (updates.length) onRemoveReviewQuestions(updates);
    // 그 줄에 [!]가 붙으면 같은 줄에서 나온 다른 문제(역방향 등)도 만들어지지 않는다: 이번 복습에서도 함께 뺀다.
    const surviving = new Map(updates.filter(update => update.memo !== undefined).map(update => [update.logId,
      new Set(withLogShorthand(logs.find(log => log.id === update.logId) ?? gateLog, () => getReviewGateQuestionKeys(update.memo!)))]));
    const ids = new Set([currentGateQuestion.id]);
    gateReviewQuestions.forEach(question => {
      if (gateCoverOf(question).some(cover => surviving.has(cover.logId) && !surviving.get(cover.logId)!.has(cover.questionKey))) ids.add(question.id);
    });
    const question = currentGateQuestion.presentation ?? currentGateMemoItem?.parsed.questions.find(item => item.key === currentGateQuestion.questionKey);
    setGateDroppedIds(previous => [...previous, ...ids]);
    setGateRemovalNotice({ kind: 'removed', ids: [...ids], reason, covers, text: question ? `${question.prompt} → ${question.answer}` : '' });
    setIsGateAnswerRevealed(false);
  };

  const handleUndoGateRemoval = () => {
    if (gateRemovalNotice?.kind !== 'removed') return;
    gateRemovalNotice.covers.forEach(cover => onRestoreReviewQuestion?.(cover.logId, cover.questionKey));
    const back = new Set(gateRemovalNotice.ids);
    setGateDroppedIds(previous => previous.filter(id => !back.has(id)));
    setGateRemovalNotice(null);
  };

  // 나온 정의(능력 정의 줄·문제가 나온 줄)를 그 자리에서 고친다: 노트에 저장하고(고친 부분은 복습에 든다), 옛 정의로 만든 이 문제는 이번 복습에서 건너뛴다.
  const handleEditGateLines = (edits: QuestionLineEdit[]): string | null => {
    if (!currentGateQuestion || edits.length === 0) return null;
    const next = new Map<string, string>();
    for (const edit of [...edits].sort((a, b) => b.lineIndex - a.lineIndex)) {
      const memo = next.get(edit.logId) ?? logs.find(log => log.id === edit.logId)?.reviewMemo ?? '';
      const replaced = replaceMemoLine(memo, edit.lineIndex, edit.expected, edit.text, edit.isToggle);
      if (replaced === null) return '노트가 바뀌어서 그 줄을 찾지 못했어요.';
      next.set(edit.logId, replaced);
    }
    next.forEach((memo, logId) => onUpdateReviewMemo(logId, memo));
    setGateDroppedIds(previous => [...previous, currentGateQuestion.id]);
    // 문제가 그대로 남아 있으면 다음 복습에 다시 나오고, 고친 글이 새 문제를 만들었으면(켜 둔 경우) 그 문제가 다음 복습에 든다
    const stays = gateCoverOf(currentGateQuestion).every(cover => !next.has(cover.logId)
      || withLogShorthand(logs.find(log => log.id === cover.logId), () => getReviewGateQuestionKeys(next.get(cover.logId)!)).includes(cover.questionKey));
    setGateRemovalNotice({ kind: 'edited', text: stays ? '고쳤어요 · 이 문제는 다음 복습에 다시 나와요'
      : readEditIntake() ? '고쳤어요 · 고친 부분이 새 문제로 다음 복습에 나와요' : '고쳤어요 · 이 문제는 이번 복습에서 건너뛰었어요' });
    setIsGateAnswerRevealed(false);
    return null;
  };

  const renderCurrentGatePrompt = () => {
    if (!currentGateQuestion || !currentGateMemoItem) return null;

    const question = currentGateQuestion.presentation
      ?? currentGateMemoItem.parsed.questions.find(item => item.key === currentGateQuestion.questionKey);
    return question ? <ReviewQuestionContent question={question} criterion={currentGateMemoItem.criterion}
      revealed={isGateAnswerRevealed} memo={currentGateMemoItem.memo}
      setMemos={logs.filter(log => log.subjectId === currentGateMemoItem.log.subjectId && (log.reviewMemo ?? '').trim()).map(log => log.reviewMemo ?? '')} /> : null;
  };

  const handleCondenseActiveReviewLog = (logId: string) => {
    if (!activeReviewRun) return;

    const nextLogIds = activeReviewRun.logIds.filter(id => id !== logId);
    onReviewAction([logId], 'condense');
    setHandledReviewLogIds(prev => Array.from(new Set([...prev, logId])));

    if (nextLogIds.length === 0) {
      resetAll();
      setSubjectId('');
      setPostSaveNextSubjectId(null);
      return;
    }

    setActiveReviewRun({ ...activeReviewRun, logIds: nextLogIds });
  };

  // 이번 복습 문제의 결과(기록마다). 마칠 때 저장하고, 완료 화면의 난도 버튼은 이것을 넣어 본 다음 복습을 보여 준다
  const buildGateOutcomes = (): ReviewGateOutcome[] => {
    // 결합·건너뛰기 문제는 맡은 단위 문제마다 같은 결과를 기록한다(일정은 단위마다 따로 쌓인다).
    const pieces = gateReviewQuestions
      .filter(question => gatePractice?.completed.includes(question.id))
      .flatMap(question => (question.covered ?? [{ logId: question.logId, questionKey: question.questionKey }])
        .map(cover => ({ ...cover, gateId: question.id })));
    return preSessionGateMemoItems.flatMap(item => {
      const own = pieces.filter(piece => piece.logId === item.log.id);
      if (own.length === 0) return [];
      const wrongQuestionKeys = own
        .filter(piece => (gatePractice?.wrongCounts[piece.gateId] || 0) > 0)
        .map(piece => piece.questionKey);
      return [{
        logId: item.log.id,
        passed: wrongQuestionKeys.length === 0,
        wrongQuestionKeys,
        completedQuestionKeys: own.map(piece => piece.questionKey),
        questionResults: Object.fromEntries(own.map(piece => [piece.questionKey, {
          wrongCount: gatePractice?.wrongCounts[piece.gateId] || 0,
          attempts: gatePractice?.attempts[piece.gateId] || 0,
          grades: gatePractice?.grades[piece.gateId],
          responseMs: gateFirstResponseMsRef.current[piece.gateId]
        }])),
        unlockedLevel: gatePractice?.unlocked[item.log.id] || 1
      }];
    });
  };

  // 이번에 푼 복습 문제들의 첫 답변 중 가장 많은 등급. 문제가 있었으면 나머지 복습의 다음 주기는 이것으로 정한다(28일 요청)
  const gateQuestionGrade = useMemo(() => mostCommonFirstGrade(gateReviewQuestions
    .filter(question => gatePractice?.completed.includes(question.id))
    .map(question => gatePractice?.grades[question.id]?.[0])), [gatePractice, gateReviewQuestions]);

  // 기본 복습을 마칠 때의 난도 피드백: 복습과목이 이어지지 않는 기본 복습만(복습과목이 있으면 마지막 복습과목에서 고른다, 오답 다시 풀기는 묻지 않는다)
  const basicFeedback = useMemo(() => {
    if (preSessionReviewLogs.length === 0 || !preSessionReviewGroup || preSessionReviewGroup.isGateRetry) return null;
    const parent = subjects.find(subject => subject.id === preSessionReviewGroup.parentSubjectId);
    if (getAvailableReviewSubjectIds(preSessionReviewGroup.reviewSubjectIds, parent, subjects).length > 0) return null;
    const pages = preSessionReviewLogs.reduce((sum, log) => sum + Math.max(0, log.pagesRead), 0);
    return basicReviewFeedbackOf(logs, preSessionReviewGroup.parentSubjectId, pages, preSessionReviewSeconds / 60);
  }, [logs, preSessionReviewGroup, preSessionReviewLogs, preSessionReviewSeconds, subjects]);

  const finishPreSessionReview = () => {
    if (preSessionReviewLogs.length === 0) return;
    if (!isGateReviewComplete) return;

    const outcomes = buildGateOutcomes();
    onFinishReviewGate(outcomes, Boolean(preSessionReviewGroup?.isGateRetry));

    if (preSessionReviewGroup?.isGateRetry) {
      clearPreSessionReview();
      setSelectedTaskKey('');
      setInspectedRecordDetailId('');
      return;
    }

    const finishedLogIds = preSessionReviewLogs.map(log => log.id);
    const reviewGroup = preSessionReviewGroup;
    const parentSubject = reviewGroup
      ? subjects.find(subject => subject.id === reviewGroup.parentSubjectId)
      : undefined;
    const reviewSubjectIds = reviewGroup
      ? getAvailableReviewSubjectIds(reviewGroup.reviewSubjectIds, parentSubject, subjects)
      : [];
    const shouldStartStudyAfterReview = preSessionReviewMode === 'before-study' && subjectId;
    const shouldResumeTimer = preSessionReviewMode === 'interrupt' && resumeStudyTimerAfterReview;

    if (reviewGroup && reviewSubjectIds.length > 0) {
      clearPreSessionReview();
      startReviewSubjectMeasurementRun(reviewGroup, gateQuestionGrade);
      return;
    }

    setHandledReviewLogIds(prev => Array.from(new Set([...prev, ...finishedLogIds])));
    // 복습 문제가 있었으면 나머지 복습의 등급은 문제 첫 답변 중 가장 많은 값이다(고르지 않는다). 없으면 전처럼 속도로 권한 값 · 고른 값
    onReviewAction(finishedLogIds, 'complete', preSessionReviewSeconds / 60, gateQuestionGrade
      ?? (basicFeedback ? basicFeedbackChoice ?? basicFeedback.recommended ?? 'good' : undefined));
    clearPreSessionReview();
    setSelectedTaskKey('');
    setInspectedRecordDetailId('');

    if (shouldStartStudyAfterReview) {
      startMeasurementNow();
      return;
    }

    if (shouldResumeTimer) {
      setIsTimerRunning(true);
      return;
    }

    setSubjectId('');
  };

  // 복습 문제를 다 풀어도 복습과목을 바로 시작하지 않는다(28일 요청): 추가 복습 시간을 가진 뒤 "복습과목 시작"을 눌러 이어 간다.
  // 문제 결과는 그 버튼을 누를 때 저장된다.

  const condenseFirstPreSessionReview = () => {
    if (preSessionReviewLogs.length === 0) return;
    const [firstLog, ...remainingLogs] = preSessionReviewLogs;
    if (preSessionReviewGroup?.isGateRetry) {
      onClearReviewGateRetries([firstLog.id]);
    } else {
      setHandledReviewLogIds(prev => Array.from(new Set([...prev, firstLog.id])));
      onReviewAction([firstLog.id], 'condense');
    }
    setPreSessionReviewLogs(remainingLogs);
    setPreSessionReviewGroup(prev => prev ? {
      ...prev,
      logs: prev.logs.filter(log => log.id !== firstLog.id)
    } : prev);
    setGatePractice(null);
    setIsGateAnswerRevealed(false);
    setPreSessionReviewDrafts(prev => {
      const next = { ...prev };
      delete next[firstLog.id];
      return next;
    });
    if (remainingLogs.length === 0) {
      clearPreSessionReview();
    } else {
      const timing = calculateBasicReviewGroupTiming(
        logs,
        preSessionReviewParentSubjectId || firstLog.subjectId,
        subjects,
        remainingLogs
      );
      setPreSessionReviewTargetSeconds(
        timing.estimatedMinutes > 0
          ? Math.max(1, Math.round(timing.estimatedMinutes * 60))
          : 0
      );
    }
  };

  const closePreSessionReview = () => {
    const signature = getReviewGroupSignature(preSessionReviewLogs);
    if (signature) setDismissedReviewSignature(signature);
    const shouldResumeTimer = preSessionReviewMode === 'interrupt' && resumeStudyTimerAfterReview;
    clearPreSessionReview();
    if (shouldResumeTimer) setIsTimerRunning(true);
  };

  useEffect(() => {
    if (step !== 'idle' || !pendingImmediateStartSubjectId || subjectId !== pendingImmediateStartSubjectId) return;

    setPendingImmediateStartSubjectId(null);
    startMeasurementNow();
  }, [pendingImmediateStartSubjectId, step, subjectId]);

  const handleTimerComplete = () => {
    let elapsedSeconds = accumulatedSecondsRef.current;
    if (startTimeRef.current !== null) {
      const currentElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const nextTotalSeconds = accumulatedSecondsRef.current + currentElapsed;
      const missingTimerSeconds = Math.max(0, nextTotalSeconds - seconds);
      accumulatedSecondsRef.current = nextTotalSeconds;
      elapsedSeconds = nextTotalSeconds;
      if (missingTimerSeconds > 0) {
        const timerId = selectedSessionTimerIdRef.current;
        activeTimerSecondsRef.current[timerId] =
          (activeTimerSecondsRef.current[timerId] || 0) + missingTimerSeconds;
      }
      setSeconds(accumulatedSecondsRef.current);
      startTimeRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsTimerRunning(false);
    const completedTimerSeconds = { ...activeTimerSecondsRef.current };
    const completedTimerPageSeconds = { ...activeTimerCompletedSecondsRef.current };
    const completedTimerPages = { ...activeTimerPagesRef.current };
    setSessionTimerSeconds(completedTimerSeconds);
    setSessionTimerCompletedSeconds(completedTimerPageSeconds);
    setSessionTimerPages(completedTimerPages);
    setSessionTimerPageSeconds({ ...activeTimerPageSecondsRef.current });
    if (step === 'timer' && selectedSubject) {
      const nextStartPage = activeReviewRun ? reviewStartPage : activeSubjectStage?.currentPage || selectedSubject.completedPages + 1;
      setStartPage(formatPageNumber(nextStartPage));
      const nextReadAmount = expectedReadAmount > 0
        ? formatPageNumber(stageChapters.length > 0
          ? endPageForSolved(stageChapters, nextStartPage, expectedReadAmount) ?? calculateEndPageValue(nextStartPage, expectedReadAmount)
          : calculateEndPageValue(nextStartPage, expectedReadAmount))
        : formatPageNumber(nextStartPage);
      setReadAmount(nextReadAmount);
      setInitialReadAmount(nextReadAmount);
      setSolvedPageCount(formatPageNumber(expectedReadAmount > 0 ? expectedReadAmount : 1));
    }
    if (step === 'timer') {
      setStudySeconds(elapsedSeconds);
      accumulatedSecondsRef.current = organizationSeconds;
      setSeconds(organizationSeconds);
      setStep('organize');
      setIsTimerRunning(true);
    } else {
      setOrganizationSeconds(elapsedSeconds);
      setMinutes(getSessionTimes(studySeconds, elapsedSeconds).timeSpentMinutes);
      setStep('pages');
    }
  };

  const handleReturnToMeasurement = () => {
    if (Number(solvedPageCount) !== attackCompletedPages) {
      setAttackCompletedPages(Math.max(0, Number(solvedPageCount) || 0));
      resetPageAttackTimer(averageSecondsPerPage);
    }
    accumulatedSecondsRef.current = studySeconds;
    lastAttackSecondRef.current = studySeconds;
    setSeconds(studySeconds);
    setStep('timer');
    setIsTimerRunning(true);
  };

  const createCurrentSessionLog = () => {
    const sPage = parseFloat(startPage);
    const endPage = parseFloat(readAmount);
    const measurement = createPageMeasurement(sPage, endPage, Number(solvedPageCount), remainingSubjectPages, stageChapters);
    const shouldSkipReview = skipReview;

    if (measurement === null) {
      alert('끝 페이지와 푼 장수를 확인해주세요.');
      return null;
    }

    // 이어 쓴 노트지라면 새로 쓴 부분만 이번 기록의 노트로 저장하고, 고쳐진 이전 기록의 노트는 따로 모아 둔다.
    const carriedParts = sheetPartsRef.current;
    const sheet = carriedParts.length > 0 ? splitNoteSheet(carriedParts, reviewMemo) : null;
    sheetUpdatesRef.current = sheet ? sheet.updates : [];
    const savedMemo = sheet ? sheet.added : reviewMemo;

    return {
      id: Math.random().toString(36).substr(2, 9),
      subjectId,
      ...(activeReviewRun ? { reviewParentSubjectId: activeReviewRun.parentSubjectId, reviewPageRangeBased: true } : {}),
      reviewBaselineTimePerPage: activeReviewTiming?.baselineTimePerPage,
      ...measurement,
      pomodoroSession: true,
      ...getSessionTimes(studySeconds, organizationSeconds),
      timestamp: new Date().toISOString(),
      studyDate: activeStudyDate,
      studyWeekday: activeWeekday,
      isReviewed: false,
      isCondensed: shouldSkipReview,
      reviewMemo: savedMemo || undefined,
      reviewMemoDocument: sheet ? undefined : reviewMemoDocument,
      reviewEnabled: !shouldSkipReview
    };
  };

  const getReviewMeasurement = (log: StudyLog): ReviewMeasurement => ({
    pagesRead: log.pagesRead,
    baselineTimePerPage: activeReviewTiming?.baselineTimePerPage || 0,
    timeAttackMinutes: log.timeAttackMinutes,
    baselineTimeAttackPerPage: activeReviewAttackTiming?.baselineTimePerPage || 0,
    lastEndPage: log.endPage!,
    measurementId: log.id
  });

  const applyCarriedSheetEdits = () => {
    sheetUpdatesRef.current.forEach(update => onUpdateReviewMemo(update.logId, update.memo));
    sheetUpdatesRef.current = [];
    sheetPartsRef.current = [];
  };

  // 새로 쓴 노트가 이전 쪽의 같은 속성·이름과 겹치면 이전 쪽에 연결·첨가로 합친다(새 노트의 글은 그대로 두고, 합치기 전 글은 되돌릴 수 있게 기록한다).
  const mergeNewNoteIntoEarlierPages = (nextLog: StudyLog) => {
    const memo = nextLog.reviewMemo ?? '';
    if (!memo.trim()) return;
    const carried = new Map(sheetUpdatesRef.current.map(update => [update.logId, update.memo]));
    const earlier = logs
      .filter(log => log.subjectId === nextLog.subjectId && !log.reviewParentSubjectId && log.timestamp < nextLog.timestamp
        && (carried.get(log.id) ?? log.reviewMemo ?? '').trim().length > 0)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map(log => ({ id: log.id, memo: carried.get(log.id) ?? log.reviewMemo ?? '' }));
    const updates = withLogShorthand(nextLog, () => mergeNoteIntoEarlier(memo, earlier));
    if (!updates.length) return;
    recordNoteMerges(nextLog.id, updates);
    sheetUpdatesRef.current = [
      ...sheetUpdatesRef.current.filter(update => !updates.some(merged => merged.logId === update.logId)),
      ...updates.map(update => ({ logId: update.logId, memo: update.after }))
    ];
  };

  const chosenFeedbackGrade = (): SubjectGrade => feedbackChoice ?? feedbackInfo?.recommended ?? 'good';

  const handleFinalSave = () => {
    const created = createCurrentSessionLog();
    if (!created) return;
    // 복습과목을 재는 중에 "저장 완료"로 이번 복습에 남은 장수를 다 채웠으면 그 복습은 끝난 것이다: "복습 완료"와 같이 마친다.
    // (예전에는 복습이 남은 0장으로 오늘 할 일에 그대로 남아 "측정 필요 · 필요 횟수 0회"로 보였다)
    if (activeReviewRun && activeReviewTiming && activeReviewTiming.pages > 0 && created.pagesRead >= activeReviewTiming.remainingPages) {
      handleSwitchToNextReviewSubject();
      return;
    }
    // 공부 기록의 난도는 저장할 때 묻지 않는다: 복습 대기로 두었다가 "복습에 넣기"를 누를 때 고른 난도가 첫 복습 날짜를 정한다(FSRS-6).
    // 복습 측정 기록은 피드백만 남기고, 일정은 복습 완료 때 원래 기록이 갱신한다.
    const nextLog: StudyLog = activeReviewRun ? { ...created, feedbackGrade: chosenFeedbackGrade() } : created;

    setPendingAutoAdvanceLogId(null);
    // 복습에 넣기를 기다리는 기록의 새 노트는 이전 쪽 노트에 아직 합치지 않는다(29일 버그: 누르지 않아도 이전 노트가 바뀌었다).
    // "복습에 넣기"를 누를 때 합친다(App.handleRegisterReview). 기다리지 않는 기록(복습 측정 등)은 전처럼 바로 합친다.
    if (activeReviewRun || !willWaitForReview(nextLog)) mergeNewNoteIntoEarlierPages(nextLog);
    applyCarriedSheetEdits();
    onLogSession(nextLog);
    if (activeReviewRun) onRecordReviewSubjectTime(activeReviewRun.logIds, subjectId, nextLog.timeSpentMinutes, getReviewMeasurement(nextLog));
    resetAll();
    setSubjectId('');
    setPostSaveNextSubjectId(null);
  };

  const handleSwitchToNextReviewSubject = (repeat = false) => {
    if (!activeReviewRun || !selectedSubject) return;

    const completedReviewSubjectId = selectedSubject.id;
    const created = createCurrentSessionLog();
    if (!created) return;
    const grade = chosenFeedbackGrade();
    const nextLog: StudyLog = { ...created, feedbackGrade: grade };

    // 다시 예약하면 그 기록의 다음 복습도 난도 피드백(FSRS-6)이 정한다
    const parentLog = logs.find(log => log.id === activeReviewRun.logIds[0]);
    const savedLog = repeat ? createRepeatedSubjectReview(nextLog, activeReviewRun.parentSubjectId,
      Math.max(0, ...logs.filter(log => activeReviewRun.logIds.includes(log.id)).map(log => log.reviewStep || 0)), Date.now(),
      parentLog ? gradeSubjectCard(parentLog, grade, Date.now()) : undefined) : nextLog;
    applyCarriedSheetEdits();
    onLogSession(savedLog);

    const nextId = nextReviewRunSubject ? nextReviewRunSubjectId : null;
    onAdvanceReviewSubject(activeReviewRun.logIds, completedReviewSubjectId, nextId, nextLog.timeSpentMinutes, getReviewMeasurement(nextLog), grade);
    if (nextId === null) {
      setHandledReviewLogIds(prev => Array.from(new Set([...prev, ...activeReviewRun.logIds])));
    }
    const run = activeReviewRun;
    resetAll();
    setSelectedTaskKey('');
    setInspectedRecordDetailId('');
    // 이어지는 복습과목이 있으면 그 자리에서 바로 잰다(문제 → 첫 복습과목처럼, 21:52 "자동으로 복습 과목이 시작되도록")
    if (nextId && nextReviewRunSubject) {
      setActiveReviewRun({ ...run, currentIndex: run.reviewSubjectIds.indexOf(nextId), startPage: undefined, stageId: undefined });
      selectSubjectForMeasurement(nextReviewRunSubject);
      setPostSaveNextSubjectId(null);
      setPendingImmediateStartSubjectId(nextReviewRunSubject.id);
      return;
    }
    setPendingAutoAdvanceLogId(nextLog.id);
    setSubjectId('');
    setPostSaveNextSubjectId(null);
  };

  const renderPreSessionReviewOverlay = () => {
    if (preSessionReviewLogs.length === 0) return null;
    const batch = gatePractice ? getPracticeBatch(gatePractice, gateReviewQuestions) as GateReviewQuestion[]
      : [];
    const kindOf = (question: GateReviewQuestion) => {
      if (question.presentation?.convert) return convertLabel(question.presentation.convert);
      const note = preSessionGateMemoItems.find(item => item.log.id === question.logId)?.parsed.questions.find(item => item.key === question.questionKey);
      return note ? REVIEW_QUESTION_KIND_LABELS[note.kind] : '문제';
    };
    const rail: ReviewRailItem[] = batch.map((question, index) => {
      const wrongCount = gatePractice?.wrongCounts[question.id] || 0;
      const status: ReviewRailItem['status'] = gatePractice?.completed.includes(question.id) ? 'done'
        : gateQuestionQueue[0] === question.id ? 'now' : wrongCount > 0 ? 'wrong' : 'waiting';
      return { id: question.id, label: `${index + 1}번 · ${kindOf(question)}`, status, wrongCount };
    });
    const graded = batch.filter(question => gatePractice && question.id in gatePractice.firstCorrect);
    const currentId = currentGateQuestion?.id || '';
    const coverOf = (question: GateReviewQuestion) => question.covered ?? [{ logId: question.logId, questionKey: question.questionKey }];
    const scheduleOf = (cover: { logId: string; questionKey: string }) => {
      const log = preSessionGateMemoItems.find(item => item.log.id === cover.logId)?.log;
      return log ? getReviewQuestionSchedules(log)[cover.questionKey] : undefined;
    };
    const previousSchedule = currentGateQuestion ? scheduleOf(coverOf(currentGateQuestion)[0]) : undefined;
    const currentWrongs = gatePractice?.wrongCounts[currentId] || 0;
    const currentAttempts = gatePractice?.attempts[currentId] || 0;
    // 평가마다 다음 복습: 문제가 맡은 단위 중 가장 빠른 것을 보여 준다. 걸린 시간 추천은 첫 시도에만 한다.
    const nowMs = Date.now();
    const gradeIntervalLabels = currentGateQuestion && isGateAnswerRevealed ? (['again', 'hard', 'good', 'easy'] as ReviewGrade[]).reduce((labels, grade) => {
      const intervals = coverOf(currentGateQuestion).map(cover => previewGradeIntervals(scheduleOf(cover), nowMs, isConvertUnitKey(cover.questionKey))[grade]);
      return { ...labels, [grade]: formatReviewInterval(Math.min(...intervals)) };
    }, {} as Record<ReviewGrade, string>) : undefined;
    const currentNoteQuestion = currentGateQuestion?.presentation
      ?? (currentGateQuestion ? currentGateMemoItem?.parsed.questions.find(item => item.key === currentGateQuestion.questionKey) : undefined);
    const recommendedGrade = isGateAnswerRevealed && gateRevealMs !== null && currentAttempts === 0 && currentNoteQuestion
      ? recommendReviewGrade({ elapsedMs: gateRevealMs, history: previousSchedule?.responseMs, textLength: currentNoteQuestion.answer.length }) : null;
    const maskedKeysFor = (item: typeof preSessionGateMemoItems[number]) => {
      const schedules = getReviewQuestionSchedules(item.log);
      return item.parsed.questions.filter(question => {
        const previous = schedules[question.key];
        const entry = gateReviewQuestions.find(gate => gate.covered
          ? gate.covered.some(cover => cover.logId === item.log.id && cover.questionKey === question.key)
          : gate.logId === item.log.id && gate.questionKey === question.key);
        const practice = gatePractice;
        const done = Boolean(entry && practice?.completed.includes(entry.id));
        return previous?.masked || (previous?.intervalMs || 0) >= 8 * 86400000
          || (done && calculateQuestionPerformance(previous, practice!.wrongCounts[entry!.id] || 0, practice!.attempts[entry!.id] || 0,
            { grades: practice!.grades[entry!.id], nowMs, unit: isConvertUnitKey(question.key) }).masked);
      }).map(question => question.key);
    };
    const maskedByItem = isGateReviewComplete ? preSessionGateMemoItems.map(item => ({ item, maskedKeys: maskedKeysFor(item) })) : [];
    const finishLabel = !isGateReviewComplete
      ? `남은 문제 ${gateQuestionQueue.length}`
      : preSessionReviewGroup && getAvailableReviewSubjectIds(
        preSessionReviewGroup.reviewSubjectIds,
        subjects.find(subject => subject.id === preSessionReviewGroup.parentSubjectId),
        subjects
      ).length > 0
        ? '복습과목 시작'
        : preSessionReviewMode === 'interrupt'
          ? '복습 완료 후 계속'
          : preSessionReviewMode === 'after-study'
            ? '기본 복습 완료'
            : subjectId
              ? '복습 완료 후 학습 시작'
              : '복습 완료';
    return (
      <ReviewPracticeScreen
        title="기본 복습"
        isRetry={Boolean(preSessionReviewGroup?.isGateRetry)}
        subjectName={preSessionReviewSubjectName || selectedSubject?.name || '복습'}
        rangeLabel={formatMergedReviewRanges(preSessionReviewLogs, pageLabel)}
        elapsed={formatTime(preSessionReviewSeconds)}
        targetRemaining={preSessionReviewTargetSeconds > 0
          ? formatTime(reviewPomodoro?.remainingSeconds ?? 0) : '--:--'}
        timeUp={isReviewTimeUp}
        pomodoroMinutes={pomodoroMinutes}
        pomodoroRound={reviewPomodoro && reviewPomodoro.rounds > 1 ? { round: reviewPomodoro.round, rounds: reviewPomodoro.rounds } : undefined}
        notice={reviewPomodoro && reviewCompletedRounds > dismissedReviewRound
          ? <PomodoroNotice message={`${reviewPomodoro.rounds === 1 ? '뽀모도로가 끝났어요'
            : reviewPomodoro.finished ? `뽀모도로 ${reviewPomodoro.rounds}회를 모두 마쳤어요`
              : `뽀모도로 ${reviewCompletedRounds}/${reviewPomodoro.rounds}회가 끝났어요`} · 잠깐 쉬어가도 좋고, 이어서 복습해도 돼요`}
            onDismiss={() => setDismissedReviewRound(reviewCompletedRounds)} /> : undefined}
        isRunning={isPreSessionReviewRunning}
        canPause
        pauseLabel={isPreSessionReviewRunning ? '잠시 중단' : '계속 복습'}
        onTogglePause={() => setIsPreSessionReviewRunning(prev => !prev)}
        onClose={closePreSessionReview}
        onCondenseFirst={condenseFirstPreSessionReview}
        level={gatePractice?.level || 1}
        maxLevel={gatePractice ? getReviewPracticeLevel(gatePractice) : 1}
        onChangeLevel={handleGateLevelChange}
        round={gateRoundNumber}
        roundSize={gateRoundQuestionCount}
        queueLength={gateQuestionQueue.length}
        hasQuestions={gateReviewQuestions.length > 0}
        isComplete={isGateReviewComplete}
        question={renderCurrentGatePrompt()}
        questionTools={currentGateQuestion && currentGateMemoItem && onRemoveReviewQuestions ? (
          <ReviewQuestionTools key={currentGateQuestion.id} covers={gateCoverOf(currentGateQuestion)} memos={gateRemovalMemos} setMemos={gateSubjectMemos}
            oldLines={gateOldLines} onRemove={handleRemoveGateQuestion} onEdit={handleEditGateLines} />
        ) : undefined}
        removalNotice={gateRemovalNotice ? (
          <div role="status" data-testid="removal-notice" className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-slate-300 bg-white px-4 py-3">
            <span className="min-w-0 flex-1 break-words text-sm font-bold text-slate-900">
              {gateRemovalNotice.kind === 'removed' ? `복습에서 뺐어요 · ${REMOVE_REASON_LABELS[gateRemovalNotice.reason]}${gateRemovalNotice.text ? ` · ${gateRemovalNotice.text}` : ''}` : gateRemovalNotice.text}
            </span>
            {gateRemovalNotice.kind === 'removed' && <button type="button" onClick={handleUndoGateRemoval}
              className="h-10 shrink-0 rounded-xl border-2 border-slate-300 bg-white px-4 text-sm font-black text-slate-800 hover:bg-slate-50">되돌리기</button>}
            <button type="button" aria-label="안내 닫기" onClick={() => setGateRemovalNotice(null)}
              className="h-10 shrink-0 rounded-xl px-3 text-sm font-black text-slate-600 hover:bg-slate-100">닫기</button>
          </div>
        ) : undefined}
        questionRange={currentGateQuestion?.range || ''}
        hasCurrentQuestion={Boolean(currentGateQuestion && currentGateMemoItem)}
        revealed={isGateAnswerRevealed}
        onReveal={handleGateReveal}
        onGrade={handleGateReviewResult}
        correctIntervalLabel={formatReviewInterval(calculateQuestionPerformance(previousSchedule, currentWrongs, currentAttempts + 1).intervalMs)}
        wrongIntervalLabel={formatReviewInterval(calculateQuestionPerformance(previousSchedule, currentWrongs + 1, currentAttempts + 1).intervalMs)}
        gradeIntervalLabels={gradeIntervalLabels}
        recommendedGrade={recommendedGrade}
        responseLabel={isGateAnswerRevealed && gateRevealMs !== null && currentAttempts === 0 ? formatResponseSeconds(gateRevealMs) : undefined}
        cardRef={gateQuestionCardRef}
        rail={rail}
        firstTryCorrect={graded.filter(question => gatePractice?.firstCorrect[question.id]).length}
        firstTryTotal={graded.length}
        firstTryOk={(gatePractice?.completed.length || 0) - gateWrongCount}
        firstTryBad={gateWrongCount}
        completion={(
          <div className="flex flex-col gap-4">
            {maskedByItem.some(entry => entry.maskedKeys.length > 0) && (
              <p className="text-sm font-medium leading-relaxed text-slate-700">복습 간격이 8일에 닿은 답은 가려져요. 가려진 칸을 누르면 원문이 보이고, 다시 누르면 가려져요.</p>
            )}
            {maskedByItem.map(({ item, maskedKeys }) => (
              <section key={item.log.id} className="space-y-2">
                <h4 className="text-sm font-bold text-slate-700">{item.range} · 정리노트</h4>
                <ReviewNoteSummary memo={item.memo} maskedKeys={maskedKeys} />
              </section>
            ))}
          </div>
        )}
        feedback={basicFeedback && isGateReviewComplete && gateQuestionGrade ? (() => {
              // 복습 문제가 있었으면 나머지 복습의 등급은 문제 첫 답변 중 가장 많은 값으로 정해진다(고르지 않는다)
              const firstLog = preSessionReviewLogs[0];
              const nowMs = Date.now();
              const withResults = firstLog ? applyReviewGateOutcomes([firstLog], buildGateOutcomes(), false, nowMs)[0] : null;
              const intervals = previewReviewCompletionIntervals(withResults, nowMs);
              return <section aria-label="다음 복습" data-question-grade={gateQuestionGrade} className="w-full rounded-2xl border border-indigo-100 bg-white p-4">
                <h4 className="text-base font-black text-indigo-800">다음 복습</h4>
                <p className="mt-1 text-sm font-bold text-slate-700">복습 문제 첫 답변 중 가장 많았던 <b className="text-indigo-800">{SUBJECT_GRADE_LABELS[gateQuestionGrade]}</b>으로 나머지 복습 주기를 정해요 · 다음 복습 {formatReviewInterval(intervals[gateQuestionGrade])} 뒤</p>
                <p className="mt-1 text-[13px] font-bold text-slate-600">문제는 문제마다 첫 답변대로 따로 주기가 정해져요. 시간은 계속 재고 있으니 노트와 페이지를 더 복습한 뒤 마치세요.</p>
              </section>;
            })() : basicFeedback && isGateReviewComplete ? (() => {
              const selected = basicFeedbackChoice ?? basicFeedback.recommended ?? 'good';
              const firstLog = preSessionReviewLogs[0];
              const nowMs = Date.now();
              const withResults = firstLog ? applyReviewGateOutcomes([firstLog], buildGateOutcomes(), false, nowMs)[0] : null;
              const intervals = previewReviewCompletionIntervals(withResults, nowMs);
              const label = getPageLabel(subjects.find(subject => subject.id === preSessionReviewGroup?.parentSubjectId));
              return <section aria-label="난도 피드백" data-basic-feedback="true" className="w-full rounded-2xl border border-indigo-100 bg-white p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h4 className="text-base font-black text-indigo-800">난도 피드백</h4>
                  <p className="text-sm font-black text-slate-700">이번 속도 <span className="text-2xl text-indigo-700">{formatSpeed(basicFeedback.speed, label)}</span></p>
                </div>
                <p className="mt-1 text-[13px] font-bold text-slate-700">평균 속도 {formatSpeed(basicFeedback.averageSpeed, label)}{basicFeedback.averageSpeed === null ? ' · 지난 기록이 없어요' : ''}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {SUBJECT_GRADES.map(grade => <button key={grade} type="button" data-basic-feedback-grade={grade} aria-pressed={selected === grade}
                    data-recommended={basicFeedback.recommended === grade ? 'true' : undefined} onClick={() => setBasicFeedbackChoice(grade)}
                    className={`relative flex min-h-[4.5rem] flex-col items-start justify-center gap-0.5 rounded-xl border-2 px-3 py-2 text-left ${selected === grade ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-500' : 'border-slate-200 bg-slate-50'}`}>
                    {basicFeedback.recommended === grade && <span className="absolute -top-2.5 right-2 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-black text-white">추천</span>}
                    <span className="text-base font-black text-slate-900">{SUBJECT_GRADE_LABELS[grade]}</span>
                    <span className="text-xs font-bold text-slate-600">다음 복습 {formatReviewInterval(intervals[grade])} 뒤</span>
                  </button>)}
                </div>
              </section>;
            })() : undefined}
        finishLabel={finishLabel}
        canFinish={isGateReviewComplete}
        onFinish={finishPreSessionReview}
      />
    );
  };

  // 과목 상태 셀: 할 일(중요한 순) → 오늘 할 양을 모두 끝낸 과목(회색).
  // 완료 기록 값은 끝낸 과목에만 붙인다. 아직 할 일이 남은 과목에는 이미 한 만큼이 있어도 보여주지 않는다.
  const completedDetailRows = buildCompletedDetailRows(logs, subjects, completedStudySubjectIds, activeStudyDate);
  const toDoneData = (row: (typeof completedDetailRows)[number]) => (
    { summary: row.summary, growth: row.growth, short: row.short, pages: row.pages, minutes: row.minutes }
  );
  const pendingCards: TaskCardData[] = runQueueItems.map(item => {
    const timeLabel = item.estimatedMinutes > 0 ? formatPlanMinutes(item.estimatedMinutes) : '측정 필요';
    const detailKey = getRunQueueDetailKey(item);
    if (item.kind === 'review') {
      const group = item.reviewGroup;
      return {
        key: item.key, detailKey, kind: 'review', required: item.isRequired, timeLabel, state: 'pending',
        kindLabel: group.isGateRetry ? '오답 복습' : group.reviewType === 'basic' ? '기본 복습' : '과목 복습',
        title: `${item.name}${group.parentSubjectName !== item.name ? ` · ${group.parentSubjectName}` : ''}`,
        meta: `범위 ${formatMergedReviewRanges(group.logs, getPageLabel(subjects.find(subject => subject.id === group.parentSubjectId)))}`
      };
    }
    const studyLabel = getPageLabel(item.studyItem.subject);
    const studyPos = pagePositionLabel(studyLabel);
    const activeStage = getActiveSubjectStage(item.studyItem.subject);
    const start = activeStage?.currentPage || item.studyItem.subject.completedPages + 1;
    const recommended = item.studyItem.remainingDayPages;
    return {
      key: item.key, detailKey, kind: 'study', required: item.isRequired, timeLabel, state: 'pending',
      // 후행과목으로 넘어간 과목은 지금 공부하는 후행과목 이름으로 부른다(본 과목 이름은 상세 칸 제목의 앞쪽에 남아 있다)
      kindLabel: '학습', title: activeStage && activeStage.id !== item.studyItem.subject.id ? activeStage.name : item.name,
      meta: recommended > 0
        ? `오늘 권장 ${studyPos}.${formatPageNumber(start)}~${formatPageNumber(getRecommendedEndPage(item.studyItem.subject, getActiveSubjectStage(item.studyItem.subject), start, recommended))} · ${formatPageNumber(recommended)}${studyLabel}`
        : `시작 ${studyPos}.${formatPageNumber(start)}`
    };
  });
  // 같은 과목 복습이 범위별로 나뉘어 같은 이름의 칸이 여럿이면 이름 뒤에 범위를 붙여 구분한다.
  pendingCards.forEach(card => {
    if (card.kind !== 'review' || pendingCards.filter(other => other.detailKey === card.detailKey).length < 2) return;
    const item = runQueueItems.find(queued => queued.key === card.key);
    if (item?.kind === 'review') {
      const reviewSubject = subjects.find(subject => subject.id === item.reviewGroup.parentSubjectId);
      const reviewLabel = getPageLabel(reviewSubject);
      card.title = `${item.name} ${pagePositionLabel(reviewLabel)}.${formatMergedReviewRanges(item.reviewGroup.logs, reviewLabel)}`;
    }
  });
  const pendingDetailKeys = new Set(pendingCards.map(card => card.detailKey));
  const doneCards: TaskCardData[] = completedDetailRows.filter(row => !pendingDetailKeys.has(row.detailId)).map(row => ({
    key: `done-${row.detailId}`, detailKey: row.detailId, kind: row.kind, kindLabel: row.kindLabel, title: row.title,
    meta: '', required: row.kind === 'study' && isSubjectRequiredNow(subjects.find(subject => subject.id === row.detailId)),
    timeLabel: '', state: 'done', done: toDoneData(row)
  }));
  const allCards: TaskCardData[] = [...pendingCards, ...doneCards];
  // 지금 보고 있는 칸(고유 키). 같은 과목 키를 가진 칸이 여럿이어도(과목 복습이 범위별로 나뉜 경우) 정확히 하나를 가리킨다.
  const viewingDoneCard = doneCards.find(card => card.detailKey === detailSubjectId && inspectedRecordDetailId === detailSubjectId);
  const currentRowKey = viewingDoneCard?.key ?? selectedRunQueueItem?.key ?? '';
  // 같은 과목은 한 칸이다: 일반 과목의 기본 복습은 현재 과목 칸에, 복습과목의 기본 복습은 복습과목 칸에 들어간다.
  // 칸 안 순서는 기본 복습 → 과목이고, 칸에는 지금 할 차례의 할 일이 대표로 보이며(시작 버튼도 그 할 일), 나머지는 상세 칸에 한 줄 정보로만 나온다.
  const cellIdOfCard = (card: TaskCardData) => {
    const item = runQueueItems.find(queued => queued.key === card.key);
    if (item) return runQueueCellId(item);
    return card.detailKey.startsWith(BASIC_REVIEW_DETAIL_PREFIX) ? card.detailKey.slice(BASIC_REVIEW_DETAIL_PREFIX.length) : card.detailKey;
  };
  const cellRankOfCard = (card: TaskCardData) => {
    const item = runQueueItems.find(queued => queued.key === card.key);
    return item ? runQueueCellRank(item) : card.detailKey.startsWith(BASIC_REVIEW_DETAIL_PREFIX) ? 0 : 1;
  };
  const cellIds: string[] = [];
  const cellBuckets = new Map<string, TaskCardData[]>();
  allCards.forEach(card => {
    const id = cellIdOfCard(card);
    if (!cellBuckets.has(id)) { cellBuckets.set(id, []); cellIds.push(id); }
    cellBuckets.get(id)!.push(card);
  });
  const cellOfKey = new Map<string, TaskCardData[]>();
  const taskCards: TaskCardData[] = cellIds.map(id => {
    const raw = cellBuckets.get(id)!;
    const bucket = [...raw.filter(card => card.state === 'pending').sort((a, b) => cellRankOfCard(a) - cellRankOfCard(b)),
      ...raw.filter(card => card.state === 'done').sort((a, b) => cellRankOfCard(a) - cellRankOfCard(b))];
    bucket.forEach(card => cellOfKey.set(card.key, bucket));
    if (bucket.length === 1) return bucket[0];
    const pending = bucket.filter(card => card.state === 'pending');
    const lead = bucket[0];
    const minutes = pending.reduce((sum, card) => sum + Math.max(0, runQueueItems.find(queued => queued.key === card.key)?.estimatedMinutes ?? 0), 0);
    const doneRows = bucket.filter(card => card.state === 'done' && card.done);
    const pageLabel = getPageLabel(subjects.find(subject => subject.id === id));
    const doneTotal = doneRows.reduce((sum, card) => ({ pages: sum.pages + (card.done?.pages ?? 0), minutes: sum.minutes + (card.done?.minutes ?? 0) }), { pages: 0, minutes: 0 });
    const doneNumber = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, ''));
    return {
      ...lead,
      title: subjects.find(subject => subject.id === id)?.name ?? lead.title,
      kindLabel: Array.from(new Set((pending.length ? pending : [lead]).map(card => card.kindLabel))).join('·'),
      required: pending.some(card => card.required),
      timeLabel: pending.length ? (minutes > 0 ? formatPlanMinutes(minutes) : '측정 필요') : '',
      state: pending.length ? 'pending' : 'done',
      done: pending.length ? undefined : { ...lead.done!, summary: `${doneNumber(doneTotal.pages)}${pageLabel} · ${formatDoneMinutes(doneTotal.minutes)}`, short: `${doneNumber(doneTotal.pages)}${pageLabel} · ${formatDoneMinutes(doneTotal.minutes)}`, pages: doneTotal.pages, minutes: doneTotal.minutes }
    };
  });
  const currentCell = cellOfKey.get(currentRowKey);
  // 지금 보는 칸의 대표 카드 키(화살표 위치와 강조에 쓴다)
  const currentChipKey = currentCell ? currentCell[0].key : currentRowKey;
  // 같은 칸의 나머지 할 일(뒷순서 · 끝낸 것)은 한 줄 정보로만 둔다.
  const laterMembers: LaterMemberData[] = (currentCell ?? []).filter(card => card.key !== currentRowKey).map(card => ({
    key: card.key, kind: card.kind, label: card.kindLabel, state: card.state,
    text: card.state === 'done' ? `✓ ${card.done?.short ?? '완료'}` : [card.meta, card.timeLabel].filter(Boolean).join(' · ')
  }));
  // 화살표 한 번의 이동은 칸 하나씩이다(칸 안의 뒷순서 할 일은 그 차례가 되어야 자세히 보인다).
  const stepTaskRow = (delta: -1 | 1) => {
    const targetKey = stepRowKey(taskCards.map(card => card.key), currentChipKey, delta);
    const target = taskCards.find(card => card.key === targetKey);
    if (!target) return;
    if (target.state === 'done') {
      setInspectedRecordDetailId(target.detailKey);
    } else {
      setInspectedRecordDetailId('');
      setSelectedTaskKey(target.key);
    }
    onDetailSubjectChange(target.detailKey);
  };
  // 범위로 나뉜 복습이 한 칸으로 합쳐진 경우: 상세 칸 맨 위 탭(전체 | 범위마다)으로 지표를 다르게 본다. 시작은 어느 탭에서든 전체.
  const currentReviewItem = !viewingDoneCard && selectedRunQueueItem?.kind === 'review' ? selectedRunQueueItem : undefined;
  const currentRangeGroups = currentReviewItem?.reviewGroup.rangeGroups;
  const currentRangeIndex = currentReviewItem && currentRangeGroups ? Math.min(rangeTabs[currentReviewItem.key] ?? -1, currentRangeGroups.length - 1) : -1;
  const rangeTabKey = (itemKey: string, index: number) => (index < 0 ? `all:${itemKey}` : `range:${itemKey}:${index}`);
  const rangePageLabel = getPageLabel(currentReviewItem ? subjects.find(subject => subject.id === currentReviewItem.reviewGroup.parentSubjectId) : undefined);
  const memberChoices: TaskMemberData[] | undefined = currentReviewItem && currentRangeGroups && currentRangeGroups.length >= 2 ? [
    { key: rangeTabKey(currentReviewItem.key, -1), detailKey: getRunQueueDetailKey(currentReviewItem), kind: 'review', label: '전체', state: 'pending', all: true },
    ...currentRangeGroups.map((group, index) => ({
      key: rangeTabKey(currentReviewItem.key, index), detailKey: getRunQueueDetailKey(currentReviewItem), kind: 'review' as const, state: 'pending' as const,
      label: `${pagePositionLabel(rangePageLabel)}.${formatMergedReviewRanges(group.logs, rangePageLabel)}`
    }))
  ] : undefined;
  const pickTaskMember = (key: string) => {
    if (!currentReviewItem) return;
    const index = key.startsWith('all:') ? -1 : Number(key.slice(key.lastIndexOf(':') + 1));
    if (Number.isFinite(index)) setRangeTabs(previous => ({ ...previous, [currentReviewItem.key]: index }));
  };
  // 지금 탭의 지표: 전체 탭이면 합친 복습 전체의 값, 범위 탭이면 그 범위의 값
  const reviewScope: ReviewScopeData | null = (() => {
    if (!memberChoices || !currentReviewItem || !currentRangeGroups) return null;
    const scoped = currentRangeIndex < 0 ? currentReviewItem.reviewGroup : currentRangeGroups[currentRangeIndex];
    return {
      range: `${pagePositionLabel(rangePageLabel)}.${formatMergedReviewRanges(scoped.logs, rangePageLabel)}`,
      pages: scoped.logs.reduce((sum, log) => sum + Math.max(0, log.pagesRead), 0),
      minutes: Math.max(0, scoped.estimatedMinutes),
      groups: currentRangeIndex < 0 ? currentRangeGroups.length : 1,
      pageLabel: rangePageLabel
    };
  })();
  // 상세 칸이 아직 따라오지 못한 순간(처음 그릴 때)에도 가장 중요한 할 일이 "지금"으로 보이게 한다.
  const currentDetailKey = allCards.some(card => card.detailKey === detailSubjectId)
    ? detailSubjectId
    : selectedRunQueueItem ? getRunQueueDetailKey(selectedRunQueueItem) : '';
  // 제목 줄에 붙는 요약(화살표 · 예상 소요 · 오늘 완료). 오늘 완료는 일부만 한 기록까지 합친 합계다.
  const completedTotals = buildCompletedSubjectSummaries(logs, subjects, completedStudySubjectIds, activeStudyDate)
    .reduce((sum, summary) => ({ pages: sum.pages + summary.pages, minutes: sum.minutes + summary.minutes }), { pages: 0, minutes: 0 });
  const formatTotal = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, ''));
  const taskSelector = (
    <TaskQueueList items={taskCards} currentKey={currentDetailKey} currentRowKey={currentChipKey} onRefresh={handleRefreshStudyPlans}
      stats={{ minutes: runQueueItems.reduce((sum, item) => sum + Math.max(0, item.estimatedMinutes), 0),
        completedLabel: `${formatTotal(completedTotals.pages)}P · ${formatDoneMinutes(completedTotals.minutes)}` }}
      stepper={{ position: taskCards.findIndex(card => card.key === currentChipKey) + 1, total: taskCards.length,
        done: Boolean(viewingDoneCard), onStep: stepTaskRow }} />
  );

  if (step === 'idle') {
    const selectedStudySubject = selectedRunQueueItem?.kind === 'study' ? selectedRunQueueItem.studyItem.subject : undefined;
    const selectedReviewGroup = selectedRunQueueItem?.kind === 'review' ? selectedRunQueueItem.reviewGroup : undefined;
    // 기본 복습 칸에 보여줄 계획: 복습할 장수(대기 기록들의 장수 합) · 합친 범위 · 장당 시간(뽀모도로 계산용)
    const toReviewPlan = (group: ReviewQueueGroup): ReviewPlanContext => ({
      detailKey: getReviewDetailKey(group.reviewType, group.parentSubjectId, group.subjectId),
      pages: group.logs.reduce((sum, log) => sum + Math.max(0, log.pagesRead), 0),
      rangeLabel: formatMergedReviewRanges(group.logs, getPageLabel(subjects.find(subject => subject.id === group.parentSubjectId))),
      minutesPerPage: group.averageTimePerPage,
      estimatedMinutes: group.estimatedMinutes
    });
    const extraReviewPlans: Record<string, ReviewPlanContext> = {};
    extraReviewGroups.forEach((group, key) => { if (group.reviewType === 'basic') extraReviewPlans[key] = toReviewPlan(group); });
    const idleContext: IdleSummaryContext = {
      queueCount: runQueueItems.length,
      queueMinutes: runQueueItems.reduce((sum, item) => sum + Math.max(0, item.estimatedMinutes), 0),
      selectedDetailKey: selectedRunQueueItem ? getRunQueueDetailKey(selectedRunQueueItem) : '',
      rowOrder: allCards.map(card => card.detailKey),
      doneOnlyKeys: doneCards.map(card => card.detailKey),
      selectedKind: selectedRunQueueItem?.kind ?? null,
      selectedName: selectedRunQueueItem?.name || '',
      startPage: selectedStudySubject ? getActiveSubjectStage(selectedStudySubject)?.currentPage || selectedStudySubject.completedPages + 1 : null,
      recommendedPages: selectedRunQueueItem?.kind === 'study' ? selectedRunQueueItem.studyItem.remainingDayPages : null,
      reviewPlan: selectedReviewGroup?.reviewType === 'basic' ? toReviewPlan(selectedReviewGroup) : null,
      extraReviewPlans,
      startButton: selectedRunQueueItem ? (
        <StartButton kind={selectedRunQueueItem.kind} onClick={() => selectedRunQueueItem.kind === 'review'
          ? startReviewGroup(selectedRunQueueItem.reviewGroup)
          : startStudyOrderItem(selectedRunQueueItem.studyItem)} />
      ) : null,
      currentRowDone: Boolean(viewingDoneCard),
      laterMembers, memberChoices, currentMemberKey: currentReviewItem && memberChoices ? rangeTabKey(currentReviewItem.key, currentRangeIndex) : '', onPickMember: pickTaskMember,
      reviewScope,
      extraReviewKeys: doneCards.filter(card => card.kind === 'review' && extraReviewGroups.has(card.detailKey)).map(card => card.detailKey),
      // 끝낸 과목에서 "추가 학습하기"로 다시 연 뒤 시작을 누르면 그 과목의 측정을 바로 시작한다(대기열에 없어도 된다).
      // 복습 칸이면 그 칸의 다음 복습을 앞당겨 시작한다.
      onExtraStudy: (detailKey: string) => {
        if (doneCards.some(card => card.detailKey === detailKey && card.kind === 'review')) {
          const group = extraReviewGroups.get(detailKey);
          if (group) startReviewGroup(group);
          return;
        }
        const subject = subjects.find(item => item.id === detailKey);
        if (!subject) return;
        selectSubjectForMeasurement(subject);
        setPostSaveNextSubjectId(null);
        setPendingImmediateStartSubjectId(subject.id);
      }
    };
    return (
      <div className="animate-fade-in">
        {renderPreSessionReviewOverlay()}
        {renderSummary(taskSelector, nextSubjectId => {
          const matchingTask = runQueueItems.find(item => getRunQueueDetailKey(item) === nextSubjectId);
          setInspectedRecordDetailId(matchingTask ? '' : nextSubjectId);
          if (matchingTask) setSelectedTaskKey(matchingTask.key);
          onDetailSubjectChange(nextSubjectId);
        }, completedStudySubjectIds, idlePomodoroPlan, idleContext)}
      </div>
    );
  }

  const isMeasuring = step === 'timer' || step === 'organize';
  const measuringGrid: React.CSSProperties = {
    backgroundColor: '#F7F9FF',
    backgroundImage: 'linear-gradient(#E8ECFB 1px, transparent 1px), linear-gradient(90deg, #E8ECFB 1px, transparent 1px)',
    backgroundSize: '24px 24px'
  };

  return (
    <div className={`fixed inset-0 flex flex-col items-center overflow-y-auto p-4 ${isMeasuring ? 'pt-20 lg:p-8' : 'justify-center bg-white'}`} style={isMeasuring ? { ...measuringGrid, zIndex: 9999 } : { zIndex: 9999 }}>
      {renderPreSessionReviewOverlay()}
      <button
        onClick={() => setIsConfirmingCancel(true)}
        className={`fixed top-5 right-5 w-10 h-10 rounded-full flex items-center justify-center shadow-sm active:scale-90 transition-all ${
          isMeasuring ? 'border border-slate-200 bg-white text-slate-500 hover:text-slate-800' : 'bg-slate-100 text-slate-500'
        }`}
      >
        <span className="text-2xl font-bold">×</span>
      </button>

      {isConfirmingCancel && (
        <div className="fixed inset-0 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm z-[10000]">
          <div className="bg-white w-full max-w-sm rounded-2xl p-6 text-center shadow-xl">
            <h4 className="text-xl font-black text-slate-900 mb-2">학습 측정을 중단할까요?</h4>
            <p className="text-slate-500 text-sm mb-6">기록은 저장되지 않고 사라집니다.</p>
            <div className="flex flex-col gap-3">
              <button onClick={resetAll} className="w-full py-4 bg-red-600 text-white rounded-2xl font-black">네, 취소합니다</button>
              <button onClick={() => setIsConfirmingCancel(false)} className="w-full py-4 bg-slate-100 text-slate-600 rounded-2xl font-black">계속 공부할게요</button>
            </div>
          </div>
        </div>
      )}

      <div className={`w-full ${isMeasuring ? 'max-w-[1440px]' : 'max-w-3xl'}`}>
        {(step === 'timer' || step === 'organize') && (
          <div className="flex w-full flex-col gap-4">
            <main className="order-2 w-full min-w-0" aria-label="학습 노트">
              <div className="w-full space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <button
                    type="button"
                    onClick={toggleMemoCollapsed}
                    aria-expanded={!isMemoCollapsed}
                    className="flex w-full items-center justify-between text-sm font-black text-indigo-700"
                  >
                    <span>세션 메모</span>
                    <span className={`text-lg transition-transform ${isMemoCollapsed ? '' : 'rotate-90'}`}>›</span>
                  </button>
                  {!isMemoCollapsed && (
                    <MemoColorTextarea
                      colorColons={colorMemoColons}
                      wrapperClassName="mt-2"
                      value={sessionMemo}
                      onChange={e => handleMemoChange(e.target.value)}
                      placeholder="세션 메모"
                      aria-label="세션 메모"
                      className="h-16 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-base font-bold text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-500"
                    />
                  )}
                </div>
                {(!skipReview || step === 'organize') && (
                  <div className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-center gap-2">
                      <label className="text-base font-black text-rose-700">정리노트</label>
                      <button type="button" aria-label="정리노트 색깔 구분" aria-pressed={colorMemoColons}
                        onClick={() => {
                          const next = !colorMemoColons;
                          setColorMemoColons(next);
                          localStorage.setItem('swp_memo_colon_colors', String(next));
                        }}
                        className={`rounded-md border px-2 py-1 text-xs font-bold transition-colors ${colorMemoColons ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-500 hover:text-slate-800'}`}>
                        색 {colorMemoColons ? 'ON' : 'OFF'}
                      </button>
                      <button type="button" aria-label="= 와 - 단축어" aria-pressed={noteShorthand}
                        title={selectedSubject ? `${selectedSubject.name} 노트에만 적용` : undefined}
                        onClick={toggleNoteShorthand}
                        className={`rounded-md border px-2 py-1 text-xs font-bold transition-colors ${noteShorthand ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-500 hover:text-slate-800'}`}>
                        = - {noteShorthand ? 'ON' : 'OFF'}
                      </button>
                      <button type="button" onClick={() => setShowNoteTutorial(true)}
                        className="ml-auto h-11 rounded-xl border-2 border-rose-200 bg-white px-4 text-sm font-black text-rose-700 transition-colors hover:bg-rose-50">
                        쓰는 법
                      </button>
                    </div>
                    {showNoteTutorial && <NoteTutorial onClose={() => setShowNoteTutorial(false)} />}
                    <NoteSetSourceContext.Provider value={noteSetMemos}>
                    <NoteSetEditContext.Provider value={rewriteSessionNotes}>
                    <ReviewMemoEditor
                      value={reviewMemo}
                      document={reviewMemoDocument}
                      colorColons={colorMemoColons}
                      onChange={(memo, document) => { setReviewMemo(memo); setReviewMemoDocument(document); }}
                      minHeight={320}
                      maxHeight={560}
                      placeholder="정리노트"
                      theme="light"
                      grid
                      symbolBar
                    />
                    </NoteSetEditContext.Provider>
                    </NoteSetSourceContext.Provider>
                  </div>
                )}
                {activeReviewRun && activeReviewRunMemoItems.length > 0 && isReviewCondensePanelOpen && timerMode !== 'sessionMemo' && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-500">축약</label>
                    <div className="mt-3 flex max-h-32 flex-wrap gap-2 overflow-y-auto pr-1">
                      {activeReviewRunMemoItems.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleCondenseActiveReviewLog(item.id)}
                          className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-slate-700 transition-all hover:border-rose-400 hover:bg-rose-500 hover:text-white"
                        >
                          {item.range}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {activeReviewRun && activeReviewRunMemoItems.length > 0 && isReviewNotePanelOpen && timerMode !== 'sessionMemo' && (
                  <div className="rounded-2xl border border-rose-200 bg-white p-4 shadow-sm">
                    <label className="text-xs font-black uppercase tracking-widest text-rose-700">복습 노트</label>
                    <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-rose-100 bg-rose-50/40 p-3 pr-2">
                      <div className="space-y-3">
                        {activeReviewRunMemoItems.map(item => (
                          <div key={item.id}>
                            <div className="mb-1 inline-flex rounded-lg bg-rose-100 px-2 py-1 text-xs font-black text-rose-700">
                              {item.range}
                            </div>
                            <ReviewMemoEditor
                              value={item.memo}
                              document={item.document}
                              colorColons={colorMemoColons}
                              onChange={(memo, document) => onUpdateReviewMemo(item.id, memo, document)}
                              minHeight={64}
                              maxHeight={220}
                              theme="light"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </main>
            <aside className="order-1 w-full" aria-label="학습 시간 측정">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span className={`px-3 py-1 rounded-full text-xs font-black ${
                activeReviewRun ? 'bg-rose-100 text-rose-700' : 'bg-indigo-100 text-indigo-700'
              }`}>
                {activeReviewRun ? '과목 복습 측정 중' : '측정 중'}
              </span>
              {activeReviewRun ? (
                <div className="min-w-0 text-xs font-black">
                  <p className="truncate text-sm text-rose-700">{activeReviewRun.sourceName} 복습</p>
                  <p className="truncate text-xl text-slate-900 md:text-2xl">{selectedSubject?.name}</p>
                </div>
              ) : (
                // 후행과목을 공부 중이면 그 후행과목 이름(본 과목 이름은 앞에 작게)
                activeSubjectStage && selectedSubject && activeSubjectStage.id !== selectedSubject.id ? (
                  <div className="min-w-0 text-xs font-black">
                    <p className="truncate text-sm text-slate-500">{selectedSubject.name}</p>
                    <p className="truncate text-xl text-slate-900 md:text-2xl">{activeSubjectStage.name}</p>
                  </div>
                ) : <p className="text-xl font-black text-slate-900 md:text-2xl">{selectedSubject?.name}</p>
              )}
                {activeReviewRun && (
                  <div className="ml-auto flex gap-2">
                    {activeReviewRunMemoItems.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setIsReviewNotePanelOpen(prev => !prev)}
                        className={`rounded-xl px-4 py-2 text-sm font-black transition-all ${
                          isReviewNotePanelOpen
                            ? 'bg-rose-500 text-white'
                            : 'border border-rose-200 bg-white text-rose-700 hover:bg-rose-500 hover:text-white'
                        }`}
                      >
                        {isReviewNotePanelOpen ? '노트 닫기' : '노트 보기'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsReviewCondensePanelOpen(prev => !prev)}
                      className={`rounded-xl px-4 py-2 text-sm font-black transition-all ${
                        isReviewCondensePanelOpen
                          ? 'bg-slate-800 text-white'
                          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      축약
                    </button>
                  </div>
                )}
            </div>
            {studyPomodoroRound > dismissedPomodoroRound && (
              <PomodoroNotice className="mb-3"
                message={`뽀모도로 ${studyPomodoroRound}회가 끝났어요 · 잠깐 쉬어가도 좋고, 이어서 풀어도 돼요`}
                onDismiss={() => setDismissedPomodoroRound(studyPomodoroRound)} />
            )}
            {step === 'organize' ? <OrganizationTimer seconds={seconds} baseSeconds={studySeconds} running={isTimerRunning}
              onToggle={() => setIsTimerRunning(current => !current)} onComplete={handleTimerComplete} /> : (
            <div className="flex flex-wrap items-stretch gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <div data-testid="measurement-group" className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-slate-50 px-3 py-3 sm:gap-x-4 sm:px-4 lg:w-auto lg:flex-[2] lg:flex-nowrap">
                <PomodoroLength className="!bg-transparent !p-0" />
                <div className="flex min-w-0 flex-1 items-center gap-3 border-l border-slate-200 pl-3 sm:gap-4 sm:pl-4">
                  <MeasurementProgress pages={timeTargetPages} target={pomodoroPageTarget} elapsed={formatTime(seconds)} label={pageLabel} />
                </div>
                </div>
              <div className="flex w-full min-w-0 items-center rounded-xl bg-slate-50 px-4 py-3 sm:flex-1 sm:basis-48 lg:w-auto">
                <div className="min-w-0 flex-1">
                  <p className="mb-2 text-sm font-black text-slate-500">학습 진척도</p>
                  <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2">
                    <div className="min-w-0">
                      {!activeReviewRun && activeSubjectStage && (
                        <p className="mb-2 text-sm font-black text-indigo-700">
                          {progressSplit
                            ? `단원 ${progressSplit.chapter.number} · ${pagePos}.${formatPageNumber(progressSplit.chapter.startPage)}~${formatPageNumber(progressSplit.chapter.endPage)}`
                            : activeSubjectStage.chapter
                            ? `단원 ${activeSubjectStage.chapter.number} · ${pagePos}.${formatPageNumber(activeSubjectStage.chapter.startPage)}~${formatPageNumber(activeSubjectStage.chapter.endPage)}`
                            : `${pagePos}.${formatPageNumber(activeSubjectStage.startPage)}~${formatPageNumber(activeSubjectStage.endPage)}`}
                        </p>
                      )}
                      <div data-testid="current-chapter-progress" className="whitespace-nowrap font-mono text-2xl font-black text-slate-700 tabular-nums">
                        {averageTimePerPage > 0
                          ? activeReviewRun
                            ? `${formatPageNumber(progressCurrentPages)}${pageLabel}`
                            : progressSplit
                            ? `${formatPageNumber(progressSplit.current.page)} / ${formatPageNumber(progressSplit.current.end)}${pageLabel}`
                            : `${formatPageNumber(progressCurrentPages)} / ${formatPageNumber(progressTargetPages)}${pageLabel}`
                          : '-'}
                      </div>
                    </div>
                    {progressSplit?.next && (
                      <div data-testid="next-chapter-start" className="min-w-0">
                        <p className="mb-2 text-sm font-black text-amber-700">다음 단원 {progressSplit.next.number}</p>
                        <div className="whitespace-nowrap font-mono text-2xl font-black text-amber-700 tabular-nums">
                          {formatPageNumber(progressSplit.next.page)} / {formatPageNumber(progressSplit.next.end)}{pageLabel}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            <div className="flex w-full min-w-0 items-center gap-2 lg:w-auto lg:min-w-[16.5rem] lg:flex-1">
              <button
                onClick={() => setIsTimerRunning(!isTimerRunning)}
                className={`flex-1 rounded-xl px-3 py-3.5 text-sm font-black shadow-sm ${isTimerRunning ? 'bg-slate-200 text-slate-800 hover:bg-slate-300' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
              >
                {isTimerRunning ? '일시정지' : '다시 시작'}
              </button>
              <button
                onClick={handleToggleSkipReview}
                className={`shrink-0 rounded-xl border-2 px-3 py-3.5 text-sm font-black shadow-sm transition-all ${
                  skipReview
                    ? 'bg-rose-50 text-rose-700 border-rose-400'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-500'
                }`}
              >
                <span>{skipReview ? '복습 제외' : '복습 포함'}</span>
              </button>
              <button onClick={handleTimerComplete} className="flex-1 rounded-xl bg-rose-500 px-3 py-3.5 text-sm font-black text-white shadow-sm transition-colors hover:bg-rose-600">완료</button>
            </div>
            </div>
            )}

            </aside>
          </div>
        )}

        {step === 'pages' && (
          <div className="flex flex-col items-center">
            <div className="mb-4 flex w-full items-center justify-between gap-3">
              <h3 className="text-2xl font-black text-slate-900">학습량 입력</h3>
              <button
                type="button"
                onClick={handleReturnToMeasurement}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-500 shadow-sm transition-colors hover:border-indigo-300 hover:text-indigo-600"
              >
                ← 측정으로 돌아가기
              </button>
            </div>
            {activeReviewRun && (
              <div className="mb-4 w-full rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-center">
                <p className="text-xs font-black text-rose-500">
                  {activeReviewRun.sourceName} 복습 · {selectedSubject?.name}
                </p>
              </div>
            )}
            <div className="flex flex-col gap-4 mb-4 w-full bg-slate-50 p-5 rounded-2xl border border-slate-100">
              <div className="space-y-2">
                <label htmlFor="session-end-page" className="ml-2 text-sm font-black text-indigo-600">완료된 끝 페이지</label>
                <input
                  id="session-end-page"
                  type="number"
                  step="1"
                  value={readAmount}
                  onChange={e => handleReadAmountChange(e.target.value)}
                  placeholder="0"
                  autoFocus
                  className="w-full p-4 bg-white border-2 border-slate-200 focus:border-indigo-500 rounded-2xl font-black text-3xl text-center outline-none transition-all shadow-sm text-indigo-900"
                />
                <p className="px-2 text-center text-xs font-bold text-slate-500">
                  시작 {pagePos}.{formatPageNumber(parseFloat(startPage) || 0)} · 학습량 {currentReadAmount > 0 ? formatPageNumber(currentReadAmount) : '0'}{pageLabel}
                </p>
              </div>
              <div className="space-y-2">
                <label htmlFor="session-solved-pages" className="ml-2 text-sm font-black text-indigo-600">푼 장수</label>
                <input id="session-solved-pages" type="number" min="1" step="1" value={solvedPageCount}
                  onChange={e => setSolvedPageCount(e.target.value)}
                  className="w-full rounded-2xl border-2 border-slate-200 bg-white p-4 text-center text-3xl font-black text-indigo-900 outline-none focus:border-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white p-3 text-center border border-slate-100">
                  <p className="text-xs font-black text-slate-500">{activeReviewRun ? '이번 학습량' : '현재 페이지'}</p>
                  <p className="mt-1 text-xl font-black text-indigo-600">
                    {activeReviewRun
                      ? (currentReadAmount > 0 ? `${formatPageNumber(currentReadAmount)}${pageLabel}` : `0${pageLabel}`)
                      : (parseFloat(readAmount) > 0 ? `${pagePos}.${formatPageNumber(parseFloat(readAmount))}` : '-')}
                  </p>
                </div>
                <div className="rounded-xl bg-white p-3 text-center border border-slate-100">
                  <p className="text-xs font-black text-slate-500">현재 시간</p>
                  <p className="mt-1 text-xl font-black text-slate-700">
                    {formatTime(studySeconds + organizationSeconds)}
                  </p>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    풀이 {formatTime(studySeconds)} · 정리 {formatTime(organizationSeconds)}
                  </p>
                </div>
              </div>
              <div className="hidden">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-widest text-indigo-500">세션 메모</label>
                  <button
                    type="button"
                    onClick={toggleMemoCollapsed}
                    className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-lg font-black text-indigo-500 shadow-sm transition-transform"
                    title={isMemoCollapsed ? '메모 열기' : '메모 닫기'}
                  >
                    <span className={`transition-transform ${isMemoCollapsed ? '' : 'rotate-90'}`}>›</span>
                  </button>
                </div>
                {!isMemoCollapsed && (
                  <>
                    <MemoColorTextarea
                      colorColons={colorMemoColons}
                      wrapperClassName="mt-3"
                      value={sessionMemo}
                      onChange={e => handleMemoChange(e.target.value)}
                      placeholder="다음 세션에서 이어볼 내용..."
                      className={`h-28 w-full resize-none rounded-xl border border-indigo-100 bg-white p-4 font-bold text-slate-700 outline-none focus:border-indigo-500 ${getMemoTextSize(sessionMemo)}`}
                    />
                    <p className="mt-2 text-center text-[10px] font-bold text-slate-400">과목별로 자동 저장됩니다.</p>
                  </>
                )}
              </div>
            </div>

            {feedbackInfo && activeReviewRun && (() => {
              const { speed, summary, recommended, fromQuestions } = feedbackInfo;
              const selected = chosenFeedbackGrade();
              const parentLog = activeReviewRun ? logs.find(log => log.id === activeReviewRun.logIds[0]) ?? null : null;
              // 이번이 마지막 복습과목이면 마칠 때 실제로 다음 복습이 열리는 때(풀린 문제들의 다음 복습과 과목 난도 중 이른 쪽)를 보여 준다
              // 다음 복습은 마지막 복습과목의 난도로 한 번만 정한다: 앞 복습과목에서는 날짜를 보여 주지 않는다
              const intervals = nextReviewRunSubjectId ? null : previewReviewCompletionIntervals(parentLog, Date.now());
              return <section aria-label="난도 피드백" data-difficulty-feedback="true" className="mb-4 w-full rounded-2xl border border-indigo-100 bg-white p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h4 className="text-base font-black text-indigo-800">난도 피드백</h4>
                  <p data-feedback-current="true" className="text-sm font-black text-slate-700">이번 속도 <span className="text-2xl text-indigo-700">{formatSpeed(speed, pageLabel)}</span></p>
                </div>
                {fromQuestions && <p data-feedback-from-questions="true" className="mt-1 text-[13px] font-bold text-indigo-800">추천은 복습 문제 첫 답변 중 가장 많았던 {SUBJECT_GRADE_LABELS[fromQuestions]}이에요. 직접 골라도 돼요.</p>}
                <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-[13px] font-bold text-slate-700">
                  <li data-feedback-average="true">평균 속도 {formatSpeed(summary.averageSpeed, pageLabel)}{summary.averageSpeed === null ? ' · 지난 기록이 없어요' : ''}</li>
                  {summary.byGrade.map(item => <li key={item.grade} data-feedback-history={item.grade} className="text-slate-600">
                    {SUBJECT_GRADE_LABELS[item.grade]} · 평균 속도 {formatSpeed(item.averageSpeed, pageLabel)} · {item.count}회
                  </li>)}
                </ul>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {SUBJECT_GRADES.map(grade => <button key={grade} type="button" data-feedback-grade={grade} aria-pressed={selected === grade}
                    data-recommended={recommended === grade ? 'true' : undefined} onClick={() => setFeedbackChoice(grade)}
                    className={`relative flex min-h-[4.5rem] flex-col items-start justify-center gap-0.5 rounded-xl border-2 px-3 py-2 text-left ${selected === grade ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-500' : 'border-slate-200 bg-slate-50'}`}>
                    {recommended === grade && <span className="absolute -top-2.5 right-2 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-black text-white">추천</span>}
                    <span className="flex flex-wrap items-baseline gap-x-1 text-base font-black text-slate-900">{SUBJECT_GRADE_LABELS[grade]}{grade === 'easy' && <span data-feedback-target="true" className="whitespace-nowrap text-[13px] font-bold text-slate-600">(목표하는 속도 {formatSpeed(summary.targetSpeed, pageLabel)})</span>}</span>
                    {intervals && <span className="text-xs font-bold text-slate-600">다음 복습 {formatReviewInterval(intervals[grade])} 뒤</span>}
                  </button>)}
                </div>
                {!intervals && <p data-feedback-later="true" className="mt-2 text-[13px] font-bold text-slate-600">다음 복습 날짜는 마지막 복습과목에서 고른 난도로 정해요</p>}
              </section>;
            })()}

            <div className={activeReviewRun ? 'grid w-full gap-3 sm:grid-cols-3' : 'w-full'}>
              <button onClick={handleFinalSave} className="w-full py-4 bg-green-600 text-white rounded-2xl font-black text-lg shadow-lg">
                저장 완료
              </button>
              {activeReviewRun && (
                <button onClick={() => handleSwitchToNextReviewSubject()} className="w-full py-4 bg-rose-600 text-white rounded-2xl font-black text-lg shadow-lg shadow-rose-100">
                  복습 완료
                </button>
              )}
              {activeReviewRun && <button onClick={() => handleSwitchToNextReviewSubject(true)}
                className="w-full rounded-2xl border border-indigo-200 bg-indigo-50 py-4 text-lg font-black text-indigo-700 shadow-sm">
                완료 후 다시 예약
              </button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
