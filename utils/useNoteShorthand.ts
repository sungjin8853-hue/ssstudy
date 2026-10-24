import { useEffect, useRef, useSyncExternalStore } from 'react';
import { claimNoteShorthand, isNoteShorthandOn, notifyNoteShorthand, releaseNoteShorthand, subscribeNoteShorthand, syncSubjectShorthands } from './noteShorthand';

/** 화면에서 `=`·`-` 단축어가 켜져 있는지 읽고, 바뀌면 다시 그린다. */
export const useNoteShorthand = (): boolean => useSyncExternalStore(subscribeNoteShorthand, isNoteShorthandOn, isNoteShorthandOn);

/**
 * 이 화면이 이 과목의 노트를 본다: 그리는 동안 바로 그 과목의 값으로 읽고(아래 화면들이 같은 값으로 그린다),
 * 화면이 닫히면 그 전에 보던 화면의 과목으로 돌아간다(정리노트 서랍을 닫으면 학습 화면의 과목). 지금 값을 돌려준다.
 */
export const useSubjectNoteShorthand = (subjectId: string | null | undefined): boolean => {
  const token = useRef<object | null>(null);
  if (!token.current) token.current = {};
  claimNoteShorthand(token.current, subjectId);
  useEffect(() => {
    const own = token.current!;
    // 그리는 동안 이미 바꿔 두었으므로, 먼저 그려진 다른 화면들이 다시 읽도록 늘 알린다(값이 같으면 다시 그리지 않는다)
    claimNoteShorthand(own, subjectId);
    notifyNoteShorthand();
  }, [subjectId]);
  useEffect(() => {
    const own = token.current!;
    return () => { if (releaseNoteShorthand(own)) notifyNoteShorthand(); };
  }, []);
  return useNoteShorthand();
};

/** 앱이 과목 목록을 그릴 때 과목마다의 설정을 읽어 둔다 */
export const useSubjectShorthandSync = (subjects: ReadonlyArray<{ id: string; noteShorthand?: boolean }>) => {
  syncSubjectShorthands(subjects);
  useEffect(() => { notifyNoteShorthand(); }, [subjects]);
};
