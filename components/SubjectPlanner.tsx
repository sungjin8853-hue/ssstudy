import React, { useState } from 'react';
import { Subject } from '../types';
import { calculateFreshWeekdayPagePlan, getDiffDays } from '../utils/schedule';

interface Props {
  onAddSubject: (s: Subject) => void;
}

export const SubjectPlanner: React.FC<Props> = ({ onAddSubject }) => {
  const weekdays = [1, 2, 3, 4, 5, 6, 0];
  const [name, setName] = useState('');
  const [currentPages, setCurrentPages] = useState(0);
  const [pages, setPages] = useState(100);
  const [date, setDate] = useState('');
  const [isRequired, setIsRequired] = useState(false);

  const handleAdd = () => {
    if (!name || !date) return;
    const nextSubject: Subject = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      createdAt: new Date().toISOString(),
      planResetDate: new Date().toISOString().slice(0, 10),
      startPage: 1,
      totalPages: pages,
      completedPages: currentPages,
      targetDate: date,
      isRequired,
      scheduledWeekdays: weekdays,
    };

    onAddSubject({
      ...nextSubject,
      scheduledWeekdayPages: calculateFreshWeekdayPagePlan(
        nextSubject,
        Math.max(0, pages - currentPages),
        getDiffDays(date)
      )
    });
    setName('');
    setPages(100);
    setCurrentPages(0);
    setDate('');
    setIsRequired(false);
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
          계획 등록 및 분석 시작
        </button>
      </div>
      <p className="mt-8 text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest">
        * 등록된 계획은 실시간 데이터 분석을 통해 매일의 권장 학습량을 산출합니다.
      </p>
    </div>
  );
};
