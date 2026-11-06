/**
 * 6일: 글을 클립보드에 복사한다. 클립보드 API가 막힌 곳(오래된 Safari · http)에서는 숨긴 글상자를 골라 복사한다.
 * 복사했으면 true.
 */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 아래 방법으로 */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    const done = document.execCommand('copy');
    area.remove();
    return done;
  } catch {
    return false;
  }
};
