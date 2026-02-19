import React, { useState } from 'react';
import { Subject } from '../types';

interface Props {
  onAddSubject: (s: Subject) => void;
}

export const SubjectPlanner: React.FC<Props> = ({ onAddSubject }) => {
  const [name, setName] = useState('');
  const [currentPages, setCurrentPages] = useState(0);
  const [pages, setPages] = useState(100);
  const [date, setDate] = useState('');

  const handleAdd = () => {
    if (!name || !date) return;
    onAddSubject({
      id: Math.random().toString(36).substr(2, 9),
      name,
      totalPages: pages,
      completedPages: currentPages,
      targetDate: date,
    });
    setName('');
    setPages(100);
    setCurrentPages(0);
    setDate('');
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
                value={currentPages}
                onChange={e => setCurrentPages(Number(e.target.value))}
                className="w-full p-4 border border-slate-200 rounded-2xl bg-white font-bold outline-none focus:ring-4 focus:ring-indigo-500/10"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-widest">총 목표 페이지</label>
              <input 
                type="number"
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
