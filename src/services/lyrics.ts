export interface LyricLine {
  start: number; // seconds
  text: string;
}

/**
 * 解析 LRC 歌词文本，返回按时间排序的歌词行。
 */
export function parseLRC(lrcText: string): { lines: LyricLine[] } {
  const lines: LyricLine[] = [];
  if (!lrcText) return { lines };

  lrcText.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // 支持 [mm:ss.xx] 或 [mm:ss.xxx]
    const matches = trimmed.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/g);
    if (matches) {
      const text = trimmed.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '').trim();
      matches.forEach(match => {
        const m = match.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\]/);
        if (!m) return;
        const minutes = parseInt(m[1], 10);
        const seconds = parseInt(m[2], 10);
        let millis = parseInt(m[3], 10);
        if (m[3].length === 2) millis *= 10; // 两位毫秒转换为三位
        const start = minutes * 60 + seconds + millis / 1000;
        lines.push({ start, text });
      });
    }
  });

  lines.sort((a, b) => a.start - b.start);
  return { lines };
}

/**
 * 查找当前时间对应的歌词行索引。
 */
export function findCurrentLine(lyrics: LyricLine[], currentTime: number): number {
  if (!lyrics.length) return -1;
  let low = 0;
  let high = lyrics.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lyrics[mid].start <= currentTime) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return high;
}

export interface LRCSearchResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
  isSynced: boolean;
}

const LRC_API_BASE = 'https://lrclib.net/api';
const USER_AGENT = 'KaraokeWeb/1.0';

/**
 * 从 lrclib.net 搜索歌词。
 * 参考老项目 karaoke-app 歌词下载逻辑。
 */
export async function searchLyrics(query: string): Promise<LRCSearchResult[]> {
  if (!query.trim()) return [];
  const q = encodeURIComponent(query.trim());
  const url = `${LRC_API_BASE}/search?q=${q}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': USER_AGENT,
    },
  });
  if (!res.ok) {
    throw new Error(`搜索歌词失败: ${res.status} ${res.statusText}`);
  }
  const items = await res.json() as any[];
  return items.map(item => ({
    id: item.id,
    trackName: item.trackName || '',
    artistName: item.artistName || '',
    albumName: item.albumName || '',
    duration: item.duration || 0,
    instrumental: !!item.instrumental,
    plainLyrics: item.plainLyrics || null,
    syncedLyrics: item.syncedLyrics || null,
    isSynced: !!item.syncedLyrics,
  }));
}

/**
 * 用歌曲名 + 歌手搜索，优先选择时长最接近的同步歌词。
 */
export async function searchLyricsBest(
  name: string,
  artist: string,
  duration?: number,
): Promise<LRCSearchResult | null> {
  const query = artist ? `${name} ${artist}` : name;
  const results = await searchLyrics(query);
  if (!results.length) return null;
  const synced = results.filter(r => r.isSynced && !r.instrumental);
  const candidates = synced.length ? synced : results.filter(r => !r.instrumental);
  if (!candidates.length) return results[0];
  if (duration && duration > 0) {
    candidates.sort((a, b) => Math.abs(a.duration - duration) - Math.abs(b.duration - duration));
  }
  return candidates[0];
}

/**
 * 下载歌词文本。优先同步歌词，其次纯文本，最后空字符串。
 */
export function downloadLyrics(result: LRCSearchResult): string {
  return result.syncedLyrics || result.plainLyrics || '';
}
