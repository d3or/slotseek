export interface CacheData {
  // Slot #
  slot: number;
  // if contract is vyper
  isVyper: boolean;
  // Timestamp added (for cleaning purposes)
  ts: number;
  // Timestamp after which the entry must not be reused
  expiresAt?: number;
}
export interface NegativeCacheData {
  negative: true;
  reason: NegativeLayoutReason;
  // Timestamp the discovery failed (for cleaning purposes)
  ts: number;
  // Timestamp after which the entry must not be reused
  expiresAt: number;
  // Probe budget the failed search used (only for "not-found")
  maxSlots?: number;
}
export type CacheMapType = Map<string, CacheData | NegativeCacheData>;

export type StorageLayoutKind = "balance" | "approval";

export interface VerifiedStorageLayout {
  slot: number;
  isVyper: boolean;
  verifiedAt: number;
}

// Why layout discovery could not verify a storage layout.
// - "zero-allowance": the owner has no allowance to the spender, so no value exists to probe for
// - "no-balance": the holder has a zero balance, so no value exists to probe for
// - "not-found": a nonzero reference value existed but no probed slot matched it
export type NegativeLayoutReason = "zero-allowance" | "no-balance" | "not-found";

export interface NegativeStorageLayout {
  status: "unverifiable";
  reason: NegativeLayoutReason;
  failedAt: number;
  // Absolute expiry set by the writer; readers honor the minimum of this and
  // their own negativeCacheTtlSeconds so a marker never outlives its writer's TTL.
  expiresAt?: number;
  // Probe budget the failed search used. A "not-found" marker written with a
  // smaller budget is ignored by callers searching more slots.
  maxSlots?: number;
}

export type StoredStorageLayout = VerifiedStorageLayout | NegativeStorageLayout;

export interface StorageLayoutCacheAdapter {
  get(key: string): Promise<StoredStorageLayout | null | undefined>;
  set(
    key: string,
    value: StoredStorageLayout,
    ttlSeconds: number
  ): Promise<void>;
}

export type StorageLayoutCacheEventType =
  | "local_hit"
  | "external_hit"
  | "negative_hit"
  | "verified"
  | "discovery_failed"
  | "cache_error";

export interface StorageLayoutCacheEvent {
  type: StorageLayoutCacheEventType;
  kind: StorageLayoutKind;
  chainId: number;
  tokenAddress: string;
  reason?: NegativeLayoutReason;
}

export interface StorageLayoutCacheOptions {
  cache?: StorageLayoutCacheAdapter;
  chainId?: number;
  cacheTtlSeconds?: number;
  cacheTimeoutMs?: number;
  // TTL for cached negative ("unverifiable") discovery outcomes. Kept short so
  // a token that becomes verifiable (e.g. a funded holder shows up) is retried soon.
  negativeCacheTtlSeconds?: number;
  // Fire-and-forget observability hook; exceptions and rejections are swallowed.
  onCacheEvent?: (event: StorageLayoutCacheEvent) => void | Promise<void>;
}
