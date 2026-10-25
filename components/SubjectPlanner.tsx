import React, { useState } from 'react';
import { Subject, SubjectChapter } from '../types';
import { DEFAULT_GROWTH_PAGE_UNIT, getGrowthUnitSize } from '../utils/pageGrowth';
import { parseChapterText } from '../utils/subjectChapters';
import { DEFAULT_PAGE_LABEL, MAX_PAGE_LABEL_LENGTH, normalizePageLabel, pageWord } from '../utils/pageLabel';
import {
  calculateFreshWeekdayPagePlan,
  getDiffDays,
  getLocalDateKey,
  getSubjectRemainingPageCount,
  WEEKDAYS
} from '../utils/schedule';

interface Props {
  onAddSubject: (s: Subject) => void;
}

export const createNewStudyPlan = (name: string, startPage: number, endPage: number, targetDate: string,
  isRequired: boolean, scheduledWeekdays: number[], growthPageUnit = DEFAULT_GROWTH_PAGE_UNIT,
  pageLabel = DEFAULT_PAGE_LABEL, chapters: SubjectChapter[] = []): Subject => {
  // 단원을 미리 정했으면 시작·끝 페이지는 첫 단원 시작과 마지막 단원 끝이다
  if (chapters.length > 0) {
    startPage = chapters[0].startPage;
    endPage = chapters[chapters.length - 1].endPage;
  }
  const normalizedStartPage = Math.max(1, Math.round(Number(startPage) || 1));
  const now = new Date();
  return {
    id: Math.random().toString(36).substr(2, 9), name,
    createdAt: now.toISOString(), planResetDate: getLocalDateKey(now),
    startPage: normalizedStartPage,
    totalPages: Math.max(normalizedStartPage, Math.round(Number(endPage) || normalizedStartPage)),
    completedPages: normalizedStartPage - 1, targetDate, isRequired, scheduledWeekdays,
    // 0은 '단위 없음': 효율이 초기화되지 않고 계속 이어진다.
    growthPageUnit: getGrowthUnitSize(growthPageUnit),
    pageLabel: normalizePageLabel(pageLabel),
    ...(chapters.length > 0 ? { chapters: chapters.map(item => ({ ...item })) } : {})
  };
};

export const SubjectPlanner: React.FC<Props> = ({ onAddSubject }) => {
  const [name, setName] = useState('');
  const [startPage, setStartPage] = useState(1);
  const [pages, setPages] = useState(100);
  const [date, setDate] = useState('');
  const [isRequired, setIsRequired] = useState(false);
  const [growthPageUnit, setGrowthPageUnit] = useState(DEFAULT_GROWTH_PAGE_UNIT);
  const [noPageUnit, setNoPageUnit] = useState(false);
  const [pageLabel, setPageLabel] = useState(DEFAULT_PAGE_LABEL);
  const [chapterText, setChapterText] = useState('');
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


  const chapterParse = parseChapterText(chapterText);
  const hasChapters = chapterParse.chapters.length > 0;

  const handleAdd = () => {
    if (!name || !date || chapterParse.error) return;
    const nextSubject = createNewStudyPlan(name, startPage, pages, date, isRequired, scheduledWeekdays,
      0, pageLabel, chapterParse.chapters);

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
    setDate('');
    setIsRequired(false);
    setGrowthPageUnit(DEFAULT_GROWTH_PAGE_UNIT);
    setNoPageUnit(false);
    setPageLabel(DEFAULT_PAGE_LABEL);
    setChapterText('');
    setScheduledWeekdays(WEEKDAYS.map(day => day.id));
  };

  const word = pageWord(normalizePageLabel(pageLabel));
  const labelClass = 'ml-1 text-[13px] font-bold text-slate-500';
  const fieldClass = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-base font-bold outline-none transition-all focus:ring-4 focus:ring-indigo-500/10';
  return (
    <div className="animate-fade-in">
      <h2 className="mb-3 flex items-center gap-2 text-xl font-black text-slate-800 md:text-2xl">
        <span className="h-6 w-2 rounded-full bg-indigo-600"></span>
        새 학습 계획 추가
      </h2>

      <div className="space-y-3">
        <div className="space-y-3 rounded-3xl border border-slate-100 bg-slate-50 p-4">
          {/* 입력칸은 가로로 나란히(넓은 화면 4칸, 좁으면 2칸) 놓아 세로로 길어지지 않게 한다 */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 md:grid-cols-4">
            <div className="col-span-2 space-y-1">
              <label htmlFor="new-plan-name" className={labelClass}>과목 명칭</label>
              <input
                id="new-plan-name"
                placeholder="예: 선형대수학, 토익 900"
                value={name}
                onChange={e => setName(e.target.value)}
                className={fieldClass}
              />
            </div>
            <div className="col-span-2 space-y-1">
              <label htmlFor="new-plan-date" className={labelClass}>목표 완료 날짜</label>
              <input id="new-plan-date" type="date" value={date}
                onChange={e => setDate(e.target.value)} className={fieldClass} />
            </div>
            <div className="space-y-1">
              <label htmlFor="new-plan-start" className={labelClass}>시작 페이지</label>
              <input id="new-plan-start" type="number" min="1" step="1" value={hasChapters ? chapterParse.chapters[0].startPage : startPage} disabled={hasChapters}
                onChange={e => setStartPage(Number(e.target.value))} className={`${fieldClass} ${hasChapters ? 'opacity-40' : ''}`} />
            </div>
            <div className="space-y-1">
              <label htmlFor="new-plan-end" className={labelClass}>끝 페이지</label>
              <input id="new-plan-end" type="number" step="1" value={hasChapters ? chapterParse.chapters[chapterParse.chapters.length - 1].endPage : pages} disabled={hasChapters}
                onChange={e => setPages(Number(e.target.value))} className={`${fieldClass} ${hasChapters ? 'opacity-40' : ''}`} />
            </div>
            <div className="col-span-2 space-y-1">
              <label htmlFor="new-plan-chapters" className={labelClass}>단원 범위</label>
              <input id="new-plan-chapters" value={chapterText} placeholder="1~10, 20~30"
                onChange={event => setChapterText(event.target.value)} className={fieldClass} />
              {chapterParse.error && <p data-testid="new-plan-chapters-error" className="ml-1 text-[13px] font-bold text-rose-600">{chapterParse.error}</p>}
            </div>
            <div className="col-span-2 space-y-1 md:col-span-1">
              <label htmlFor="new-plan-page-label" className={labelClass}>단위 이름</label>
              <input id="new-plan-page-label" value={pageLabel} maxLength={MAX_PAGE_LABEL_LENGTH}
                placeholder={DEFAULT_PAGE_LABEL} onChange={event => setPageLabel(event.target.value)} className={fieldClass} />
            </div>
            <div className="col-span-2 space-y-1 md:col-span-1">
              <p className={labelClass}>중요도</p>
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setIsRequired(true)}
                  className={`rounded-lg py-2 text-base font-black transition-all ${
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
                  className={`rounded-lg py-2 text-base font-black transition-all ${
                    !isRequired
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-400 hover:bg-indigo-50 hover:text-indigo-500'
                  }`}
                >
                  미필수
                </button>
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <p className={labelClass}>학습 요일</p>
            <div className="grid grid-cols-7 gap-1 rounded-xl border border-slate-200 bg-white p-1">
              {WEEKDAYS.map(day => {
                const selected = scheduledWeekdays.includes(day.id);
                return (
                  <button
                    key={day.id}
                    type="button"
                    onClick={() => toggleWeekday(day.id)}
                    className={`rounded-lg py-2 text-base font-black transition-all ${
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
          <p className="px-1 text-[13px] font-bold text-slate-500">
            학습 측정 자동 선택에서는 필수가 먼저 나오고, 같은 그룹 안에서는 예상 시간이 짧은 과목부터 선택됩니다.
          </p>
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
          className="w-full rounded-2xl bg-indigo-600 py-3 text-base font-black text-white shadow-xl shadow-indigo-100 transition-all hover:bg-indigo-700 active:scale-[0.98]"
        >
          계획 등록
        </button>
      </div>
      <p className="mt-3 text-center text-[13px] font-bold text-slate-400">
        * 등록된 계획은 실시간 데이터 분석을 통해 매일의 권장 학습량을 산출합니다.
      </p>
    </div>
  );
};
