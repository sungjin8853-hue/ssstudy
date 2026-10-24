/** 같은 줄 구분 `/`는 두 번 쓴 `//`일 때만 구분이다. 한 번만 쓴 `/`(km/h, 및/또는)는 그냥 글자다. */
export const isReviewSlash = (text: string, index: number): boolean => (
  text[index] === '/' && (text[index - 1] === '/' || text[index + 1] === '/')
);
