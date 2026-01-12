
import React, { useState, useRef } from 'react';
import { Subject, StudyLog } from '../types';

interface Props {
  subjects: Subject[];
  onLogSession: (log: StudyLog) => void;
}

export const SessionLogger: React.FC<Props> = ({ subjects, onLogSession }) => {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || '');
  const [pages, setPages] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhoto(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLog = () => {
    if (!subjectId || pages <= 0 || minutes <= 0) return;
    onLogSession({
      id: Math.random().toString(36).substr(2, 9),
      subjectId,
      pagesRead: pages,
      timeSpentMinutes: minutes,
      timestamp: new Date().toISOString(),
      photoBase64: photo,
      isReviewed: false
    });
    setPages(0);
    setMinutes(0);
    setPhoto(undefined);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <span className="text-green-600">⏱️</span> 학습 기록 & 사진 첨부
      </h2>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">과목 선택</label>
          <select 
            className="w-full p-2 border rounded-lg bg-slate-50"
            value={subjectId}
            onChange={e => setSubjectId(e.target.value)}
          >
            <option value="">과목을 선택하세요...</option>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">학습 페이지</label>
            <input 
              type="number"
              className="w-full p-2 border rounded-lg bg-slate-50"
              value={pages}
              onChange={e => setPages(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">소요 시간(분)</label>
            <input 
              type="number"
              className="w-full p-2 border rounded-lg bg-slate-50"
              value={minutes}
              onChange={e => setMinutes(Number(e.target.value))}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">노트 사진 (선택)</label>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            >
              📷 사진 선택
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              accept="image/*" 
              className="hidden" 
            />
            {photo && (
              <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-slate-200">
                <img src={photo} className="w-full h-full object-cover" alt="Preview" />
                <button 
                  onClick={() => setPhoto(undefined)}
                  className="absolute top-0 right-0 bg-red-500 text-white text-[8px] p-0.5"
                >✕</button>
              </div>
            )}
          </div>
        </div>

        <button 
          onClick={handleLog}
          className="w-full py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-shadow shadow-lg shadow-green-100"
        >
          학습 내용 저장하기
        </button>
      </div>
    </div>
  );
};
