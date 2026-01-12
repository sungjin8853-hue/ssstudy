
import React, { useState } from 'react';
import { Subject } from '../types';

interface Props {
  subjects: Subject[];
  onAddSubject: (s: Subject) => void;
  onDeleteSubject: (id: string) => void;
}

export const SubjectPlanner: React.FC<Props> = ({ subjects, onAddSubject, onDeleteSubject }) => {
  const [name, setName] = useState('');
  const [pages, setPages] = useState(100);
  const [date, setDate] = useState('');

  const handleAdd = () => {
    if (!name || !date) return;
    onAddSubject({
      id: Math.random().toString(36).substr(2, 9),
      name,
      totalPages: pages,
      completedPages: 0,
      targetDate: date,
    });
    setName('');
  };

  const getRecommendedDaily = (subject: Subject) => {
    const today = new Date();
    const target = new Date(subject.targetDate);
    const diffTime = target.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 0) return subject.totalPages - subject.completedPages;
    return Math.ceil((subject.totalPages - subject.completedPages) / diffDays);
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <span className="text-indigo-600">📅</span> 학습 계획 플래너
      </h2>
      
      <div className="space-y-4 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input 
            placeholder="과목 이름"
            value={name}
            onChange={e => setName(e.target.value)}
            className="p-2 border rounded-lg"
          />
          <input 
            type="number"
            placeholder="전체 페이지 수"
            value={pages}
            onChange={e => setPages(Number(e.target.value))}
            className="p-2 border rounded-lg"
          />
          <input 
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="p-2 border rounded-lg"
          />
        </div>
        <button 
          onClick={handleAdd}
          className="w-full py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
        >
          계획 추가하기
        </button>
      </div>

      <div className="space-y-4">
        {subjects.map(sub => (
          <div key={sub.id} className="p-4 border rounded-xl bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-slate-800">{sub.name}</h3>
              <p className="text-xs text-slate-500">목표: {sub.totalPages}페이지 / {new Date(sub.targetDate).toLocaleDateString()}까지</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-xs font-semibold text-indigo-600 uppercase">일일 권장량</p>
                <p className="text-lg font-bold">{getRecommendedDaily(sub)} <span className="text-xs font-normal text-slate-400">페이지 / 일</span></p>
              </div>
              <button 
                onClick={() => onDeleteSubject(sub.id)}
                className="text-red-400 hover:text-red-600 p-2"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
        {subjects.length === 0 && <p className="text-center text-slate-400 py-4 italic text-sm">계획된 과목이 없습니다. 새로운 과목을 추가해 보세요.</p>}
      </div>
    </div>
  );
};
