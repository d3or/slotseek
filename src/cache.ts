import { ethers } from "ethers";
import {
  CacheMapType,
  StorageLayoutCacheOptions,
  StorageLayoutKind,
  VerifiedStorageLayout,
} from "./types";

// check every minute
const CACHE_INTERVAL = 60 * 1000;
export const DEFAULT_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const DEFAULT_CACHE_TIMEOUT_MS = 200;
const CACHE_KEY_VERSION = "v1";

export const approvalCache: CacheMapType = new Map();
export const balanceCache: CacheMapType = new Map();

export const getStorageLayoutCacheKey = (
  kind: StorageLayoutKind,
  chainId: number,
  tokenAddress: string
) => `slotseek:${CACHE_KEY_VERSION}:${kind}:${chainId}:${tokenAddress.toLowerCase()}`;

export const resolveCacheContext = async (
  provider: ethers.providers.JsonRpcProvider,
  kind: StorageLayoutKind,
  tokenAddress: string,
  options: StorageLayoutCacheOptions = {}
) => {
  const chainId = options.chainId ?? (await provider.getNetwork()).chainId;
  const ttlSeconds = options.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS;
  return {
    chainId,
    ttlSeconds,
    timeoutMs: options.cacheTimeoutMs ?? DEFAULT_CACHE_TIMEOUT_MS,
    key: getStorageLayoutCacheKey(kind, chainId, tokenAddress),
  };
};

const withDeadline = async <T>(operation: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Cache operation timed out")), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer!);
  }
};

export const isVerifiedStorageLayout = (
  value: unknown,
  ttlSeconds: number
): value is VerifiedStorageLayout => {
  if (!value || typeof value !== "object") return false;
  const layout = value as VerifiedStorageLayout;
  return Number.isInteger(layout.slot) && layout.slot >= 0 &&
    typeof layout.isVyper === "boolean" &&
    typeof layout.verifiedAt === "number" && Number.isFinite(layout.verifiedAt) &&
    layout.verifiedAt <= Date.now() &&
    Date.now() - layout.verifiedAt < ttlSeconds * 1000;
};

export const getExternalLayout = async (
  options: StorageLayoutCacheOptions,
  key: string,
  ttlSeconds: number,
  timeoutMs: number
): Promise<VerifiedStorageLayout | undefined> => {
  if (!options.cache) return undefined;
  try {
    const value = await withDeadline(options.cache.get(key), timeoutMs);
    return isVerifiedStorageLayout(value, ttlSeconds) ? value : undefined;
  } catch {
    return undefined;
  }
};

export const setExternalLayout = async (
  options: StorageLayoutCacheOptions,
  key: string,
  value: VerifiedStorageLayout,
  ttlSeconds: number,
  timeoutMs: number
) => {
  if (!options.cache) return;
  try {
    await withDeadline(options.cache.set(key, value, ttlSeconds), timeoutMs);
  } catch {
    // Application cache failures must never affect slot discovery.
  }
};

export const getLocalLayout = (
  cache: CacheMapType,
  key: string,
  ttlSeconds: number
): VerifiedStorageLayout | undefined => {
  const value = cache.get(key);
  const callerExpiresAt = value ? value.ts + ttlSeconds * 1000 : 0;
  const expiresAt = value?.expiresAt
    ? Math.min(value.expiresAt, callerExpiresAt)
    : callerExpiresAt;
  if (!value || Date.now() >= expiresAt) {
    if (value) cache.delete(key);
    return undefined;
  }
  return { slot: value.slot, isVyper: value.isVyper, verifiedAt: value.ts };
};

export const setLocalLayout = (
  cache: CacheMapType,
  key: string,
  value: VerifiedStorageLayout,
  ttlSeconds: number
) => cache.set(key, {
  slot: value.slot,
  isVyper: value.isVyper,
  ts: value.verifiedAt,
  expiresAt: value.verifiedAt + ttlSeconds * 1000,
});

const discoveryPromises = new Map<string, Promise<VerifiedStorageLayout | undefined>>();

export const runVerifiedDiscovery = async (
  key: string,
  discover: () => Promise<VerifiedStorageLayout | undefined>
) => {
  const existing = discoveryPromises.get(key);
  if (existing) {
    try {
      const shared = await existing;
      if (shared) return shared;
    } catch {
      // Only successful, verified discoveries are safe to share.
    }
    return discover();
  }
  const pending = discover().finally(() => discoveryPromises.delete(key));
  discoveryPromises.set(key, pending);
  return pending;
};

let activeStorageProbes = 0;
const storageProbeWaiters: Array<() => void> = [];

const acquireStorageProbe = async () => {
  if (activeStorageProbes < 8 && storageProbeWaiters.length === 0) {
    activeStorageProbes++;
    return;
  }
  await new Promise<void>((resolve) => storageProbeWaiters.push(resolve));
};

const releaseStorageProbe = () => {
  const next = storageProbeWaiters.shift();
  if (next) {
    next();
  } else {
    activeStorageProbes--;
  }
};

export const getStorageAtLimited = async (
  provider: ethers.providers.JsonRpcProvider,
  address: string,
  position: string
) => {
  await acquireStorageProbe();
  try {
    return await provider.getStorageAt(address, position);
  } finally {
    releaseStorageProbe();
  }
};


const clearCacheJob = (type: 'balance' | 'approval') => {
  // 1mb per map
  const totalMaxSize = 1_000_000

  const cache = type === 'balance' ? balanceCache : approvalCache;
  let cacheSize = getMapSizeInBytes(cache);

  const now = Date.now();
  for (const [key, value] of cache) {
    const expiresAt = value.expiresAt ?? value.ts + DEFAULT_CACHE_TTL_SECONDS * 1000;
    if (now >= expiresAt) cache.delete(key);
  }
  cacheSize = getMapSizeInBytes(cache);
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

const clearCacheInterval = setInterval(() => {
  clearCacheJob("balance");
  clearCacheJob("approval");
}, CACHE_INTERVAL);
clearCacheInterval.unref?.();
