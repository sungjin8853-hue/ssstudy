/**
 * 과목마다 "페이지"를 부르는 글자를 정할 수 있다. 기본은 P(위치는 p.). 예를 들어 n으로 바꾸면 화면의 P/h는 n/h, 분/P는 분/n,
 * 7P는 7n, p.31은 n.31이 된다. "회"나 "단원"처럼 한글도 된다.
 */
export const DEFAULT_PAGE_LABEL = 'P';
export const MAX_PAGE_LABEL_LENGTH = 6;

export const normalizePageLabel = (value?: string | null) => {
  const text = (value ?? '').replace(/\s+/g, '').slice(0, MAX_PAGE_LABEL_LENGTH);
  return text || DEFAULT_PAGE_LABEL;
};

export const getPageLabel = (subject?: { pageLabel?: string } | null) => normalizePageLabel(subject?.pageLabel);

/** 위치("p.31")에 쓰는 글자: 기본은 소문자 p, 직접 정한 글자는 그대로 */
export const pagePositionLabel = (label: string) => (label === DEFAULT_PAGE_LABEL ? 'p' : label);

/** "페이지당", "푸는 페이지"처럼 낱말로 쓰는 자리: 기본이면 페이지, 직접 정한 글자면 그 글자 */
export const pageWord = (label: string) => (label === DEFAULT_PAGE_LABEL ? '페이지' : label);
