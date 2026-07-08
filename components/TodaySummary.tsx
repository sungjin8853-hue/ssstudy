import React, { useMemo, useState } from 'react';
import { StudyLog, Subject } from '../types';

interface Props {
  logs: StudyLog[];
  subjects: Subject[];
  onAddLog: (log: StudyLog) => void;
  onReplaceLogs: (logIds: string[], replacementLog: StudyLog) => void;
  onDeleteLogs: (logIds: string[]) => void;
}

type ModalMode = 'add' | 'edit';

interface SubjectSummary {
  subjectId: string;
  name: string;
  pages: number;
  minutes: number;
  startPage: number;
  endPage: number;
  latestTimestamp: string;
  logs: StudyLog[];
}

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/\.?0+$/, '');
};

const calculateEndPageValue = (start: number, amount: number) => {
  const endPage = Number.isInteger(start) && Number.isInteger(amount)
    ? start + amount - 1
    : start + amount;
  return Number(endPage.toFixed(2));
};

export const TodaySummary: React.FC<Props> = ({ logs, subjects, onAddLog, onReplaceLogs, onDeleteLogs }) => {
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [editingSummary, setEditingSummary] = useState<SubjectSummary | null>(null);
  const [subjectId, setSubjectId] = useState('');
  const [editPages, setEditPages] = useState(0);
  const [editMinutes, setEditMinutes] = useState(0);
  const [editStartPage, setEditStartPage] = useState(1);

  const todayLogs = useMemo(() => {
    const today = new Date().toLocaleDateString();
    return logs.filter(log => new Date(log.timestamp).toLocaleDateString() === today);
  }, [logs]);

  const totals = useMemo(() => {
    const time = todayLogs.reduce((acc, log) => acc + log.timeSpentMinutes, 0);
    const pages = todayLogs.reduce((acc, log) => acc + log.pagesRead, 0);
    const avgEfficiency = pages > 0 ? (time / pages).toFixed(1) : '0';
    return { time, pages, avgEfficiency };
  }, [todayLogs]);

  const subjectSummaries = useMemo(() => {
    const groups = new Map<string, SubjectSummary>();

    todayLogs.forEach(log => {
      const subject = subjects.find(item => item.id === log.subjectId);
      const existing = groups.get(log.subjectId);
      const startPage = log.startPage ?? 0;
      const endPage = log.endPage ?? 0;

      if (existing) {
        existing.pages += log.pagesRead;
        existing.minutes += log.timeSpentMinutes;
        existing.startPage = Math.min(existing.startPage || startPage, startPage || existing.startPage);
        existing.endPage = Math.max(existing.endPage || endPage, endPage || existing.endPage);
        existing.logs.push(log);
        if (new Date(log.timestamp).getTime() > new Date(existing.latestTimestamp).getTime()) {
          existing.latestTimestamp = log.timestamp;
        }
        return;
      }

      groups.set(log.subjectId, {
        subjectId: log.subjectId,
        name: subject?.name || log.subjectNameSnapshot || '삭제된 과목',
        pages: log.pagesRead,
        minutes: log.timeSpentMinutes,
        startPage,
        endPage,
        latestTimestamp: log.timestamp,
        logs: [log]
      });
    });

    return Array.from(groups.values()).sort(
      (a, b) => new Date(b.latestTimestamp).getTime() - new Date(a.latestTimestamp).getTime()
    );
  }, [todayLogs, subjects]);

  const openAddModal = () => {
    const firstSubject = subjects[0];
    setModalMode('add');
    setEditingSummary(null);
    setSubjectId(firstSubject?.id || '');
    setEditPages(0);
    setEditMinutes(0);
    setEditStartPage(firstSubject ? firstSubject.completedPages + 1 : 1);
  };

  const openEditModal = (summary: SubjectSummary) => {
    setModalMode('edit');
    setEditingSummary(summary);
    setSubjectId(summary.subjectId);
    setEditPages(summary.pages);
    setEditMinutes(summary.minutes);
    setEditStartPage(summary.startPage || 1);
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingSummary(null);
  };

  const saveLog = () => {
    if (!subjectId || editPages <= 0 || editMinutes < 0) {
      alert('과목, 학습량, 시간을 확인해주세요.');
      return;
    }

    const endPage = calculateEndPageValue(editStartPage, editPages);
    const replacementLog: StudyLog = {
      id: editingSummary?.logs[0]?.id || Math.random().toString(36).substr(2, 9),
      subjectId,
      pagesRead: editPages,
      timeSpentMinutes: editMinutes,
      startPage: editStartPage,
      endPage,
      timestamp: editingSummary?.latestTimestamp || new Date().toISOString(),
      isReviewed: false,
      isCondensed: editingSummary?.logs.every(log => log.isCondensed) || false
    };

    if (modalMode === 'edit' && editingSummary) {
      onReplaceLogs(editingSummary.logs.map(log => log.id), replacementLog);
    } else {
      onAddLog(replacementLog);
    }

    closeModal();
  };

  const selectedSubject = subjects.find(subject => subject.id === subjectId);
  const calculatedEndPage = editPages > 0 ? calculateEndPageValue(editStartPage, editPages) : null;

  return (
    <section className="animate-fade-in">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6 px-1">
        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <span className="p-1.5 bg-green-100 text-green-600 rounded-lg text-xs">📅</span>
          오늘의 실시간 기록
          <button
            onClick={openAddModal}
            disabled={subjects.length === 0}
            className="ml-2 h-8 w-8 rounded-xl bg-indigo-600 text-white font-black disabled:bg-slate-300 shadow-lg shadow-indigo-100"
            title="기록 추가"
          >
            +
          </button>
        </h3>
        <div className="flex gap-4">
          <div className="text-right">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">누적 학습</p>
            <p className="text-sm font-black text-slate-700">{formatNumber(totals.time)}분 / {formatNumber(totals.pages)}P</p>
          </div>
          <div className="text-right border-l pl-4 border-slate-200">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">평균 효율</p>
            <p className="text-sm font-black text-indigo-600">{totals.avgEfficiency}분/P</p>
          </div>
        </div>
      </div>

      {subjectSummaries.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-400">
          오늘 기록이 아직 없습니다. + 버튼으로 직접 추가할 수 있어요.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {subjectSummaries.map(summary => {
            const efficiency = summary.pages > 0 ? (summary.minutes / summary.pages).toFixed(2) : '0';

            return (
              <div key={summary.subjectId} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between group hover:border-indigo-300 transition-all">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-lg">📝</div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-slate-400 truncate w-36">{summary.name}</p>
                    <p className="text-base font-black text-slate-800">
                      {formatNumber(summary.pages)}P <span className="text-xs font-normal text-slate-400">({formatNumber(summary.minutes)}분)</span>
                    </p>
                    <p className="mt-1 text-[10px] font-bold text-slate-300">
                      {summary.logs.length}회 합산 · p.{formatNumber(summary.startPage)} ~ p.{formatNumber(summary.endPage)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-xs font-bold text-indigo-600">{efficiency}분/P</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => openEditModal(summary)}
                      title="합산 기록 수정"
                      className="p-1.5 text-slate-300 hover:text-indigo-600 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </button>
                    <button
                      onClick={() => onDeleteLogs(summary.logs.map(log => log.id))}
                      title="합산 기록 삭제"
                      className="p-1.5 text-slate-300 hover:text-rose-600 transition-colors"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalMode && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-[10000]">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-10 shadow-2xl animate-fade-in">
            <h4 className="text-xl font-black mb-8">{modalMode === 'edit' ? '합산 기록 수정' : '기록 추가'}</h4>
            <div className="space-y-5 mb-10">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">과목</label>
                <select
                  value={subjectId}
                  onChange={e => {
                    const nextSubject = subjects.find(subject => subject.id === e.target.value);
                    setSubjectId(e.target.value);
                    if (modalMode === 'add' && nextSubject) {
                      setEditStartPage(nextSubject.completedPages + 1);
                    }
                  }}
                  className="w-full p-4 bg-slate-50 rounded-2xl font-black text-center text-lg outline-none"
                >
                  <option value="">과목 선택</option>
                  {subjects.map(subject => (
                    <option key={subject.id} value={subject.id}>{subject.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">학습량(P)</label>
                <input type="number" step="1" value={editPages} onChange={e => setEditPages(Number(e.target.value))} className="w-full p-4 bg-slate-50 rounded-2xl font-black text-center text-lg" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">소요 시간(분)</label>
                <input type="number" value={editMinutes} onChange={e => setEditMinutes(Number(e.target.value))} className="w-full p-4 bg-slate-50 rounded-2xl font-black text-center text-lg" />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={closeModal} className="flex-1 py-4 bg-slate-100 rounded-2xl font-bold">취소</button>
              <button onClick={saveLog} className="flex-[2] py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg">
                {modalMode === 'edit' ? '수정 저장' : '추가 저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
