export interface CacheData {
  // Slot #
  slot: number;
  // if contract is vyper
  isVyper: boolean;
  // Timestamp added (for cleaning purposes)
  ts: number;
}
export type CacheMapType = Map<string, CacheData>;


