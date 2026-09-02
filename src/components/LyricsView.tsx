import { useEffect, useRef, useMemo } from 'react';
import { useAppStore } from '../store/appStore';
import { findCurrentLine } from '../services/lyrics';

export default function LyricsView() {
  const lyrics = useAppStore(s => s.lyrics);
  const currentTime = useAppStore(s => s.currentTime);
  const setCurrentLyricIndex = useAppStore(s => s.setCurrentLyricIndex);
  const scrollRef = useRef<HTMLDivElement>(null);

  const currentIndex = useMemo(
    () => findCurrentLine(lyrics, currentTime),
    [lyrics, currentTime],
  );

  useEffect(() => {
    setCurrentLyricIndex(currentIndex);
    if (scrollRef.current && currentIndex >= 0) {
      const el = scrollRef.current.children[currentIndex] as HTMLElement | undefined;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentIndex, setCurrentLyricIndex]);

  if (lyrics.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-slate-600 text-sm">
        暂无歌词
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto py-8 px-4">
      {lyrics.map((line, i) => {
        const isCurrent = i === currentIndex;
        const isPast = i < currentIndex;
        return (
          <div
            key={i}
            className={`py-2.5 px-4 transition-all duration-300 rounded-lg ${
              isCurrent ? 'text-indigo-300 text-xl font-medium scale-105' :
              isPast ? 'text-slate-500 text-base' :
              'text-slate-600 text-base'
            }`}
            style={{ opacity: isCurrent ? 1 : isPast ? 0.5 : 0.3 }}
          >
            {line.text}
          </div>
        );
      })}
    </div>
  );
}
