import React, { useMemo, useState } from 'react';
import { StudyLog, Subject } from '../types';
import { calculateStats } from '../utils/math';
import {
  calculateFreshWeekdayPagePlan,
  getDiffDays,
  getActiveSubjectStage,
  getSubjectRemainingPageCount,
  WEEKDAYS
} from '../utils/schedule';

interface Props {
  subjects: Subject[];
  logs: StudyLog[];
  onAddSubject: (s: Subject) => void;
}

export const SubjectPlanner: React.FC<Props> = ({ subjects, logs, onAddSubject }) => {
  const [name, setName] = useState('');
  const [startPage, setStartPage] = useState(1);
  const [currentPages, setCurrentPages] = useState(0);
  const [pages, setPages] = useState(100);
  const [date, setDate] = useState('');
  const [isRequired, setIsRequired] = useState(false);
  const [efficiencySourceId, setEfficiencySourceId] = useState('');
  const [scheduledWeekdays, setScheduledWeekdays] = useState<number[]>(WEEKDAYS.map(day => day.id));

  const toggleWeekday = (weekday: number) => {
    setScheduledWeekdays(current => {
      if (current.includes(weekday)) {
        if (current.length === 1) return current;
        return current.filter(day => day !== weekday);
      }

      return WEEKDAYS.map(day => day.id).filter(day => current.includes(day) || day === weekday);
    });
  };

  const efficiencySources = useMemo(() => (
    subjects
      .map(subject => {
        const stats = calculateStats(
          logs.filter(log => log.subjectId === subject.id),
          getSubjectRemainingPageCount(subject),
          0,
          subject.initialAverageTimePerPage
        );
        return {
          id: subject.id,
          name: getActiveSubjectStage(subject)?.name || subject.name,
          averageTimePerPage: stats.averageTimePerPage
        };
      })
      .filter(subject => subject.averageTimePerPage > 0)
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  ), [logs, subjects]);

  const handleAdd = () => {
    if (!name || !date) return;
    const normalizedStartPage = Math.max(1, Math.round(Number(startPage) || 1));
    const normalizedEndPage = Math.max(normalizedStartPage, Math.round(Number(pages) || normalizedStartPage));
    const normalizedCompletedPage = Math.min(
      normalizedEndPage,
      Math.max(normalizedStartPage - 1, Math.round(Number(currentPages) || 0))
    );
    const efficiencySource = efficiencySources.find(subject => subject.id === efficiencySourceId);
    const nextSubject: Subject = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      createdAt: new Date().toISOString(),
      planResetDate: new Date().toISOString().slice(0, 10),
      startPage: normalizedStartPage,
      totalPages: normalizedEndPage,
      completedPages: normalizedCompletedPage,
      targetDate: date,
      initialAverageTimePerPage: efficiencySource?.averageTimePerPage,
      isRequired,
      scheduledWeekdays,
    };

    onAddSubject({
      ...nextSubject,
      scheduledWeekdayPages: calculateFreshWeekdayPagePlan(
        nextSubject,
        getSubjectRemainingPageCount(nextSubject),
        getDiffDays(date)
      )
    });
    setName('');
    setStartPage(1);
    setPages(100);
    setCurrentPages(0);
    setDate('');
    setIsRequired(false);
    setEfficiencySourceId('');
    setScheduledWeekdays(WEEKDAYS.map(day => day.id));
  };

  return (
    <div className="animate-fade-in">
      <h2 className="text-xl font-black text-slate-800 flex items-center gap-2 mb-8">
        <span className="w-2 h-5 bg-indigo-600 rounded-full"></span>
        새 학습 계획 추가
      </h2>
      
      <div className="space-y-4 max-w-2xl mx-auto">
        <div className="bg-slate-50 p-8 rounded-3xl border border-slate-100 space-y-6">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-widest">과목 명칭</label>
            <input 
              placeholder="예: 선형대수학, 토익 900"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full p-4 border border-slate-200 rounded-2xl bg-white font-bold outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-widest">시작 페이지</label>
              <input
                type="number"
                min="1"
                step="1"
                value={startPage}
                onChange={e => {
                  const nextStartPage = Number(e.target.value);
                  setStartPage(nextStartPage);
                  setCurrentPages(current => Math.max(nextStartPage - 1, current));
                }}
                className="w-full p-4 border border-slate-200 rounded-2xl bg-white font-bold outline-none focus:ring-4 focus:ring-indigo-500/10"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-widest">현재 완료 페이지</label>
              <input 
                type="number"
                step="1"
                value={currentPages}
                onChange={e => setCurrentPages(Number(e.target.value))}
                className="w-full p-4 border border-slate-200 rounded-2xl bg-white font-bold outline-none focus:ring-4 focus:ring-indigo-500/10"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-widest">총 목표 페이지</label>
              <input 
                type="number"
                step="1"
                value={pages}
                onChange={e => setPages(Number(e.target.value))}
                className="w-full p-4 border border-slate-200 rounded-2xl bg-white font-bold outline-none focus:ring-4 focus:ring-indigo-500/10"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-widest">목표 완료 날짜</label>
              <input 
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full p-4 border border-slate-200 rounded-2xl bg-white font-bold outline-none focus:ring-4 focus:ring-indigo-500/10"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">학습 요일</label>
            <div className="grid grid-cols-7 gap-1.5 rounded-2xl border border-slate-200 bg-white p-2">
              {WEEKDAYS.map(day => {
                const selected = scheduledWeekdays.includes(day.id);
                return (
                  <button
                    key={day.id}
                    type="button"
                    onClick={() => toggleWeekday(day.id)}
                    className={`rounded-xl py-3 text-sm font-black transition-all ${
                      selected
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-400 hover:bg-indigo-50 hover:text-indigo-500'
                    }`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-widest">기존 효율 가져오기</label>
            <select
              value={efficiencySourceId}
              onChange={event => setEfficiencySourceId(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white p-4 font-bold text-slate-800 outline-none focus:ring-4 focus:ring-indigo-500/10"
            >
              <option value="">사용 안 함</option>
              {efficiencySources.map(subject => (
                <option key={subject.id} value={subject.id}>
                  {subject.name} · {subject.averageTimePerPage.toFixed(2)}분/P
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-widest">중요도</label>
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white p-2 border border-slate-200">
              <button
                type="button"
                onClick={() => setIsRequired(true)}
                className={`rounded-xl py-3 text-sm font-black transition-all ${
                  isRequired
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-400 hover:bg-rose-50 hover:text-rose-500'
                }`}
              >
                필수
              </button>
              <button
                type="button"
                onClick={() => setIsRequired(false)}
                className={`rounded-xl py-3 text-sm font-black transition-all ${
                  !isRequired
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-400 hover:bg-indigo-50 hover:text-indigo-500'
                }`}
              >
                미필수
              </button>
            </div>
            <p className="px-1 text-[10px] font-bold text-slate-400">
              학습 측정 자동 선택에서는 필수가 먼저 나오고, 같은 그룹 안에서는 예상 시간이 짧은 과목부터 선택됩니다.
            </p>
          </div>
          <label className="hidden">
            <div>
              <p className="font-black text-slate-700">복습 일정 사용</p>
              <p className="mt-1 text-xs font-medium text-slate-400">
                끄면 이 과목의 학습 기록은 복습 관리에 표시되지 않습니다.
              </p>
            </div>
            <input
              type="checkbox"
              className="h-6 w-6 shrink-0 accent-indigo-600"
            />
          </label>
        </div>
        <button 
          onClick={handleAdd}
          className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black text-sm hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all active:scale-[0.98]"
        >
          계획 등록
        </button>
      </div>
      <p className="mt-8 text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest">
        * 등록된 계획은 실시간 데이터 분석을 통해 매일의 권장 학습량을 산출합니다.
      </p>
    </div>
  );
};
