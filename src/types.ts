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
export type CacheMapType = Map<string, CacheData>;

export type StorageLayoutKind = "balance" | "approval";

export interface VerifiedStorageLayout {
  slot: number;
  isVyper: boolean;
  verifiedAt: number;
}

export interface MissingStorageLayout {
  missingAt: number;
  maxSlots: number;
}

export type StorageLayoutCacheValue = VerifiedStorageLayout | MissingStorageLayout;

export interface StorageLayoutCacheAdapter {
  get(key: string): Promise<StorageLayoutCacheValue | null | undefined>;
  set(
    key: string,
    value: StorageLayoutCacheValue,
    ttlSeconds: number
  ): Promise<void>;
}

export interface StorageLayoutCacheOptions {
  cache?: StorageLayoutCacheAdapter;
  chainId?: number;
  cacheTtlSeconds?: number;
  negativeCacheTtlSeconds?: number;
  cacheTimeoutMs?: number;
}
