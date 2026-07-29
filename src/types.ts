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

export interface StorageLayoutCacheAdapter {
  get(key: string): Promise<VerifiedStorageLayout | null | undefined>;
  set(
    key: string,
    value: VerifiedStorageLayout,
    ttlSeconds: number
  ): Promise<void>;
}

export interface StorageLayoutCacheOptions {
  cache?: StorageLayoutCacheAdapter;
  chainId?: number;
  cacheTtlSeconds?: number;
  cacheTimeoutMs?: number;
}
