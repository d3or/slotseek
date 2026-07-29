import { ethers } from "ethers";
import {
  balanceCache,
  getExternalLayout,
  getLocalLayout,
  getStorageAtLimited,
  resolveCacheContext,
  runVerifiedDiscovery,
  setExternalLayout,
  setLocalLayout,
} from "./cache";
import { StorageLayoutCacheOptions, VerifiedStorageLayout } from "./types";

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
  let layout = getLocalLayout(balanceCache, context.key, context.ttlSeconds);
  if (!layout) {
    layout = await getExternalLayout(options, context.key, context.ttlSeconds, context.timeoutMs);
    if (layout) setLocalLayout(balanceCache, context.key, layout, context.ttlSeconds);
  }

  let discoveredBalance: ethers.BigNumber | undefined;
  if (!layout) {
    layout = await runVerifiedDiscovery(context.key, async () => {
      const userBalance = await getErc20Balance(provider, erc20Address, holderAddress);
      if (userBalance.eq(0)) throw new Error("User has no balance");
      const discovered = await discoverBalanceLayout(
        provider, erc20Address, holderAddress, userBalance, maxSlots
      );
      if (!discovered) throw new Error("Unable to find balance slot");
      discoveredBalance = discovered.balance;
      setLocalLayout(balanceCache, context.key, discovered.layout, context.ttlSeconds);
      await setExternalLayout(
        options, context.key, discovered.layout, context.ttlSeconds, context.timeoutMs
      );
      return discovered.layout;
    });
  }

  if (!layout) throw new Error("Unable to find balance slot");
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
  layout: VerifiedStorageLayout;
  balance: ethers.BigNumber;
} | undefined> => {
  const batchSize = 2;
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
      if (value.status === "fulfilled" && ethers.BigNumber.from(value.value).eq(userBalance)) {
        return {
          layout: {
            slot: candidates[i].slot,
            isVyper: candidates[i].isVyper,
            verifiedAt: Date.now(),
          },
          balance: ethers.BigNumber.from(value.value),
        };
      }
    }
  }
  return undefined;
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
