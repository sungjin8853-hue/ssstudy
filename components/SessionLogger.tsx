import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Subject, StudyHabit, StudyLog } from '../types';
import { calculateRecentCompletedDayAverage } from '../utils/math';

interface Props {
  subjects: Subject[];
  logs: StudyLog[];
  onLogSession: (log: StudyLog) => void;
  onUpdateSubject?: (subject: Subject) => void;
}

type Step = 'idle' | 'timer' | 'pages';
type TimerMode = 'remainingPages' | 'elapsedTime';

const DAY_MS = 1000 * 60 * 60 * 24;
const REVIEW_SESSION_PREF_KEY = 'swp_session_review_preferences';
const HABIT_PANEL_COLLAPSED_KEY = 'swp_habit_panel_collapsed';

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

const createHabit = (badKeyword: string, goodKeyword: string): StudyHabit => {
  const now = new Date().toISOString();
  return {
    id: Math.random().toString(36).substr(2, 9),
    badKeyword,
    goodKeyword,
    goodCount: 0,
    totalChecks: 0,
    createdAt: now,
    updatedAt: now
  };
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

const readHabitPanelCollapsed = () => {
  return localStorage.getItem(HABIT_PANEL_COLLAPSED_KEY) === 'true';
};

const writeHabitPanelCollapsed = (collapsed: boolean) => {
  localStorage.setItem(HABIT_PANEL_COLLAPSED_KEY, String(collapsed));
};

const HabitJourneyCard = ({
  badKeyword,
  goodKeyword,
  goodCount,
  dark = false,
  selected,
  onSelect,
  editable = false,
  onBadChange,
  onGoodChange
}: {
  badKeyword: string;
  goodKeyword: string;
  goodCount: number;
  dark?: boolean;
  selected?: 'bad' | 'good' | null;
  onSelect?: (value: 'bad' | 'good') => void;
  editable?: boolean;
  onBadChange?: (value: string) => void;
  onGoodChange?: (value: string) => void;
}) => {
  const goodWeight = Math.min(900, 650 + Math.min(goodCount, 5) * 50);
  const goodRatio = 0;
  const beadLeft = '0%';

  return (
    <div className={`w-full rounded-[2rem] border p-5 ${dark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'}`}>
      <div className="mb-4 flex items-center justify-between [&>p:nth-child(2)]:hidden">
        <p className={`text-[10px] font-black uppercase tracking-widest ${dark ? 'text-indigo-300' : 'text-indigo-500'}`}>습관 교정</p>
        <p className={`text-[10px] font-bold ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{Math.round(goodRatio * 100)}% 좋은 쪽</p>
        <p className={`rounded-full px-3 py-1 text-[10px] font-black ${dark ? 'bg-emerald-400/10 text-emerald-300' : 'bg-emerald-100 text-emerald-600'}`}>좋은 습관 {goodCount}회</p>
      </div>
      <div className="hidden">
        <div className={`absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 rounded-full ${dark ? 'bg-rose-400/20' : 'bg-rose-100'}`}>
          <div className="h-full rounded-full bg-gradient-to-r from-rose-400 via-amber-300 to-emerald-400" style={{ width: beadLeft }} />
        </div>
        <div
          className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-emerald-400 shadow-xl transition-all"
          style={{ left: beadLeft }}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onSelect?.('bad')}
          className={`rounded-2xl border p-4 text-left transition-all ${
            selected === 'bad'
              ? 'border-rose-500 bg-rose-50 text-rose-700'
              : dark ? 'border-white/10 bg-black/10 text-slate-300' : 'border-slate-100 bg-slate-50 text-slate-500'
          }`}
        >
          <p className="mb-2 text-[9px] font-black uppercase tracking-widest opacity-60">고칠 습관</p>
          {editable ? (
            <input
              value={badKeyword}
              onChange={e => onBadChange?.(e.target.value)}
              placeholder="예: 급하게 넘김"
              className="w-full bg-transparent text-base font-black outline-none"
            />
          ) : (
            <p className="text-base font-black">{badKeyword || '아직 없음'}</p>
          )}
        </button>
        <button
          type="button"
          onClick={() => onSelect?.('good')}
          className={`rounded-2xl border p-4 text-left transition-all ${
            selected === 'good'
              ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
              : dark ? 'border-white/10 bg-black/10 text-white' : 'border-slate-100 bg-slate-50 text-slate-700'
          }`}
        >
          <p className="mb-2 text-[9px] font-black uppercase tracking-widest opacity-60">바꿀 습관</p>
          {editable ? (
            <input
              value={goodKeyword}
              onChange={e => onGoodChange?.(e.target.value)}
              placeholder="예: 근거 표시"
              className="w-full bg-transparent text-base outline-none"
              style={{ fontWeight: goodWeight }}
            />
          ) : (
            <p className="text-base" style={{ fontWeight: goodWeight }}>{goodKeyword || '아직 없음'}</p>
          )}
        </button>
      </div>
    </div>
  );
};

export const SessionLogger: React.FC<Props> = ({ subjects, logs, onLogSession, onUpdateSubject }) => {
  const measurableSubjects = subjects.filter(subject => subject.completedPages < subject.totalPages);
  const [step, setStep] = useState<Step>('idle');
  const [subjectId, setSubjectId] = useState(measurableSubjects[0]?.id || '');
  const selectedSubject = subjects.find(subject => subject.id === subjectId);
  const isSubjectReviewDisabled = selectedSubject?.reviewEnabled === false;

  const [startPage, setStartPage] = useState('');
  const [readAmount, setReadAmount] = useState('');
  const [skipReview, setSkipReview] = useState(false);
  const [minutes, setMinutes] = useState(0);
  const [plannedPageCount, setPlannedPageCount] = useState(0);
  const [timerMode, setTimerMode] = useState<TimerMode>('remainingPages');
  const [seconds, setSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [habitBadKeyword, setHabitBadKeyword] = useState('');
  const [habitGoodKeyword, setHabitGoodKeyword] = useState('');
  const [habitResult, setHabitResult] = useState<'bad' | 'good' | null>(null);
  const [isHabitPanelCollapsed, setIsHabitPanelCollapsed] = useState(readHabitPanelCollapsed);

  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const accumulatedSecondsRef = useRef(0);

  const selectedSubjectLogs = useMemo(
    () => logs.filter(log => log.subjectId === subjectId && log.pagesRead > 0 && log.timeSpentMinutes > 0),
    [logs, subjectId]
  );

  const remainingSubjectPages = selectedSubject
    ? Math.max(0, selectedSubject.totalPages - selectedSubject.completedPages)
    : 0;

  const recommendedDailyPages = useMemo(() => {
    if (!selectedSubject) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(selectedSubject.targetDate);
    targetDate.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((targetDate.getTime() - today.getTime()) / DAY_MS);
    return diffDays > 0 ? Math.ceil(remainingSubjectPages / diffDays) : remainingSubjectPages;
  }, [selectedSubject, remainingSubjectPages]);

  const averageTimePerPage = useMemo(
    () => calculateRecentCompletedDayAverage(selectedSubjectLogs, recommendedDailyPages).averageTimePerPage,
    [selectedSubjectLogs, recommendedDailyPages]
  );

  const averageSecondsPerPage = averageTimePerPage > 0 ? averageTimePerPage * 60 : 0;
  const plannedPages = Math.max(0, plannedPageCount);
  const elapsedPagesByPlan = averageSecondsPerPage > 0 ? seconds / averageSecondsPerPage : 0;
  const timeTargetPages = Math.min(plannedPages, Math.floor(elapsedPagesByPlan));
  const progressBasePages = (selectedSubject?.completedPages || 0) + 1;
  const progressCurrentPages = progressBasePages + timeTargetPages;
  const progressTargetPages = progressBasePages + plannedPages;
  const expectedReadAmount = averageTimePerPage > 0
    ? Math.min(remainingSubjectPages, Math.max(1, timeTargetPages || Math.floor(elapsedPagesByPlan)))
    : Math.min(remainingSubjectPages, plannedPages);
  const currentTimePerPage = readAmount && parseFloat(readAmount) > 0 ? minutes / parseFloat(readAmount) : 0;
  const speedDeltaMinutes = currentTimePerPage > 0 && averageTimePerPage > 0
    ? currentTimePerPage - averageTimePerPage
    : 0;
  const previousExpectedPages = averageTimePerPage > 0 ? minutes / averageTimePerPage : 0;
  const actualPages = readAmount ? parseFloat(readAmount) : 0;
  const speedRatioPercent = previousExpectedPages > 0 && actualPages > 0
    ? (actualPages / previousExpectedPages) * 100
    : 0;
  const pageAttackRemainingSeconds = averageSecondsPerPage > 0 && timeTargetPages < plannedPages
    ? Math.ceil(averageSecondsPerPage - (seconds % averageSecondsPerPage))
    : 0;
  const activeHabit = selectedSubject?.habit && !selectedSubject.habit.completed ? selectedSubject.habit : undefined;
  const completedHabit = selectedSubject?.habit?.completed ? selectedSubject.habit : undefined;

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
  }, [isTimerRunning]);

  useEffect(() => {
    setMinutes(parseFloat((seconds / 60).toFixed(2)));
  }, [seconds]);

  useEffect(() => {
    if (!subjectId) return;
    const savedPreference = readReviewSessionPreferences()[subjectId];
    setSkipReview(savedPreference ?? isSubjectReviewDisabled);
  }, [subjectId, isSubjectReviewDisabled]);

  useEffect(() => {
    setPlannedPageCount(recommendedDailyPages);
  }, [subjectId, recommendedDailyPages]);

  useEffect(() => {
    const habit = selectedSubject?.habit;
    if (habit && !habit.completed) {
      setHabitBadKeyword(habit.badKeyword);
      setHabitGoodKeyword(habit.goodKeyword);
      setHabitResult(null);
      return;
    }

    setHabitBadKeyword('');
    setHabitGoodKeyword(habit?.goodKeyword || '');
    setHabitResult(null);
  }, [subjectId, selectedSubject?.habit?.id, selectedSubject?.habit?.completed]);

  useEffect(() => {
    if (!measurableSubjects.some(subject => subject.id === subjectId)) {
      setSubjectId(measurableSubjects[0]?.id || '');
    }
  }, [subjects, subjectId]);

  const formatTime = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hrs > 0 ? hrs + ':' : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const resetAll = () => {
    setStep('idle');
    setSeconds(0);
    accumulatedSecondsRef.current = 0;
    startTimeRef.current = null;
    setIsTimerRunning(false);
    setStartPage('');
    setReadAmount('');
    setIsConfirmingCancel(false);
    setTimerMode('remainingPages');
    setHabitResult(null);
  };

  const handleToggleSkipReview = () => {
    if (!subjectId) return;
    const nextSkipReview = !skipReview;
    setSkipReview(nextSkipReview);
    writeReviewSessionPreference(subjectId, nextSkipReview);
  };

  const toggleHabitPanel = () => {
    const nextCollapsed = !isHabitPanelCollapsed;
    setIsHabitPanelCollapsed(nextCollapsed);
    writeHabitPanelCollapsed(nextCollapsed);
  };

  const handleStartMeasurement = () => {
    if (!subjectId) {
      alert('과목을 먼저 선택해주세요.');
      return;
    }
    setStep('timer');
    setIsTimerRunning(true);
  };

  const handleTimerComplete = () => {
    if (startTimeRef.current !== null) {
      const currentElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      accumulatedSecondsRef.current += currentElapsed;
      setSeconds(accumulatedSecondsRef.current);
      startTimeRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsTimerRunning(false);
    if (selectedSubject) {
      setStartPage(formatPageNumber(selectedSubject.completedPages + 1));
    }
    if (expectedReadAmount > 0) {
      setReadAmount(formatPageNumber(expectedReadAmount));
    }
    setStep('pages');
  };

  const buildNextHabit = () => {
    const badKeyword = habitBadKeyword.trim();
    const goodKeyword = habitGoodKeyword.trim();

    if (!badKeyword || !goodKeyword) return undefined;

    if (!badKeyword && !goodKeyword && !activeHabit) {
      if (completedHabit) return undefined;
      alert('이번 과목에서 가장 고쳐야 할 습관과 바꿀 좋은 습관을 적어주세요.');
      return null;
    }
    if (!badKeyword || !goodKeyword) {
      alert('고쳐야 할 습관과 바꿀 좋은 습관을 모두 적어주세요.');
      return null;
    }

    const baseHabit = activeHabit || createHabit(badKeyword, goodKeyword);
    const checkedResult = habitResult;

    return {
      habit: {
        ...baseHabit,
        badKeyword,
        goodKeyword,
        goodCount: baseHabit.goodCount + (checkedResult === 'good' ? 1 : 0),
        totalChecks: baseHabit.totalChecks + (checkedResult ? 1 : 0),
        updatedAt: new Date().toISOString()
      },
      check: checkedResult
        ? {
            habitId: baseHabit.id,
            badKeyword,
            goodKeyword,
            result: checkedResult
          }
        : undefined
    };
  };

  const handleFinalSave = () => {
    const sPage = parseFloat(startPage);
    const amount = parseFloat(readAmount);

    if (isNaN(sPage) || isNaN(amount) || amount <= 0) {
      alert('학습한 페이지 수를 정확히 입력해주세요.');
      return;
    }

    if (amount > remainingSubjectPages) {
      alert(`현재 과목의 남은 학습량은 ${formatPageNumber(remainingSubjectPages)}페이지입니다.`);
      return;
    }

    const nextHabitState = buildNextHabit();
    if (nextHabitState === null) return;

    onLogSession({
      id: Math.random().toString(36).substr(2, 9),
      subjectId,
      pagesRead: amount,
      startPage: sPage,
      endPage: calculateEndPageValue(sPage, amount),
      timeSpentMinutes: minutes,
      timestamp: new Date().toISOString(),
      isReviewed: false,
      isCondensed: skipReview,
      habitCheck: nextHabitState?.check
    });

    if (selectedSubject && nextHabitState?.habit) {
      onUpdateSubject?.({
        ...selectedSubject,
        habit: nextHabitState.habit
      });
    }

    resetAll();
  };

  const calculatedEndPage = startPage && readAmount
    ? calculateEndPageValue(parseFloat(startPage), parseFloat(readAmount))
    : null;

  if (step === 'idle') {
    return (
      <div className="animate-fade-in">
        <h2 className="text-xl font-black text-slate-800 flex items-center gap-2 mb-8">
          <span className="w-2 h-5 bg-indigo-500 rounded-full"></span>
          학습 세션 시작
        </h2>
        <div className="space-y-6 max-w-md mx-auto">
          <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-3 tracking-widest px-1">측정할 과목 선택</label>
            <select
              className="w-full p-4 border border-slate-200 rounded-2xl bg-white font-bold appearance-none cursor-pointer focus:ring-4 focus:ring-indigo-500/10 transition-all outline-none"
              value={subjectId}
              onChange={e => setSubjectId(e.target.value)}
            >
              <option value="">과목을 선택하세요...</option>
              {measurableSubjects.map(subject => (
                <option key={subject.id} value={subject.id}>{subject.name}</option>
              ))}
            </select>
            <div className="mt-5 pt-5 border-t border-slate-200">
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-3 tracking-widest px-1">오늘 공부할 장수</label>
              <input
                type="number"
                step="1"
                min="0"
                value={plannedPageCount}
                onChange={e => setPlannedPageCount(Math.max(0, Number(e.target.value)))}
                className="w-full p-4 border border-slate-200 rounded-2xl bg-white font-black text-center text-2xl text-indigo-900 outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
              />
              <p className="mt-3 px-1 text-[10px] font-bold text-slate-400 leading-relaxed">
                하루 권장 장수를 자동으로 채웁니다. 필요하면 직접 바꿀 수 있어요.
              </p>
            </div>
          </div>
          <button
            onClick={handleStartMeasurement}
            disabled={measurableSubjects.length === 0}
            className="w-full py-5 bg-indigo-600 disabled:bg-slate-300 disabled:shadow-none text-white rounded-2xl font-black text-lg hover:bg-indigo-700 disabled:hover:bg-slate-300 transition-all shadow-xl shadow-indigo-100 flex items-center justify-center gap-3 group"
          >
            <span className="text-2xl group-hover:rotate-12 transition-transform">⏱️</span>
            {measurableSubjects.length > 0 ? '측정 엔진 가동' : '모든 과목 목표 완료'}
          </button>
        </div>
      </div>
    );
  }

  const isDark = step === 'timer';

  return (
    <div className={`fixed inset-0 flex flex-col items-center justify-center p-6 ${isDark ? 'bg-slate-950' : 'bg-white'}`} style={{ zIndex: 9999 }}>
      <button
        onClick={() => setIsConfirmingCancel(true)}
        className={`fixed top-8 right-8 w-14 h-14 rounded-full flex items-center justify-center shadow-xl active:scale-90 transition-all ${
          isDark ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-500'
        }`}
      >
        <span className="text-2xl font-bold">×</span>
      </button>

      {isConfirmingCancel && (
        <div className="fixed inset-0 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm z-[10000]">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-10 text-center shadow-2xl">
            <h4 className="text-xl font-black text-slate-900 mb-2">학습 측정을 중단할까요?</h4>
            <p className="text-slate-500 text-sm mb-10">기록은 저장되지 않고 사라집니다.</p>
            <div className="flex flex-col gap-3">
              <button onClick={resetAll} className="w-full py-4 bg-red-600 text-white rounded-2xl font-black">네, 취소합니다</button>
              <button onClick={() => setIsConfirmingCancel(false)} className="w-full py-4 bg-slate-100 text-slate-600 rounded-2xl font-black">계속 공부할게요</button>
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-lg">
        {step === 'timer' && (
          <div className="flex flex-col items-center">
            <span className="px-4 py-1 bg-indigo-500/10 text-indigo-400 rounded-full text-[10px] font-black uppercase mb-8">측정 진행 중</span>
            <p className="text-center text-xs font-black text-slate-500 mb-3">{selectedSubject?.name}</p>
            {activeHabit && (
              <div className="mb-6 w-full">
                <HabitJourneyCard
                  badKeyword={activeHabit.badKeyword}
                  goodKeyword={activeHabit.goodKeyword}
                  goodCount={activeHabit.goodCount}
                  dark
                />
              </div>
            )}
            <div className="mb-8 grid w-full grid-cols-2 gap-2 rounded-3xl bg-white/5 p-2">
              <button
                onClick={() => setTimerMode('remainingPages')}
                className={`py-3 rounded-2xl text-xs font-black transition-all ${timerMode === 'remainingPages' ? 'bg-indigo-600 text-white shadow-xl' : 'text-slate-500 hover:text-white'}`}
              >
                학습 진척도
              </button>
              <button
                onClick={() => setTimerMode('elapsedTime')}
                className={`py-3 rounded-2xl text-xs font-black transition-all ${timerMode === 'elapsedTime' ? 'bg-indigo-600 text-white shadow-xl' : 'text-slate-500 hover:text-white'}`}
              >
                경과 시간
              </button>
            </div>

            {timerMode === 'remainingPages' ? (
              <div className="mb-16 text-center">
                <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-500">학습 진척도</p>
                <div className="text-4xl md:text-5xl font-mono font-black text-white tabular-nums">
                  {averageTimePerPage > 0
                    ? `${formatPageNumber(progressCurrentPages)} / ${formatPageNumber(progressTargetPages)}P`
                    : '-'}
                </div>
                <div className="mt-6 rounded-[2rem] bg-white/5 px-8 py-6">
                  <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">타임어택</p>
                  <div className="font-mono text-8xl md:text-9xl font-black text-white tabular-nums">
                    {averageTimePerPage > 0 ? formatTime(pageAttackRemainingSeconds) : '--:--'}
                  </div>
                </div>
                <p className="mt-5 text-xs font-bold text-slate-500">
                  {averageTimePerPage > 0
                    ? `${formatPageNumber(plannedPageCount)}장 목표 · 현재 시간 기준 ${formatPageNumber(timeTargetPages)}장 진행`
                    : '최근 5일 안에 하루치 학습량을 끝낸 기록이 필요합니다.'}
                </p>
              </div>
            ) : (
              <div className="text-8xl md:text-9xl font-mono font-black text-white tabular-nums mb-16">{formatTime(seconds)}</div>
            )}

            <div className="flex gap-4 w-full">
              <button
                onClick={() => setIsTimerRunning(!isTimerRunning)}
                className={`flex-[2] py-6 rounded-3xl font-black text-xl shadow-2xl ${isTimerRunning ? 'bg-slate-800 text-white' : 'bg-indigo-600 text-white'}`}
              >
                {isTimerRunning ? '일시정지' : '다시 시작'}
              </button>
              <button
                onClick={handleToggleSkipReview}
                className={`w-24 py-4 rounded-3xl font-black text-xs shadow-xl transition-all flex flex-col items-center justify-center gap-1 ${
                  skipReview
                    ? 'bg-rose-100 text-rose-500 border-2 border-rose-500'
                    : 'bg-white text-slate-400 border-2 border-transparent'
                }`}
              >
                <span className="text-xl">{skipReview ? '🚫' : '📥'}</span>
                <span>{skipReview ? '복습 제외' : '복습 담기'}</span>
              </button>
              <button onClick={handleTimerComplete} className="flex-1 py-6 bg-green-600 text-white rounded-3xl font-black text-xl shadow-2xl">완료</button>
            </div>
          </div>
        )}

        {step === 'pages' && (
          <div className="flex flex-col items-center">
            <h3 className="text-3xl font-black text-slate-900 mb-8">학습량 입력</h3>
            <div className="flex flex-col gap-6 mb-8 w-full bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-indigo-500 uppercase ml-2 tracking-widest">오늘 학습한 페이지 수</label>
                <input
                  type="number"
                  step="1"
                  value={readAmount}
                  onChange={e => setReadAmount(e.target.value)}
                  placeholder="0"
                  autoFocus
                  className="w-full p-6 bg-white border-2 border-slate-200 focus:border-indigo-500 rounded-3xl font-black text-4xl text-center outline-none transition-all shadow-sm text-indigo-900"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-2xl bg-white p-4 text-center border border-slate-100">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">이전 속도</p>
                  <p className="mt-1 text-lg font-black text-slate-700">
                    {averageTimePerPage > 0 ? `${averageTimePerPage.toFixed(2)}분/P` : '기록 필요'}
                  </p>
                </div>
                <div className="rounded-2xl bg-white p-4 text-center border border-slate-100">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">이번 속도</p>
                  <p className="mt-1 text-lg font-black text-indigo-600">
                    {currentTimePerPage > 0 ? `${currentTimePerPage.toFixed(2)}분/P` : '-'}
                  </p>
                </div>
                <div className="rounded-2xl bg-white p-4 text-center border border-slate-100">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">속도 변화</p>
                  <p className={`mt-1 text-lg font-black ${speedRatioPercent > 100 ? 'text-emerald-600' : speedRatioPercent > 0 && speedRatioPercent < 100 ? 'text-rose-600' : 'text-slate-500'}`}>
                    {currentTimePerPage > 0 && averageTimePerPage > 0
                      ? speedRatioPercent > 100
                        ? `${speedRatioPercent.toFixed(0)}% 속도`
                        : speedRatioPercent < 100
                          ? `${Math.abs(speedDeltaMinutes).toFixed(2)}분/P 느림`
                          : '변화 없음'
                      : '-'}
                  </p>
                </div>
              </div>
              <div className={`rounded-[2rem] border border-indigo-100 bg-indigo-50/50 p-4 ${isHabitPanelCollapsed ? '[&>*:not(:first-child)]:hidden' : ''}`}>
                <div className="mb-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={toggleHabitPanel}
                    className={`mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-lg font-black text-indigo-500 shadow-sm transition-transform ${isHabitPanelCollapsed ? '' : 'rotate-90'}`}
                    title={isHabitPanelCollapsed ? '습관 체크 열기' : '습관 체크 닫기'}
                  >
                    ›
                  </button>
                  <div>
                    <p className="text-sm font-black text-slate-800">이번 세션 습관 체크</p>
                    <p className="mt-1 text-[10px] font-bold text-slate-400">
                      핵심 키워드만 적어두면 다음 측정 때 계속 떠요.
                    </p>
                  </div>
                  {completedHabit && !activeHabit && (
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black text-emerald-600">
                      좋은 습관 유지: {completedHabit.goodKeyword}
                    </span>
                  )}
                </div>
                <HabitJourneyCard
                  badKeyword={habitBadKeyword}
                  goodKeyword={habitGoodKeyword}
                  goodCount={activeHabit?.goodCount || 0}
                  selected={habitResult}
                  onSelect={setHabitResult}
                  editable
                  onBadChange={setHabitBadKeyword}
                  onGoodChange={setHabitGoodKeyword}
                />
                <p className="mt-3 text-center text-[10px] font-bold text-slate-400">
                  오늘 더 가까웠던 쪽을 하나 체크해두면 습관 기록에 반영됩니다.
                </p>
              </div>
            </div>

            <button onClick={handleFinalSave} className="w-full py-5 bg-green-600 text-white rounded-3xl font-black text-xl shadow-xl">
              저장 완료
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
