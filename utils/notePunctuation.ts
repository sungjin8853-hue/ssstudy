/**
 * 전각으로 들어온 기호를 노트 기호로 바꾼다(한글 입력기가 `：` `；` `，` `（ ）`를 내는 일이 잦다).
 * 글자 수가 같아서 커서 위치와 글자 범위가 바뀌지 않는다. 편집기가 글을 받을 때 쓴다.
 */
const FULLWIDTH: Record<string, string> = {
  '：': ':', '；': ';', '，': ',', '（': '(', '）': ')', '［': '[', '］': ']', '｛': '{', '｝': '}',
  '＝': '=', '＜': '<', '＞': '>', '＠': '@', '＃': '#', '％': '%', '＇': "'", '／': '/'
};
const PATTERN = new RegExp(`[${Object.keys(FULLWIDTH).join('')}]`, 'g');

export const normalizeNotePunctuation = (text: string): string => (PATTERN.test(text) ? text.replace(PATTERN, match => FULLWIDTH[match]) : text);
