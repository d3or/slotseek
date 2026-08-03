import { ethers } from "ethers";
import {
  CacheMapType,
  NegativeLayoutReason,
  NegativeStorageLayout,
  StorageLayoutCacheEventType,
  StorageLayoutCacheOptions,
  StorageLayoutKind,
  StoredStorageLayout,
  VerifiedStorageLayout,
} from "./types";

// check every minute
const CACHE_INTERVAL = 60 * 1000;
export const DEFAULT_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const DEFAULT_NEGATIVE_CACHE_TTL_SECONDS = 15 * 60;
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
    kind,
    chainId,
    tokenAddress,
    ttlSeconds,
    negativeTtlSeconds:
      options.negativeCacheTtlSeconds ?? DEFAULT_NEGATIVE_CACHE_TTL_SECONDS,
    timeoutMs: options.cacheTimeoutMs ?? DEFAULT_CACHE_TIMEOUT_MS,
    key: getStorageLayoutCacheKey(kind, chainId, tokenAddress),
  };
};

export type StorageLayoutCacheContext = Awaited<
  ReturnType<typeof resolveCacheContext>
>;

export const emitCacheEvent = (
  options: StorageLayoutCacheOptions,
  context: StorageLayoutCacheContext,
  type: StorageLayoutCacheEventType,
  reason?: NegativeLayoutReason
) => {
  if (!options.onCacheEvent) return;
  try {
    const result = options.onCacheEvent({
      type,
      kind: context.kind,
      chainId: context.chainId,
      tokenAddress: context.tokenAddress,
      reason,
    });
    // An async callback that rejects must not surface as an unhandled rejection.
    void Promise.resolve(result).catch(() => {});
  } catch {
    // Observability must never affect slot discovery.
  }
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

const NEGATIVE_LAYOUT_REASONS: NegativeLayoutReason[] = [
  "zero-allowance",
  "no-balance",
  "not-found",
];

// Structural check only; use isFreshNegativeStorageLayout for cached values.
export const isNegativeStorageLayout = (
  value: unknown
): value is NegativeStorageLayout => {
  if (!value || typeof value !== "object") return false;
  const marker = value as NegativeStorageLayout;
  return marker.status === "unverifiable" &&
    NEGATIVE_LAYOUT_REASONS.includes(marker.reason) &&
    typeof marker.failedAt === "number" && Number.isFinite(marker.failedAt);
};

export const isFreshNegativeStorageLayout = (
  value: unknown,
  negativeTtlSeconds: number
): value is NegativeStorageLayout => {
  if (!isNegativeStorageLayout(value)) return false;
  // Honor the writer's absolute expiry when present so a marker written with a
  // short TTL is never extended by a reader configured with a longer one.
  const expiresAt = Math.min(
    typeof value.expiresAt === "number" ? value.expiresAt : Infinity,
    value.failedAt + negativeTtlSeconds * 1000
  );
  return value.failedAt <= Date.now() && Date.now() < expiresAt;
};

export const getExternalLayout = async (
  options: StorageLayoutCacheOptions,
  context: StorageLayoutCacheContext
): Promise<StoredStorageLayout | undefined> => {
  if (!options.cache) return undefined;
  try {
    const value = await withDeadline(
      options.cache.get(context.key),
      context.timeoutMs
    );
    if (isVerifiedStorageLayout(value, context.ttlSeconds)) return value;
    if (isFreshNegativeStorageLayout(value, context.negativeTtlSeconds)) {
      return value;
    }
    return undefined;
  } catch {
    emitCacheEvent(options, context, "cache_error");
    return undefined;
  }
};

export const setExternalLayout = async (
  options: StorageLayoutCacheOptions,
  context: StorageLayoutCacheContext,
  value: StoredStorageLayout,
  ttlSeconds: number
) => {
  if (!options.cache) return;
  try {
    await withDeadline(
      options.cache.set(context.key, value, ttlSeconds),
      context.timeoutMs
    );
  } catch {
    // Application cache failures must never affect slot discovery.
    emitCacheEvent(options, context, "cache_error");
  }
};

export const getLocalLayout = (
  cache: CacheMapType,
  key: string,
  ttlSeconds: number,
  negativeTtlSeconds: number = DEFAULT_NEGATIVE_CACHE_TTL_SECONDS
): StoredStorageLayout | undefined => {
  const value = cache.get(key);
  if (!value) return undefined;
  if ("negative" in value) {
    const expiresAt = Math.min(
      value.expiresAt,
      value.ts + negativeTtlSeconds * 1000
    );
    if (Date.now() >= expiresAt) {
      cache.delete(key);
      return undefined;
    }
    return {
      status: "unverifiable",
      reason: value.reason,
      failedAt: value.ts,
      expiresAt: value.expiresAt,
      maxSlots: value.maxSlots,
    };
  }
  const callerExpiresAt = value.ts + ttlSeconds * 1000;
  const expiresAt = value.expiresAt
    ? Math.min(value.expiresAt, callerExpiresAt)
    : callerExpiresAt;
  if (Date.now() >= expiresAt) {
    cache.delete(key);
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

export const setLocalNegative = (
  cache: CacheMapType,
  key: string,
  value: NegativeStorageLayout,
  negativeTtlSeconds: number
) => cache.set(key, {
  negative: true,
  reason: value.reason,
  ts: value.failedAt,
  expiresAt: Math.min(
    typeof value.expiresAt === "number" ? value.expiresAt : Infinity,
    value.failedAt + negativeTtlSeconds * 1000
  ),
  maxSlots: value.maxSlots,
});

const discoveryPromises = new Map<string, Promise<StoredStorageLayout | undefined>>();

export const runVerifiedDiscovery = async (
  key: string,
  discover: () => Promise<StoredStorageLayout | undefined>
): Promise<StoredStorageLayout | undefined> => {
  const existing = discoveryPromises.get(key);
  if (existing) {
    // Share the leader's outcome - including negative ("unverifiable") markers
    // and rejections - so concurrent callers never re-run the probe brute force
    // and identical requests observe identical results.
    return existing;
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
