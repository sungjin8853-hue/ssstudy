import React, { useEffect, useMemo, useState } from 'react';
import { StudyLog, Subject } from '../types';

interface Props {
  logs: StudyLog[];
  subjects: Subject[];
  onReviewAction: (logIds: string[], action: 'complete' | 'condense') => void;
  onUpdateReviewMemo: (logId: string, memo: string) => void;
}

interface ReviewGroup {
  subjectId: string;
  subjectName: string;
  logs: StudyLog[];
  earliestReviewTime: number;
}

const getMemoTextSize = (text: string) => {
  if (text.length > 420) return 'text-base';
  if (text.length > 220) return 'text-lg';
  return 'text-xl';
};

const formatPageRange = (log: StudyLog) => {
  if (log.startPage && log.endPage) return `p.${log.startPage} ~ p.${log.endPage}`;
  return `${log.pagesRead}P`;
};

const HOUR_MS = 60 * 60 * 1000;

const buildReviewGroupsLegacy = (logs: StudyLog[], subjects: Subject[], onlyDue: boolean): ReviewGroup[] => {
  const now = Date.now();
  const subjectReviewSettings = new Map(subjects.map(subject => [subject.id, subject.reviewEnabled !== false]));
  const groups = new Map<string, ReviewGroup>();

  logs
    .filter(log => {
      const enabled = log.reviewEnabled ?? subjectReviewSettings.get(log.subjectId) !== false;
      const nextReview = log.nextReviewDate ? new Date(log.nextReviewDate).getTime() : 0;
      return enabled && !log.isCondensed && (onlyDue ? nextReview <= now : nextReview > now);
    })
    .forEach(log => {
      const subject = subjects.find(item => item.id === log.subjectId);
      const subjectName = subject?.name || log.subjectNameSnapshot || '삭제된 과목';
      const reviewTime = log.nextReviewDate ? new Date(log.nextReviewDate).getTime() : 0;
      const groupKey = onlyDue ? log.subjectId : `${log.subjectId}-${Math.floor(reviewTime / HOUR_MS)}`;
      const group = groups.get(groupKey) || {
        subjectId: log.subjectId,
        subjectName,
        logs: [],
        earliestReviewTime: reviewTime
      };

      group.logs.push(log);
      group.earliestReviewTime = Math.min(group.earliestReviewTime, reviewTime);
      groups.set(groupKey, group);
    });

  return Array.from(groups.values()).sort((a, b) => a.earliestReviewTime - b.earliestReviewTime);
};

const buildReviewGroups = (logs: StudyLog[], subjects: Subject[], onlyDue: boolean): ReviewGroup[] => {
  const now = Date.now();
  const subjectReviewSettings = new Map(subjects.map(subject => [subject.id, subject.reviewEnabled !== false]));
  const targetLogs = logs
    .filter(log => {
      const enabled = log.reviewEnabled ?? subjectReviewSettings.get(log.subjectId) !== false;
      const nextReview = log.nextReviewDate ? new Date(log.nextReviewDate).getTime() : 0;
      return enabled && !log.isCondensed && (onlyDue ? nextReview <= now : nextReview > now);
    })
    .sort((a, b) => {
      const dateA = a.nextReviewDate ? new Date(a.nextReviewDate).getTime() : 0;
      const dateB = b.nextReviewDate ? new Date(b.nextReviewDate).getTime() : 0;
      return dateA - dateB;
    });

  if (onlyDue) {
    const groups = new Map<string, ReviewGroup>();
    targetLogs.forEach(log => {
      const subject = subjects.find(item => item.id === log.subjectId);
      const subjectName = subject?.name || log.subjectNameSnapshot || '삭제된 과목';
      const reviewTime = log.nextReviewDate ? new Date(log.nextReviewDate).getTime() : 0;
      const group = groups.get(log.subjectId) || {
        subjectId: log.subjectId,
        subjectName,
        logs: [],
        earliestReviewTime: reviewTime
      };

      group.logs.push(log);
      group.earliestReviewTime = Math.min(group.earliestReviewTime, reviewTime);
      groups.set(log.subjectId, group);
    });

    return Array.from(groups.values()).sort((a, b) => a.earliestReviewTime - b.earliestReviewTime);
  }

  const groups: ReviewGroup[] = [];
  targetLogs.forEach(log => {
    const subject = subjects.find(item => item.id === log.subjectId);
    const subjectName = subject?.name || log.subjectNameSnapshot || '삭제된 과목';
    const reviewTime = log.nextReviewDate ? new Date(log.nextReviewDate).getTime() : 0;
    const group = groups.find(item =>
      item.subjectId === log.subjectId && Math.abs(reviewTime - item.earliestReviewTime) < HOUR_MS
    );

    if (group) {
      group.logs.push(log);
      group.earliestReviewTime = Math.min(group.earliestReviewTime, reviewTime);
      return;
    }

    groups.push({
      subjectId: log.subjectId,
      subjectName,
      logs: [log],
      earliestReviewTime: reviewTime
    });
  });

  return groups.sort((a, b) => a.earliestReviewTime - b.earliestReviewTime);
};

export const ReviewManager: React.FC<Props> = ({ logs, subjects, onReviewAction, onUpdateReviewMemo }) => {
  const [activeReviewGroup, setActiveReviewGroup] = useState<ReviewGroup | null>(null);
  const [timer, setTimer] = useState(0);

  const dueReviewGroups = useMemo(() => buildReviewGroups(logs, subjects, true), [logs, subjects]);
  const upcomingReviewGroups = useMemo(() => buildReviewGroups(logs, subjects, false), [logs, subjects]);
  const dueReviewCount = dueReviewGroups.reduce((sum, group) => sum + group.logs.length, 0);

  const activeMemo = useMemo(() => {
    if (!activeReviewGroup) return '';
    return activeReviewGroup.logs
      .map((log, index) => {
        const memo = (log.reviewMemo || '').trim();
        const range = formatPageRange(log);
        return memo ? `${index + 1}. ${range}\n${memo}` : `${index + 1}. ${range}\n핵심어 메모 없음`;
      })
      .join('\n\n');
  }, [activeReviewGroup]);

  const startReviewSession = (group: ReviewGroup) => {
    setActiveReviewGroup(group);
    setTimer(0);
  };

  const finishReviewSession = () => {
    if (!activeReviewGroup) return;
    onReviewAction(activeReviewGroup.logs.map(log => log.id), 'complete');
    setActiveReviewGroup(null);
  };

  const handleCondense = (group: ReviewGroup) => {
    if (window.confirm('이 복습 항목을 축약 처리할까요?\n이후 복습 목록에는 표시되지 않습니다.')) {
      onReviewAction(group.logs.map(log => log.id), 'condense');
      setActiveReviewGroup(null);
    }
  };

  const handleCondenseFirst = () => {
    if (!activeReviewGroup || activeReviewGroup.logs.length === 0) return;
    const [firstLog, ...remainingLogs] = activeReviewGroup.logs;
    onReviewAction([firstLog.id], 'condense');
    setActiveReviewGroup(remainingLogs.length > 0
      ? {
          ...activeReviewGroup,
          logs: remainingLogs,
          earliestReviewTime: Math.min(...remainingLogs.map(log => log.nextReviewDate ? new Date(log.nextReviewDate).getTime() : 0))
        }
      : null
    );
  };

  useEffect(() => {
    if (!activeReviewGroup) return;
    const latestDueGroup = buildReviewGroups(logs, subjects, true).find(group => group.subjectId === activeReviewGroup.subjectId);
    const activeIds = new Set(activeReviewGroup.logs.map(log => log.id));
    const freshActiveLogs = logs.filter(log => activeIds.has(log.id) && !log.isCondensed);
    const mergedLogs = [
      ...freshActiveLogs,
      ...(latestDueGroup?.logs.filter(log => !activeIds.has(log.id)) || [])
    ];

    if (mergedLogs.length === 0) {
      setActiveReviewGroup(null);
      return;
    }

    const mergedSignature = mergedLogs.map(log => `${log.id}:${log.reviewMemo || ''}`).join('|');
    const currentSignature = activeReviewGroup.logs.map(log => `${log.id}:${log.reviewMemo || ''}`).join('|');
    if (mergedSignature !== currentSignature) {
      setActiveReviewGroup({
        ...activeReviewGroup,
        logs: mergedLogs,
        earliestReviewTime: Math.min(...mergedLogs.map(log => log.nextReviewDate ? new Date(log.nextReviewDate).getTime() : 0))
      });
    }
  }, [activeReviewGroup, logs, subjects]);

  useEffect(() => {
    let interval: number;
    if (activeReviewGroup) {
      interval = window.setInterval(() => {
        setTimer(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [activeReviewGroup]);

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleMemoChange = (logId: string, memo: string) => {
    onUpdateReviewMemo(logId, memo);
    setActiveReviewGroup(prev => prev
      ? { ...prev, logs: prev.logs.map(log => log.id === logId ? { ...log, reviewMemo: memo } : log) }
      : prev
    );
  };

  const getNextIntervalLabel = (step?: number) => {
    const s = step || 0;
    if (s === 0) return '1일 후';
    if (s === 1) return '4일 후';
    if (s === 2) return '7일 후';
    if (s === 3) return '14일 후';
    if (s === 4) return '28일 후';
    if (s === 5) return '56일 후';
    return '장기 기억';
  };

  return (
    <div className="space-y-10 relative">
      {activeReviewGroup && (
        <div className="fixed inset-0 z-[100] bg-slate-900/95 flex flex-col items-center justify-center p-4 md:p-10 animate-in fade-in zoom-in duration-300">
          <div className="w-full max-w-4xl flex flex-col h-full gap-6">
            <div className="flex justify-between items-center text-white">
              <div>
                <h4 className="text-2xl font-black">{activeReviewGroup.subjectName} 복습 중</h4>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className="px-3 py-1 bg-indigo-500 rounded-xl text-[10px] font-black text-white">
                    {activeReviewGroup.logs.length}개 병합
                  </span>
                  {activeReviewGroup.logs.map(log => (
                    <span key={log.id} className="px-3 py-1 bg-white/10 rounded-xl text-xs font-bold text-indigo-200">
                      {formatPageRange(log)}
                    </span>
                  ))}
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">진행 시간</p>
                <p className="text-4xl font-mono font-black text-white">{formatTimer(timer)}</p>
              </div>
            </div>

            <div className="grid min-h-0 flex-grow grid-cols-1 gap-4 md:grid-cols-[1fr_1.2fr]">
              <div className="rounded-3xl border border-slate-700 bg-slate-800 p-6 text-slate-200 shadow-2xl overflow-auto">
                <p className="mb-4 text-[10px] font-black uppercase tracking-widest text-indigo-300">복습 범위</p>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-lg font-black tracking-tight text-indigo-200">복습 범위</p>
                  <button
                    type="button"
                    onClick={handleCondenseFirst}
                    className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-slate-200 transition-all hover:bg-rose-500 hover:text-white"
                  >
                    앞부분 축약
                  </button>
                </div>
                <div className="space-y-3">
                  {activeReviewGroup.logs.map(log => (
                    <div key={log.id} className="rounded-2xl bg-white/5 p-4">
                      <p className="text-lg font-black text-white">{formatPageRange(log)}</p>
                      <p className="mt-1 text-xs font-bold text-slate-400">
                        Step {log.reviewStep || 0} · {new Date(log.timestamp).toLocaleDateString()} 학습
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border border-rose-200 bg-white p-6 shadow-2xl overflow-auto">
                <p className="mb-4 text-[10px] font-black uppercase tracking-widest text-rose-500">핵심어 메모</p>
                <div className="space-y-4">
                  {activeReviewGroup.logs.map(log => (
                    <div key={log.id} className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4">
                      <p className="mb-2 text-xs font-black text-rose-400">{formatPageRange(log)}</p>
                      <textarea
                        value={log.reviewMemo || ''}
                        onChange={event => handleMemoChange(log.id, event.target.value)}
                        placeholder="복습하면서 떠오른 핵심어를 바로 수정하세요."
                        className={`min-h-[150px] w-full resize-none rounded-xl border border-rose-100 bg-white p-4 font-bold leading-relaxed text-slate-800 outline-none focus:border-rose-500 ${getMemoTextSize(log.reviewMemo || '')}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-4">
              <button onClick={() => setActiveReviewGroup(null)} className="flex-1 py-4 rounded-2xl bg-slate-700 text-white font-bold hover:bg-slate-600 transition-colors">잠시 중단</button>
              <button onClick={() => handleCondense(activeReviewGroup)} className="flex-1 py-4 rounded-2xl bg-slate-100 text-slate-900 font-bold hover:bg-white transition-colors">축약</button>
              <button onClick={finishReviewSession} className="flex-[2] py-4 rounded-2xl bg-indigo-600 text-white font-bold text-lg hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-900/20">
                복습 완료 ({getNextIntervalLabel(Math.max(...activeReviewGroup.logs.map(log => log.reviewStep || 0)))})
              </button>
            </div>
          </div>
        </div>
      )}

      <section>
        <div className="flex justify-between items-end mb-6 px-2">
          <div>
            <h3 className="text-2xl font-black text-slate-800 flex items-center gap-2">
              <span className="p-2 bg-rose-100 text-rose-600 rounded-xl text-lg">↻</span>
              오늘 복습 큐
            </h3>
            <p className="text-xs text-slate-400 mt-2 font-bold">같은 과목의 복습은 자동으로 병합해서 한 번에 보여줍니다.</p>
          </div>
          <span className="text-sm font-black text-rose-600 bg-rose-50 px-3 py-1.5 rounded-lg">
            {dueReviewGroups.length}과목 · {dueReviewCount}개
          </span>
        </div>

        <div className="space-y-4">
          {dueReviewGroups.length > 0 ? dueReviewGroups.map((group, idx) => (
            <div key={group.subjectId} className="bg-white p-6 rounded-[2rem] border-2 border-rose-100 hover:border-rose-300 transition-all shadow-sm flex flex-col md:flex-row md:items-center gap-6 group">
              <div className="flex items-center gap-4 flex-[2]">
                <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center font-black text-xl shadow-inner">
                  {idx + 1}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-bold">{group.logs.length}개 병합</span>
                    <span className="text-[10px] text-slate-400">{new Date(group.earliestReviewTime).toLocaleDateString()}</span>
                  </div>
                  <h4 className="text-xl font-black text-slate-800">{group.subjectName}</h4>
                  <p className="text-rose-600 font-black mt-1">{group.logs.map(formatPageRange).join(' · ')}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-1 justify-end">
                <button
                  onClick={() => handleCondense(group)}
                  className="px-5 py-3 rounded-xl bg-slate-100 text-slate-500 font-bold text-xs hover:bg-slate-200 transition-all"
                >
                  축약
                </button>
                <button
                  onClick={() => startReviewSession(group)}
                  className="flex-1 md:flex-none px-8 py-3 rounded-xl bg-rose-600 text-white font-black text-sm hover:bg-rose-700 shadow-lg shadow-rose-200 transition-all active:scale-95"
                >
                  지금 복습하기
                </button>
              </div>
            </div>
          )) : (
            <div className="py-20 text-center bg-white rounded-[2.5rem] border-2 border-dashed border-slate-200">
              <span className="text-4xl block mb-4">✓</span>
              <h4 className="text-lg font-black text-slate-700">현재 대기 중인 복습이 없습니다.</h4>
              <p className="text-xs text-slate-400 mt-2">모든 복습을 완료했거나 아직 시간이 오지 않았습니다.</p>
            </div>
          )}
        </div>
      </section>

      <section className="opacity-80 hover:opacity-100 transition-opacity">
        <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2 px-2 mt-12">
          <span className="p-1.5 bg-indigo-100 text-indigo-600 rounded-lg text-sm">⏳</span>
          다가오는 복습 일정
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {upcomingReviewGroups.map(group => {
            const hoursLeft = Math.ceil((group.earliestReviewTime - Date.now()) / (1000 * 60 * 60));
            const timeLeftStr = hoursLeft > 24 ? `${Math.ceil(hoursLeft / 24)}일 후` : `${hoursLeft}시간 후`;

            return (
              <div key={`${group.subjectId}-${group.earliestReviewTime}`} className="bg-white p-5 rounded-2xl border border-slate-200 flex flex-col justify-between min-h-36 relative overflow-hidden group">
                <div className="flex justify-between items-start z-10">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400">{group.logs.length}개 병합</p>
                    <p className="font-bold text-slate-800 mt-1">{group.subjectName}</p>
                  </div>
                  <span className="px-2 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-black">{timeLeftStr}</span>
                </div>

                <p className="z-10 mt-4 text-indigo-900 font-black text-sm">{group.logs.map(formatPageRange).join(' · ')}</p>
                <button
                  type="button"
                  onClick={() => handleCondense(group)}
                  className="z-10 mt-4 self-end rounded-xl bg-slate-100 px-4 py-2 text-[10px] font-black text-slate-500 transition-all hover:bg-rose-50 hover:text-rose-500"
                >
                  축약
                </button>
                <div className="absolute bottom-0 left-0 h-1 bg-indigo-500 w-full opacity-10"></div>
              </div>
            );
          })}
        </div>
        {upcomingReviewGroups.length === 0 && (
          <p className="text-center text-slate-400 text-xs italic py-8">예정된 복습 일정이 없습니다.</p>
        )}
      </section>
    </div>
  );
};
