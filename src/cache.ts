import { CacheMapType } from './types';

// check every minute
const CACHE_INTERVAL = 60 * 1000;

export const approvalCache: CacheMapType = new Map();
export const balanceCache: CacheMapType = new Map();


const clearCacheJob = (type: 'balance' | 'approval') => {
  // 1mb per map
  const totalMaxSize = 1_000_000

  const cache = type === 'balance' ? balanceCache : approvalCache;
  let cacheSize = getMapSizeInBytes(cache);

  const diff = cacheSize - totalMaxSize;
  if (diff < 0) return;


  // Convert to array and sort in one pass
  const sortedEntries = Array.from(cache.entries())
    .sort((a, b) => a[1].ts - b[1].ts);

  let index = 0;
  while (cacheSize > totalMaxSize && index < sortedEntries.length) {
    const [key, value] = sortedEntries[index];
    const entrySize = getObjectSize(key) + getObjectSize(value);
    cache.delete(key);
    cacheSize -= entrySize;
    index++;
  }
}

const getMapSizeInBytes = (map: CacheMapType) => {
  let totalSize = 0;

  for (const [key, value] of map) {
    totalSize += getObjectSize(key);
    totalSize += getObjectSize(value);
  }

  // Add overhead for the Map structure itself
  totalSize += 8 * map.size; // Assuming 8 bytes per entry for internal structure

  return totalSize;
}

const getObjectSize = (obj: any) => {
  const type = typeof obj;
  switch (type) {
    case 'number':
      return 8;
    case 'string':
      return obj.length * 2;
    case 'boolean':
      return 4;
    case 'object':
      if (obj === null) {
        return 0;
      }
      let size = 0;
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          size += getObjectSize(key);
          size += getObjectSize(obj[key]);
        }
      }
      return size;
    default:
      return 0;
  }
}

setInterval(clearCacheJob, CACHE_INTERVAL);
