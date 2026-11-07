import React from 'react';

const KEYWORD = /\{([^{}\n]+)\}/g;

/**
 * 7일: 노트 칸 글 안의 `{X}`는 키워드(부가조건 · 세부 위치이면서 값)다. 문제에서는 중괄호를 빼고 X를 강조해 보인다.
 * 예: `{염기}와 {물}` → **염기**와 **물**
 */
export const KeywordText: React.FC<{ text: string }> = ({ text }) => {
  if (!text.includes('{')) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(KEYWORD)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(<span key={at} data-keyword="true" className="font-black text-indigo-700 underline decoration-indigo-300 decoration-2 underline-offset-4">{match[1].trim()}</span>);
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
};

/** 글로만 쓸 때(복사 · 접근성 이름): 중괄호만 뺀다 */
export const keywordPlain = (text: string) => text.replace(KEYWORD, (_, word: string) => word.trim());
