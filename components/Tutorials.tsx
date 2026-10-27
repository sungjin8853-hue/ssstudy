import React, { useEffect, useState } from 'react';

/** 설명 글을 화면 곳곳에 넣는 대신, 한 번에 보여주는 튜토리얼 화면. 값은 모두 예시다. */

type Accent = 'indigo' | 'amber' | 'teal' | 'sky';

const ACCENTS: Record<Accent, { solid: string; tint: string; ring: string }> = {
  indigo: { solid: 'bg-indigo-600 text-white', tint: 'bg-indigo-100 text-indigo-700', ring: 'border-indigo-600' },
  amber: { solid: 'bg-amber-700 text-white', tint: 'bg-amber-100 text-amber-800', ring: 'border-amber-700' },
  teal: { solid: 'bg-teal-700 text-white', tint: 'bg-teal-100 text-teal-800', ring: 'border-teal-700' },
  sky: { solid: 'bg-sky-700 text-white', tint: 'bg-sky-100 text-sky-800', ring: 'border-sky-700' }
};

interface TutorialStep {
  label: string;
  accent: Accent;
  symbol: string;
  title: string;
  lead: string;
  body: React.ReactNode;
}

const TutorialShell: React.FC<{ title: string; steps: TutorialStep[]; finishLabel: string; onClose: () => void }> = ({ title, steps, finishLabel, onClose }) => {
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const accent = ACCENTS[step.accent];
  const last = index === steps.length - 1;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[10001] flex flex-col overflow-y-auto bg-slate-50">
      <header className="flex h-[72px] shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 md:px-8">
        <div className="flex items-center gap-4">
          <button type="button" aria-label="튜토리얼 닫기" onClick={onClose}
            className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-300 text-slate-900 hover:bg-slate-50">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <h1 className="text-xl font-black text-slate-900">{title}</h1>
        </div>
        <div className="flex items-center gap-5">
          <span className="font-mono text-[15px] font-bold text-slate-900">{index + 1} / {steps.length}</span>
          <button type="button" onClick={onClose} className="h-12 px-2 text-[15px] font-semibold text-slate-600 hover:text-slate-900">건너뛰기</button>
        </div>
      </header>
      <div className="h-1 shrink-0 bg-slate-200"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${Math.round((index + 1) / steps.length * 100)}%` }} /></div>
      <main className="flex flex-1 flex-wrap items-start gap-6 p-6 md:gap-8 md:p-8">
        <nav aria-label="단계" className="flex w-full flex-col gap-2 md:w-[260px] md:shrink-0">
          {steps.map((item, itemIndex) => {
            const current = itemIndex === index;
            const done = itemIndex < index;
            return (
              <button key={item.label} type="button" aria-current={current ? 'step' : undefined} onClick={() => setIndex(itemIndex)}
                className={`flex min-h-[60px] w-full items-center gap-3.5 rounded-xl border-2 px-3.5 py-2 text-left text-base font-bold text-slate-900 ${current ? `bg-white ${ACCENTS[item.accent].ring}` : 'border-transparent hover:bg-white/70'}`}>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold ${current ? ACCENTS[item.accent].solid : done ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-700'}`}>
                  {done ? '✓' : itemIndex + 1}
                </span>
                {item.label}
              </button>
            );
          })}
        </nav>
        <section aria-labelledby="tutorial-step-title" className="flex min-h-[520px] min-w-0 flex-1 basis-[28rem] flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
          <div className="flex items-center gap-4">
            <span aria-hidden="true" className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl font-mono text-[26px] font-bold ${accent.tint}`}>{step.symbol}</span>
            <div className="flex min-w-0 flex-col gap-1">
              <h2 id="tutorial-step-title" className="text-[26px] font-black tracking-tight text-slate-900">{step.title}</h2>
              <p className="text-base font-medium leading-relaxed text-slate-700">{step.lead}</p>
            </div>
          </div>
          {step.body}
          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-2">
            <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}
              className="h-14 min-w-[120px] rounded-xl border border-slate-300 bg-white px-6 text-base font-bold text-slate-900 disabled:border-slate-200 disabled:text-slate-400">이전</button>
            <button type="button" onClick={() => last ? onClose() : setIndex(index + 1)}
              className="h-14 min-w-[160px] rounded-xl bg-indigo-600 px-8 text-[17px] font-black text-white shadow-[0_3px_0_#3730A3] hover:bg-indigo-700">
              {last ? finishLabel : '다음'}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
};

const GRID_BG: React.CSSProperties = {
  backgroundColor: '#FFFFFF',
  backgroundImage: 'linear-gradient(#E8ECFB 1px, transparent 1px), linear-gradient(90deg, #E8ECFB 1px, transparent 1px)',
  backgroundSize: '24px 24px'
};

const Chips: React.FC<{ items: Array<{ text: string; cls: string }> }> = ({ items }) => (
  <div className="flex flex-wrap gap-2.5">
    {items.map(item => <span key={item.text} className={`rounded-full px-3.5 py-2 text-[15px] font-black ${item.cls}`}>{item.text}</span>)}
  </div>
);

const Mono: React.FC<{ tone: 'colon' | 'semi' | 'logic'; children: string }> = ({ tone, children }) => (
  <span className={`font-mono font-bold ${tone === 'colon' ? 'text-indigo-600' : tone === 'semi' ? 'text-amber-700' : 'text-teal-700'}`}>{children}</span>
);

/** 글자가 든 논리어(`[개념:정의]` `{원인}`): 고정폭 글꼴 대신 노트와 같은 글꼴로, 색만 논리어 색이다 */
const Logic: React.FC<{ children: string }> = ({ children }) => <span className="font-semibold text-teal-700">{children}</span>;

const NoteSample: React.FC<{ lines: React.ReactNode[]; note?: string; label?: string }> = ({ lines, note, label = '이렇게 써요' }) => (
  <div className="flex flex-col gap-2.5">
    <span className="text-[13px] font-bold text-slate-600">{label}</span>
    <div className="flex flex-col rounded-xl border border-slate-200 px-5 py-2 text-xl leading-[40px]" style={GRID_BG}>
      {lines.map((line, i) => <div key={i} className="flex flex-wrap items-center whitespace-pre">{line}</div>)}
    </div>
    {note && <span className="text-sm font-medium leading-relaxed text-slate-700">{note}</span>}
  </div>
);

const QuestionSamples: React.FC<{ items: Array<{ kind: string; q: string; a: string }> }> = ({ items }) => (
  <div className="flex flex-col gap-2.5">
    <span className="text-[13px] font-bold text-slate-600">복습에서는 이런 문제가 나와요</span>
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {items.map(item => (
        <div key={item.kind + item.q} className="flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-[18px] py-4">
          <span className="self-start rounded-md bg-indigo-100 px-2.5 py-0.5 text-xs font-black text-indigo-800">{item.kind}</span>
          <span className="text-xl font-black leading-snug text-slate-900">{item.q}</span>
          <span className="flex items-start gap-2 text-[15px] font-semibold leading-relaxed text-indigo-800"><span aria-hidden="true">→</span>{item.a}</span>
        </div>
      ))}
    </div>
  </div>
);

const NOTE_STEPS: TutorialStep[] = [
  {
    label: '두 가지를 이어요', accent: 'indigo', symbol: ':', title: '두 가지를 이어요',
    lead: '앞과 뒤를 콜론(:)으로 이으면, 복습 때 양쪽을 서로 물어봐요.',
    body: <>
      <NoteSample lines={[<><span>등차수열</span><Mono tone="colon">:</Mono><span>연속한 두 항의 차가 일정한 수열</span></>]} />
      <QuestionSamples items={[
        { kind: '기본 관계', q: '등차수열', a: '연속한 두 항의 차가 일정한 수열' },
        { kind: '역방향', q: '연속한 두 항의 차가 일정한 수열', a: '등차수열' }
      ]} />
    </>
  },
  {
    label: '거꾸로만 물어요', accent: 'amber', symbol: '; <', title: '거꾸로만 물어요',
    lead: '작다 기호(<)는 “←”예요. 오른쪽을 보고 왼쪽을 떠올리는 문제만 만들어져요. 반대로 세미콜론(;)은 “→”라서 앞에서 뒤로만 물어요.',
    body: <>
      <NoteSample lines={[<><span>공차</span><Mono tone="semi">&lt;</Mono><span>이웃한 두 항의 차</span></>]} note="앞에서 뒤로도 묻고 싶으면 <를 :로 바꾸면 돼요." />
      <QuestionSamples items={[{ kind: '역방향', q: '이웃한 두 항의 차', a: '공차' }]} />
    </>
  },
  {
    label: '그리고 · 등호', accent: 'teal', symbol: ', =', title: '그리고 · 등호',
    lead: '쉼표(,)는 “둘 다”, 등호(=)는 한 칸 안에서 “서로 같다”고 잇는 말이에요. 한 칸 안에서는 -나 ,보다 먼저 물어요.',
    body: <>
      <NoteSample lines={[
        <><span>삼각형</span><Mono tone="colon">:</Mono><span>세 변이 있다</span><Mono tone="logic">,</Mono><span>세 각이 있다</span></>,
        <><span>정사각형</span><Mono tone="logic">=</Mono><span>네 각이 직각</span></>
      ]} />
      <QuestionSamples items={[
        { kind: '기본 관계', q: '삼각형', a: '세 변이 있다 그리고 세 각이 있다' },
        { kind: '기본 관계', q: '정사각형', a: '네 각이 직각' }
      ]} />
    </>
  },
  {
    label: '묶어서 써요', accent: 'teal', symbol: '( )', title: '묶어서 써요',
    lead: '괄호(( ))로 묶으면, 묶음 하나를 한 덩어리로 보고 문제를 만들어요. A:(B:C)는 "A의 B는 C"로 읽어요.',
    body: <>
      <NoteSample lines={[<><span>수열의 합</span><Mono tone="colon">:</Mono><Mono tone="logic">(</Mono><span>등차수열</span><Mono tone="colon">:</Mono><span>항의 개수와 첫항과 끝항</span><Mono tone="logic">)</Mono><Mono tone="logic">,</Mono><Mono tone="logic">(</Mono><span>등비수열</span><Mono tone="colon">:</Mono><span>첫항과 공비</span><Mono tone="logic">)</Mono></>]} />
      <QuestionSamples items={[
        { kind: '기본 관계', q: '수열의 합', a: '등차수열 그리고 등비수열' },
        { kind: '전체 재구성', q: '수열의 합', a: '(등차수열 → 항의 개수와 첫항과 끝항) 그리고 (등비수열 → 첫항과 공비)' },
        { kind: '괄호 안 관계', q: '‘수열의 합’의 ‘등차수열’에 이어지는 것은?', a: '항의 개수와 첫항과 끝항' }
      ]} />
    </>
  },
  {
    label: '접어서 정리해요', accent: 'indigo', symbol: '>', title: '접어서 정리해요',
    lead: '줄 맨 앞에서 > 와 스페이스를 누르면 토글이 돼요. 토글 안의 줄들은 하나로 묶여요.',
    body: <>
      <NoteSample lines={[
        <><span className="text-indigo-800">▾ </span><span className="font-semibold">수열의 합</span><Mono tone="colon">:</Mono></>,
        <><span className="inline-block w-7" /><span>등차수열</span><Mono tone="colon">:</Mono><span>항의 개수와 첫항과 끝항</span></>,
        <><span className="inline-block w-7" /><span>등비수열</span><Mono tone="colon">:</Mono><span>첫항과 공비</span></>
      ]} />
      <QuestionSamples items={[
        { kind: '기본 관계', q: '수열의 합', a: '등차수열 그리고 등비수열' },
        { kind: '역방향', q: '등차수열 그리고 등비수열', a: '수열의 합' }
      ]} />
    </>
  },
  {
    label: '이름을 붙여요', accent: 'teal', symbol: '[ ]', title: '이름을 붙여요',
    lead: '줄 맨 앞에 [ ]를 쓰면 이름이 붙어요. [개념:정의]는 칸마다 개념·정의라는 이름을, [수열]은 그 셀이 수열에 속한다는 표시를 달아요.',
    body: <>
      <NoteSample lines={[
        <><Logic>[개념:정의]</Logic><span> 증기기관</span><Mono tone="colon">:</Mono><span>열로 피스톤을 움직이는 기관</span></>,
        <><span>수열</span><Mono tone="colon">:</Mono><span>수를 차례로 늘어놓은 것</span></>,
        <><Logic>[수열]</Logic><span> 등차수열</span><Mono tone="colon">:</Mono><span>이웃한 두 항의 차가 일정한 수열</span></>
      ]} />
      <QuestionSamples items={[
        { kind: '이름이 붙은 문제', q: '‘개념:정의’에서 개념 ‘증기기관’에 이어지는 정의 값은?', a: '열로 피스톤을 움직이는 기관' },
        { kind: '집합 안의 문제', q: '‘수열’에서 ‘등차수열’에 이어지는 것은?', a: '이웃한 두 항의 차가 일정한 수열' }
      ]} />
    </>
  },
  {
    label: '겹치는 곳을 찾아요', accent: 'teal', symbol: '.', title: '겹치는 곳을 찾아요',
    lead: '[ ] 안에서 마침표(.)는 교집합이에요. [삼각형.특수한 도형]은 두 집합에 모두 든 셀의 자리예요. 쉼표(,)로 이으면 어느 한쪽에라도 든 셀이에요.',
    body: <>
      <NoteSample lines={[
        <><span className="text-indigo-800">▾ </span><span className="font-semibold">삼각형</span><span className="text-slate-500">  이등변삼각형 · 직각삼각형</span></>,
        <><span className="text-indigo-800">▾ </span><span className="font-semibold">특수한 도형</span><span className="text-slate-500">  이등변삼각형 · 정사각형</span></>,
        <><Logic>[삼각형.특수한 도형]</Logic><span> 이등변삼각형</span><Mono tone="colon">:</Mono><span>두 변의 길이가 같다</span></>
      ]} note="[삼각형.특수한 도형]() 괄호 사이에서 Enter를 누르면, 두 집합에 모두 든 이등변삼각형만 보여요." />
      <QuestionSamples items={[
        { kind: '기본 관계', q: '‘삼각형.특수한 도형’에서 ‘이등변삼각형’에 이어지는 것은?', a: '두 변의 길이가 같다' },
        { kind: '역방향', q: '‘삼각형.특수한 도형’에서 ‘두 변의 길이가 같다’에 앞서 이어진 것은?', a: '이등변삼각형' }
      ]} />
    </>
  },
  {
    label: '빼고 찾아요', accent: 'teal', symbol: '%', title: '빼고 찾아요',
    lead: '[ ] 안에서 %는 여집합이에요. 집합 이름 앞에 %를 붙이면 그 집합에 들지 않은 셀이에요. [도형.%삼각형]은 도형 중에서 삼각형이 아닌 셀의 자리예요.',
    body: <>
      <NoteSample lines={[
        <><span className="text-indigo-800">▾ </span><span className="font-semibold">도형</span><span className="text-slate-500">  정사각형 · 직각삼각형 · 이등변삼각형</span></>,
        <><span className="text-indigo-800">▾ </span><span className="font-semibold">삼각형</span><span className="text-slate-500">  직각삼각형 · 이등변삼각형</span></>,
        <><Logic>[도형.%삼각형]</Logic><span> 정사각형</span><Mono tone="colon">:</Mono><span>네 변이 같다</span></>
      ]} note="[도형.%삼각형]() 괄호 사이에서 Enter를 누르면, 도형에는 들고 삼각형에는 들지 않은 정사각형만 보여요." />
      <QuestionSamples items={[
        { kind: '기본 관계', q: '‘도형.%삼각형’에서 ‘정사각형’에 이어지는 것은?', a: '네 변이 같다' },
        { kind: '역방향', q: '‘도형.%삼각형’에서 ‘네 변이 같다’에 앞서 이어진 것은?', a: '정사각형' }
      ]} />
    </>
  },
  {
    label: '집합을 글에 넣어요', accent: 'teal', symbol: '{ }', title: '집합을 글에 넣어요',
    lead: '글 속의 {집합 이름}은 그 집합의 원소가 들어갈 자리예요. 사람 집합에 철수와 영희가 있으면, {사람}아 반가워는 원소마다 한 줄씩 있는 것처럼 문제가 나와요.',
    body: <>
      <NoteSample lines={[
        <><span className="text-indigo-800">▾ </span><span className="font-semibold">사람</span><span className="text-slate-500">  철수 · 영희</span></>,
        <><span>인사</span><Mono tone="colon">:</Mono><Logic>{'{사람}'}</Logic><span>아 반가워</span></>
      ]} note="{사람} 자리에 철수와 영희가 차례로 들어가요. 글에 쉼표가 있으면 '{사람}아, 반가워'처럼 따옴표로 묶어요." />
      <QuestionSamples items={[
        { kind: '기본 관계', q: '‘인사’에 이어지는 것은?', a: '철수아 반가워 (영희아 반가워도 따로 나와요)' },
        { kind: '역방향', q: '‘영희아 반가워’에 앞서 이어진 것은?', a: '인사' }
      ]} />
    </>
  },
  {
    label: '한 칸으로 묶어요', accent: 'teal', symbol: "' '", title: '한 칸으로 묶어요',
    lead: "따옴표 안의 글은 한 칸이에요. 안에 쓴 :은 같다(=)처럼, ;와 <는 순서(-)처럼 읽고, 쉼표·-·=는 그냥 글자예요.",
    body: <>
      <NoteSample lines={[
        <><span>주제</span><Mono tone="colon">:</Mono><Mono tone="logic">'</Mono><span>서울</span><Mono tone="logic">:</Mono><span>부산</span><Mono tone="logic">'</Mono></>,
        <><Mono tone="logic">'</Mono><span>3-2</span><Mono tone="logic">'</Mono><Mono tone="colon">:</Mono><span>1</span></>
      ]} />
      <QuestionSamples items={[
        { kind: '같은 칸 안', q: '‘주제’에서 ‘서울’에 대응하는 것은?', a: '부산' },
        { kind: '글자 그대로', q: '‘3-2’에 이어지는 것은?', a: '1' }
      ]} />
    </>
  },
  {
    label: '앞 칸을 다시 써요', accent: 'teal', symbol: '@', title: '앞 칸을 다시 써요',
    lead: '@는 바로 앞 칸의 값이에요. 같은 값을 다시 쓰지 않아도 돼요. [@]는 앞 칸의 집합이에요.',
    body: <>
      <NoteSample lines={[<><span>1 </span><Mono tone="colon">:</Mono><span> </span><Mono tone="logic">@</Mono><span>+1 </span><Mono tone="colon">:</Mono><span> </span><Mono tone="logic">@</Mono><span>+1</span></>]} note="이어 읽으면 1 : 1+1 : 1+1+1이에요." />
      <QuestionSamples items={[
        { kind: '기본 관계', q: '1', a: '1+1' },
        { kind: '역방향', q: '1+1', a: '1' }
      ]} />
    </>
  },
  {
    label: '아무 글이나 대신해요', accent: 'teal', symbol: '#', title: '아무 글이나 대신해요',
    lead: "#는 모든 글을 대신해요. [집합] 뒤 첫 칸에 #를 쓰면, 그 집합 안에서 꼴이 맞는 셀마다 줄이 만들어져요. 따옴표 안의 글은 글자 그대로예요.",
    body: <>
      <NoteSample lines={[
        <><span className="text-indigo-800">▾ </span><span className="font-semibold">A</span></>,
        <><span className="inline-block w-7" /><Mono tone="logic">'</Mono><span>B-C</span><Mono tone="logic">'</Mono></>,
        <><span className="inline-block w-7" /><Mono tone="logic">'</Mono><span>X-Y</span><Mono tone="logic">'</Mono></>,
        <><Mono tone="logic">[A]</Mono><span> </span><Mono tone="logic">#'</Mono><span>-</span><Mono tone="logic">'#</Mono><Mono tone="colon">:</Mono><span> </span><Mono tone="logic">#</Mono><span>+</span><Mono tone="logic">#</Mono></>
      ]} note="B-C와 X-Y가 각각 B+C, X+Y로 이어져요." />
      <QuestionSamples items={[
        { kind: '기본 관계', q: '‘A’에서 ‘B-C’에 이어지는 것은?', a: 'B+C' },
        { kind: '역방향', q: '‘A’에서 ‘X+Y’에 앞서 이어진 것은?', a: 'X-Y' }
      ]} />
    </>
  },
  {
    label: '이어 붙여요', accent: 'sky', symbol: '+', title: '이어 붙여요 · 연결과 첨가',
    lead: '저장하면 새로 쓴 줄이 이전 쪽의 같은 속성 줄과 겹칠 때 자동으로 합쳐져요. 겹치는 칸은 칸 번호(분류기준 위치)가 같아야 해요. 겹치는 칸이 둘 이상이면 새 칸을 뒤에 이어 붙이고(연결), 맨 앞 칸 하나만 겹치면 =로 같은 칸에 붙여요(첨가).',
    body: <>
      <NoteSample label="연결" lines={[
        <><span className="w-20 text-sm font-bold text-slate-500">이전 쪽</span><Logic>[A]</Logic><span> B </span><Mono tone="colon">:</Mono><span> </span><Logic>[D]</Logic><span> C</span></>,
        <><span className="w-20 text-sm font-bold text-slate-500">새 줄</span><Logic>[A]</Logic><span> B </span><Mono tone="colon">:</Mono><span> </span><Logic>[D]</Logic><span> C </span><Mono tone="colon">:</Mono><span> </span><Logic>[K]</Logic><span> L</span></>,
        <><span className="w-20 text-sm font-bold text-indigo-700">합친 뒤</span><Logic>[A]</Logic><span className="font-semibold"> B</span><Mono tone="colon">:</Mono><Logic>[D]</Logic><span className="font-semibold"> C</span><Mono tone="colon">:</Mono><Logic>[K]</Logic><span className="font-semibold"> L</span></>
      ]} />
      <NoteSample label="건너뛰기 · 첨가" lines={[
        <><span className="w-20 text-sm font-bold text-slate-500">이전 쪽</span><Logic>[A]</Logic><span> B </span><Mono tone="colon">:</Mono><span> </span><Logic>[D]</Logic><span> C</span></>,
        <><span className="w-20 text-sm font-bold text-slate-500">새 줄</span><Logic>[A:D]</Logic><span> B </span><Mono tone="colon">::</Mono><span> </span><Logic>[K]</Logic><span> L</span></>,
        <><span className="w-20 text-sm font-bold text-indigo-700">합친 뒤</span><Logic>[A]</Logic><span className="font-semibold"> B</span><Mono tone="colon">:</Mono><Logic>[D]</Logic><span className="font-semibold"> C</span><Mono tone="colon">:</Mono><Logic>[K]</Logic><span className="font-semibold"> L</span></>
      ]} note="::처럼 같은 연결어를 붙여 쓰면 칸 하나를 건너뛰어요. 겹치는 칸은 맨 앞 B 하나라서 첨가예요. 줄 전체를 다 쓰지 않아도, 쓴 칸마다 칸 번호가 같으면 합쳐져요." />
      <NoteSample label="첨가" lines={[
        <><span className="w-20 text-sm font-bold text-slate-500">이전 쪽</span><span>사과</span><Mono tone="colon">:</Mono><span>빨강</span></>,
        <><span className="w-20 text-sm font-bold text-slate-500">새 줄</span><span>사과</span><Mono tone="colon">:</Mono><span>둥글다</span></>,
        <><span className="w-20 text-sm font-bold text-indigo-700">합친 뒤</span><span className="font-semibold">사과</span><Mono tone="colon">:</Mono><span className="font-semibold">빨강</span><Mono tone="logic">=</Mono><span className="font-semibold">둥글다</span></>
      ]} note="새 노트의 글은 그대로이고, 합치기 전 이전 쪽의 글은 되돌릴 수 있게 남아요." />
    </>
  },
  {
    label: '이어 쓸 것을 찾아요', accent: 'teal', symbol: '[?]', title: '이어 쓸 것을 찾아요',
    lead: '[?]는 집합 안에 있지만 아직 :나 ;로 이어 쓰지 않은 셀을 모은 집합이에요. 등호(=)는 이음이 아니라서 =로만 쓴 셀도 들어요.',
    body: <>
      <NoteSample lines={[
        <><span className="text-indigo-800">▾ </span><span className="font-semibold">과일</span></>,
        <><span className="inline-block w-7" /><span>사과</span></>,
        <><span className="inline-block w-7" /><span>배</span><Mono tone="logic">=</Mono><span>pear</span></>,
        <><span className="inline-block w-7" /><span>포도</span><Mono tone="colon">:</Mono><span>보라색</span></>,
        <><Mono tone="logic">[?]</Mono><span>()</span></>
      ]} note="[?]() 괄호 사이에서 Enter를 누르면 사과와 배=pear가 보여요. 포도는 :로 이어 써서 빠져요." />
    </>
  },
  {
    label: '문제에서 빼요', accent: 'amber', symbol: '[!]', title: '문제에서 빼요',
    lead: '[!]를 붙인 줄은 논리적으로 맞지 않는 값이라 문제가 만들어지지 않아요. 복습에서 “논리적 관계에 안 맞아요”로 빼면 그 줄에 저절로 붙고, 줄을 고치면 문제가 다시 나와요.',
    body: <>
      <NoteSample lines={[
        <><Mono tone="logic">[!]</Mono><span> 고래</span><Mono tone="colon">:</Mono><span>물고기</span></>,
        <><span>고래</span><Mono tone="colon">:</Mono><span>포유류</span></>
      ]} note="토글 제목을 !로 쓰면 그 아래 줄이 모두 빠져요." />
      <QuestionSamples items={[
        { kind: '기본 관계', q: '‘고래’에 이어지는 것은?', a: '포유류' },
        { kind: '역방향', q: '‘포유류’에 앞서 이어진 것은?', a: '고래' }
      ]} />
    </>
  }
];

const mono = 'font-mono';

const FLOW_STEPS: TutorialStep[] = [
  {
    label: '타임어택 풀이', accent: 'indigo', symbol: '1', title: '쉬운 것부터 빠르게 풀어요',
    lead: '쉬운 문제를 먼저 빠르게 풀고, 막히면 다음 장으로 넘겨요. 뽀모도로 25분은 예측이고, 얼마나 풀었는지는 장수로 봐요.',
    body: <>
      <div className="flex flex-col gap-4 rounded-2xl border border-indigo-200 bg-indigo-100 px-6 py-5">
        <div className="flex items-end gap-4">
          <div className="flex flex-col"><span className="text-sm font-black text-indigo-900">시작</span><span className={`${mono} text-5xl font-semibold leading-none text-indigo-900`}>p.41</span></div>
          <span aria-hidden="true" className="mb-3 text-3xl font-bold text-indigo-900">→</span>
          <div className="flex flex-col"><span className="text-sm font-black text-indigo-900">현재</span><span className={`${mono} text-7xl font-bold leading-none text-indigo-900`}>p.45</span></div>
        </div>
        <div className="flex gap-2">
          {[41, 42, 43].map(page => <span key={page} className={`${mono} flex h-16 max-w-[84px] flex-1 items-center justify-center rounded-xl border-2 border-indigo-600 bg-indigo-600 text-xl font-bold text-white`}>{page}</span>)}
          <span className={`${mono} flex h-16 max-w-[84px] flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-amber-700 bg-amber-100 text-xl font-bold text-amber-900`}>44<span className="font-sans text-xs font-black">넘김</span></span>
          <span className={`${mono} flex h-16 max-w-[84px] flex-1 items-center justify-center rounded-xl border-[3px] border-indigo-600 bg-white text-xl font-bold text-indigo-900`}>45</span>
          <span className={`${mono} flex h-16 max-w-[84px] flex-1 items-center justify-center rounded-xl border-2 border-indigo-200 bg-white text-xl font-bold text-indigo-900`}>46</span>
        </div>
      </div>
      <Chips items={[
        { text: '쉬운 문제는 빠르게', cls: 'bg-indigo-100 text-indigo-900' },
        { text: '막히면 바로 넘기기', cls: 'bg-amber-100 text-amber-900' },
        { text: '끝 페이지까지 예상 25분 이하', cls: 'bg-[#FDE8E6] text-red-900' }
      ]} />
    </>
  },
  {
    label: '막힌 부분 정리', accent: 'sky', symbol: '2', title: '넘긴 곳을 정리해요',
    lead: '풀이를 끝내면 막혀서 넘긴 부분을 정리노트에 정리해요.',
    body: <>
      <div className="flex flex-wrap items-stretch gap-4">
        <div className="flex basis-[17rem] flex-col gap-2.5 rounded-2xl border border-sky-200 bg-sky-100 px-5 py-5">
          <span className="text-[15px] font-black text-sky-900">막힌 부분 정리</span>
          <span className={`${mono} text-6xl font-semibold leading-none tracking-tight text-sky-900`}>00:48</span>
          <span className="self-start rounded-full bg-white px-3 py-1 text-sm font-black text-green-800">풀이 11:20 완료</span>
        </div>
        <div className="flex min-w-0 flex-1 basis-[18rem] flex-col justify-center rounded-2xl border border-slate-200 px-5 py-3.5 text-lg leading-6" style={GRID_BG}>
          <div>등차수열<Mono tone="colon">:</Mono>연속한 두 항의 차가 일정한 수열</div>
          <div>등비수열<Mono tone="colon">:</Mono>연속한 두 항의 비가 일정한 수열</div>
        </div>
      </div>
      <Chips items={[
        { text: '넘긴 문제를 노트에 정리', cls: 'bg-sky-100 text-sky-900' },
        { text: '이 시간도 기록에 들어가요', cls: 'bg-sky-100 text-sky-900' }
      ]} />
    </>
  },
  {
    label: '세션 메모', accent: 'sky', symbol: '3', title: '오답에 대한 약속을 적어 둬요',
    lead: '학습 방법과 오답을 정리하는 방법을 세션 메모에 적어 두면, 학습할 때마다 참고할 수 있어요.',
    body: <>
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-[22px] py-[18px]">
        <span className="text-[15px] font-black text-indigo-900">세션 메모</span>
        <div className="rounded-xl border border-slate-200 px-4 py-2 text-lg leading-9" style={GRID_BG}>
          <div>오답은 오답노트에 쓴다</div>
          <div>비슷한 문제를 찾아서 푼다</div>
          <div>모르는 문제는 나중에 한 번 더 본다</div>
        </div>
      </div>
      <Chips items={[
        { text: '학습할 때마다 볼 수 있는 노트', cls: 'bg-sky-100 text-sky-900' },
        { text: '오답을 그냥 넘기지 않게', cls: 'bg-sky-100 text-sky-900' }
      ]} />
    </>
  },
  {
    label: '전체 효율', accent: 'indigo', symbol: '4', title: '전체 효율로 성장을 봐요',
    lead: '풀이와 정리 시간을 모두 더해 푼 장수로 나눈 값이에요. 이 값으로 끝 페이지까지의 예상 시간이 25분 이하가 되게 장수를 정해요.',
    body: <>
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-2.5 rounded-2xl border-2 border-indigo-600 bg-indigo-50 px-5 py-4">
          <span className="flex items-center gap-2.5">
            <span className="text-base font-black text-indigo-900">전체 효율</span>
            <span className="rounded-md bg-indigo-600 px-2.5 py-0.5 text-xs font-black text-white">성장 척도</span>
            <span className={`${mono} ml-auto text-3xl font-bold text-indigo-900`}>3.8<span className="ml-1 text-[15px] font-semibold">분/P</span></span>
          </span>
          <div className="flex h-12 overflow-hidden rounded-xl">
            <span className="flex w-[78.9%] items-center bg-indigo-600 pl-3.5 text-base font-black text-white">풀이 3.0</span>
            <span className="flex w-[21.1%] items-center justify-center bg-sky-700 text-base font-black text-white">정리 0.8</span>
          </div>
        </div>
        <div className="flex min-w-[18rem] w-[78.9%] flex-col gap-2 rounded-2xl border border-sky-200 bg-sky-100 px-5 py-3.5">
          <span className="flex items-center justify-between gap-2.5">
            <span className="text-base font-black text-sky-900">타임어택 효율 · 타임어택 한 장당</span>
            <span className={`${mono} text-2xl font-bold text-sky-900`}>3.0<span className="ml-1 text-sm font-semibold">분/P</span></span>
          </span>
          <div className="flex h-9 items-center rounded-xl bg-sky-700 pl-3.5 text-[15px] font-black text-white">타임어택 3.0</div>
        </div>
      </div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-[18px] py-3.5 text-base font-medium leading-relaxed text-amber-900">타임어택 효율만 보면 쉬운 문제만 풀어도 좋아져요. 그래서 정리 시간까지 더한 전체 효율로 성장을 봐요.</div>
    </>
  }
];

export const NoteTutorial: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <TutorialShell title="정리노트 쓰는 법" steps={NOTE_STEPS} finishLabel="정리노트 쓰러 가기" onClose={onClose} />
);

export const MeasurementTutorial: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <TutorialShell title="학습 측정 이렇게 해요" steps={FLOW_STEPS} finishLabel="학습하러 가기" onClose={onClose} />
);
