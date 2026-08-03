import { ethers } from "ethers";
import {
  balanceCache,
  emitCacheEvent,
  getExternalLayout,
  getLocalLayout,
  getStorageAtLimited,
  isNegativeStorageLayout,
  resolveCacheContext,
  runVerifiedDiscovery,
  setExternalLayout,
  setLocalLayout,
  setLocalNegative,
} from "./cache";
import {
  NegativeStorageLayout,
  StorageLayoutCacheOptions,
  StoredStorageLayout,
  VerifiedStorageLayout,
} from "./types";

/**
 * Generate mock data for a given ERC20 token balance
 * @param provider - The JsonRpcProvider instance
 * @param tokenAddress - The address of the ERC20 token
 * @param holderAddress - The address of the holder, used to find the balance slot
 * @param mockAddress - The user address to mock the balance for
 * @param mockBalance - The balance to mock the balance for, if not provided, defaults to the balance of the holder
 * @param maxSlots - The maximum number of slots to search
 * @returns An object containing the slot and balance
 *
 */
export const generateMockBalanceData = async (
  provider: ethers.providers.JsonRpcProvider,
  {
    tokenAddress,
    holderAddress,
    mockAddress,
    mockBalanceAmount,
    maxSlots = 30,
    ...cacheOptions
  }: {
    tokenAddress: string;
    holderAddress: string;
    mockAddress: string;
    mockBalanceAmount?: string;
    maxSlots?: number;
  } & StorageLayoutCacheOptions
): Promise<{
  slot: string;
  balance: string;
  isVyper: boolean;
}> => {
  // get the slot for token balance mapping: mapping(address => uint256)
  const { slot, balance, isVyper } = await getErc20BalanceStorageSlot(
    provider,
    tokenAddress,
    holderAddress,
    maxSlots,
    cacheOptions
  );

  // make sure its padded to 32 bytes, and convert to a BigNumber
  const mockBalanceHex = ethers.utils.hexZeroPad(
    ethers.utils.hexlify(
      mockBalanceAmount ? ethers.BigNumber.from(mockBalanceAmount) : balance
    ),
    32
  );

  // Calculate the storage slot key
  let index;
  if (!isVyper) {
    index = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [mockAddress, slot]
      )
    );
  } else {
    // if vyper, we need to use the keccak256(abi.encode(slot, address(this))) instead of keccak256(abi.encode(address(this), slot))
    index = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["uint256", "address"],
        [slot, mockAddress]
      )
    );
  }

  return {
    slot: index,
    balance: mockBalanceHex,
    isVyper,
  };
};

/**
 * Get the storage slot for a given ERC20 token balance
 * @param provider - The JsonRpcProvider instance
 * @param erc20Address - The address of the ERC20 token
 * @param holderAddress - The address of the holder, used to find the balance slot
 * @param maxSlots - The maximum number of slots to search
 * @returns An object containing the slot and balance
 *
 * - This uses a brute force approach to find the storage slot for the balance of the holder, so we can mock it. There are better ways to do this outside of just interacting directly with the contract over RPC, but its difficult to do so without needing to setup more tools/infra, especially for multi chain supoprt and gas estimation at runtime.
 */
export const getErc20BalanceStorageSlot = async (
  provider: ethers.providers.JsonRpcProvider,
  erc20Address: string,
  holderAddress: string,
  maxSlots = 30,
  options: StorageLayoutCacheOptions = {}
): Promise<{
  slot: string;
  balance: ethers.BigNumber;
  isVyper: boolean;
}> => {
  const context = await resolveCacheContext(provider, "balance", erc20Address, options);
  let entry: StoredStorageLayout | undefined =
    getLocalLayout(balanceCache, context.key, context.ttlSeconds, context.negativeTtlSeconds);
  if (entry) {
    emitCacheEvent(
      options,
      context,
      isNegativeStorageLayout(entry) ? "negative_hit" : "local_hit",
      isNegativeStorageLayout(entry) ? entry.reason : undefined
    );
  }
  if (!entry) {
    entry = await getExternalLayout(options, context);
    if (entry) {
      if (isNegativeStorageLayout(entry)) {
        setLocalNegative(balanceCache, context.key, entry, context.negativeTtlSeconds);
        emitCacheEvent(options, context, "negative_hit", entry.reason);
      } else {
        setLocalLayout(balanceCache, context.key, entry, context.ttlSeconds);
        emitCacheEvent(options, context, "external_hit");
      }
    }
  }

  if (
    entry &&
    isNegativeStorageLayout(entry) &&
    entry.reason === "not-found" &&
    (entry.maxSlots ?? 0) < maxSlots
  ) {
    // The failed search used a smaller probe budget than this caller; retry.
    entry = undefined;
  }

  let discoveredBalance: ethers.BigNumber | undefined;
  if (!entry) {
    // Scope in-flight sharing by holder and probe budget: a zero-balance
    // outcome is holder-specific and must not leak to other holders.
    const discoveryKey = `${context.key}:${holderAddress.toLowerCase()}:${maxSlots}`;
    entry = await runVerifiedDiscovery(discoveryKey, async () => {
      const userBalance = await getErc20Balance(provider, erc20Address, holderAddress);
      if (userBalance.eq(0)) {
        // Holder-specific: a funded holder may verify this token at any time,
        // so this outcome is shared with concurrent same-holder callers but never cached.
        emitCacheEvent(options, context, "discovery_failed", "no-balance");
        const marker: NegativeStorageLayout = {
          status: "unverifiable", reason: "no-balance", failedAt: Date.now(),
        };
        return marker;
      }
      const { found, incomplete } = await discoverBalanceLayout(
        provider, erc20Address, holderAddress, userBalance, maxSlots
      );
      if (!found) {
        if (incomplete) {
          // Some probes failed (rate limit, provider error); the matching slot
          // may be among them. Do not poison the negative cache.
          return undefined;
        }
        const failedAt = Date.now();
        const marker: NegativeStorageLayout = {
          status: "unverifiable",
          reason: "not-found",
          failedAt,
          expiresAt: failedAt + context.negativeTtlSeconds * 1000,
          maxSlots,
        };
        setLocalNegative(balanceCache, context.key, marker, context.negativeTtlSeconds);
        await setExternalLayout(options, context, marker, context.negativeTtlSeconds);
        emitCacheEvent(options, context, "discovery_failed", "not-found");
        return marker;
      }
      discoveredBalance = found.balance;
      setLocalLayout(balanceCache, context.key, found.layout, context.ttlSeconds);
      await setExternalLayout(options, context, found.layout, context.ttlSeconds);
      emitCacheEvent(options, context, "verified");
      return found.layout;
    });
  }

  if (!entry) throw new Error("Unable to find balance slot");
  if (isNegativeStorageLayout(entry)) {
    throw new Error(
      entry.reason === "no-balance" ? "User has no balance" : "Unable to find balance slot"
    );
  }
  const layout: VerifiedStorageLayout = entry;
  const storagePosition = layout.isVyper
    ? calculateBalanceVyperStorageSlot(holderAddress, layout.slot).vyperSlotHash
    : calculateBalanceSolidityStorageSlot(holderAddress, layout.slot).slotHash;
  const balance = discoveredBalance ?? await getStorageAtLimited(
    provider, erc20Address, storagePosition
  );
  return {
    slot: ethers.BigNumber.from(layout.slot).toHexString(),
    balance: ethers.BigNumber.from(balance),
    isVyper: layout.isVyper,
  };
};

const discoverBalanceLayout = async (
  provider: ethers.providers.JsonRpcProvider,
  erc20Address: string,
  holderAddress: string,
  userBalance: ethers.BigNumber,
  maxSlots: number
): Promise<{
  found?: {
    layout: VerifiedStorageLayout;
    balance: ethers.BigNumber;
  };
  incomplete: boolean;
}> => {
  const batchSize = 2;
  let incomplete = false;
  for (let start = 0; start < maxSlots; start += batchSize) {
    const candidates: Array<{ slot: number; isVyper: boolean; position: string }> = [];
    for (let slot = start; slot < Math.min(start + batchSize, maxSlots); slot++) {
      candidates.push({
        slot,
        isVyper: false,
        position: calculateBalanceSolidityStorageSlot(holderAddress, slot).slotHash,
      });
      candidates.push({
        slot,
        isVyper: true,
        position: calculateBalanceVyperStorageSlot(holderAddress, slot).vyperSlotHash,
      });
    }
    const values = await Promise.allSettled(candidates.map((candidate) =>
      getStorageAtLimited(provider, erc20Address, candidate.position)
    ));
    for (let i = 0; i < candidates.length; i++) {
      const value = values[i];
      if (value.status === "rejected") {
        // The matching slot may be among failed reads; the caller must treat
        // an exhausted-but-incomplete search as transient, not "not-found".
        incomplete = true;
      } else if (ethers.BigNumber.from(value.value).eq(userBalance)) {
        return {
          found: {
            layout: {
              slot: candidates[i].slot,
              isVyper: candidates[i].isVyper,
              verifiedAt: Date.now(),
            },
            balance: ethers.BigNumber.from(value.value),
          },
          incomplete: false,
        };
      }
    }
  }
  return { found: undefined, incomplete };
};


const calculateBalanceSolidityStorageSlot = (holderAddress: string, slotNumber: number) => {
  const slotHash = ethers.utils.solidityKeccak256(
    ["uint256", "uint256"],
    [holderAddress, slotNumber]
  );
  return { slotHash }
}

const calculateBalanceVyperStorageSlot = (holderAddress: string, slotNumber: number) => {
  // create hash via vyper storage layout, which uses keccak256(abi.encode(slot, address(this))) instead of keccak256(abi.encode(address(this), slot))
  const vyperSlotHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["uint256", "address"],
      [slotNumber, holderAddress]
    )
  );
  return { vyperSlotHash }
}

/**
 * Get the balance of a given address for a given ERC20 token
 * @param provider - The JsonRpcProvider instance
 * @param address - The address of the ERC20 token
 * @param addressToCheck - The address to check the balance of
 * @returns The balance of the address
 *
 */
export const getErc20Balance = async (
  provider: ethers.providers.JsonRpcProvider,
  address: string,
  addressToCheck: string
): Promise<ethers.BigNumber> => {
  const contract = new ethers.Contract(
    address,
    ["function balanceOf(address owner) view returns (uint256)"],
    provider
  );
  const balance = await contract.balanceOf(addressToCheck);
  return balance;
};
