import { approvalCache, balanceCache } from './cache';
import {
  DEFAULT_NEGATIVE_CACHE_TTL_SECONDS,
  getStorageLayoutCacheKey,
  isNegativeStorageLayout,
} from "./cache";
import {
  NegativeLayoutReason,
  NegativeStorageLayout,
  StorageLayoutCacheAdapter,
  StorageLayoutCacheEvent,
  StorageLayoutCacheEventType,
  StorageLayoutCacheOptions,
  StorageLayoutKind,
  StoredStorageLayout,
  VerifiedStorageLayout,
} from "./types";
import {
  generateMockApprovalData,
  getErc20Approval,
  getErc20ApprovalStorageSlot,
} from "./approval";
import {
  generateMockBalanceData,
  getErc20Balance,
  getErc20BalanceStorageSlot,
} from "./balance";

import { computePermit2AllowanceStorageSlot, getPermit2ERC20Allowance } from "./permit2"

export {
  approvalCache,
  balanceCache,
  generateMockApprovalData,
  generateMockBalanceData,
  getErc20ApprovalStorageSlot,
  getErc20BalanceStorageSlot,
  getErc20Approval,
  getErc20Balance,
  getPermit2ERC20Allowance,
  computePermit2AllowanceStorageSlot
};

export {
  DEFAULT_NEGATIVE_CACHE_TTL_SECONDS,
  getStorageLayoutCacheKey,
  isNegativeStorageLayout,
  NegativeLayoutReason,
  NegativeStorageLayout,
  StorageLayoutCacheAdapter,
  StorageLayoutCacheEvent,
  StorageLayoutCacheEventType,
  StorageLayoutCacheOptions,
  StorageLayoutKind,
  StoredStorageLayout,
  VerifiedStorageLayout,
};
