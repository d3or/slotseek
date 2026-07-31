import { ethers } from "ethers";
import {
  approvalCache,
  getExternalLayout,
  getLocalLayout,
  getLocalMissingLayout,
  getStorageAtLimited,
  resolveCacheContext,
  runVerifiedDiscovery,
  setExternalLayout,
  setExternalMissingLayout,
  setLocalLayout,
  setLocalMissingLayout,
} from "./cache";
import { StorageLayoutCacheOptions, VerifiedStorageLayout } from "./types";

class IncompleteApprovalDiscoveryError extends Error {}

/**
 * Generate mock approval data for a given ERC20 token
 * @param provider - The JsonRpcProvider instance
 * @param tokenAddress - The address of the ERC20 token
 * @param ownerAddress - The address of the owner
 * @param spenderAddress - The address of the spender
 * @param mockAddress - The address to mock the approval for
 * @param mockApprovalAmount - The amount to mock the approval for
 * @param maxSlots - The maximum number of slots to search
 * @returns An object containing the slot and approval data
 *
 */
export const generateMockApprovalData = async (
  provider: ethers.providers.JsonRpcProvider,
  {
    tokenAddress,
    ownerAddress,
    spenderAddress,
    mockAddress,
    mockApprovalAmount,
    maxSlots = 30,
    useFallbackSlot = false,
    ...cacheOptions
  }: {
    tokenAddress: string;
    ownerAddress: string;
    spenderAddress: string;
    mockAddress: string;
    mockApprovalAmount: string;
    maxSlots?: number;
    useFallbackSlot?: boolean;
  } & StorageLayoutCacheOptions
): Promise<{
  slot: string;
  approval: string;
  isVyper: boolean;
}> => {
  // get the slot for the approval mapping, mapping(address account => mapping(address spender => uint256))
  const { slot, isVyper } = await getErc20ApprovalStorageSlot(
    provider,
    tokenAddress,
    ownerAddress,
    spenderAddress,
    maxSlots,
    useFallbackSlot,
    cacheOptions
  );

  // make sure its padded to 32 bytes, and convert to a BigNumber
  const mockApprovalHex = ethers.utils.hexZeroPad(
    ethers.utils.hexlify(ethers.BigNumber.from(mockApprovalAmount)),
    32
  );

  let index;
  if (!isVyper) {
    const newSlotHash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [mockAddress, slot]
      )
    );
    // Calculate the storage slot key
    index = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["address", "bytes32"],
        [spenderAddress, newSlotHash]
      )
    );
  } else {
    const newSlotHash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["uint256", "address"],
        [slot, mockAddress]
      )
    );
    // Calculate the storage slot key
    index = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "address"],
        [newSlotHash, spenderAddress]
      )
    );
  }

  return {
    slot: index,
    approval: mockApprovalHex,
    isVyper,
  };
};

/**
 * Get the storage slot for a given ERC20 token approval
 * @param provider - The JsonRpcProvider instance
 * @param erc20Address - The address of the ERC20 token
 * @param ownerAddress - The address of the owner, used to find the approval slot
 * @param spenderAddress - The address of the spender, used to find the approval slot
 * @param maxSlots - The maximum number of slots to search
 * @returns The slot for the approval
 *
 * - This uses a brute force approach similar to the balance slot search. See the balance slot search comment for more details.
 */
export const getErc20ApprovalStorageSlot = async (
  provider: ethers.providers.JsonRpcProvider,
  erc20Address: string,
  ownerAddress: string,
  spenderAddress: string,
  maxSlots: number,
  useFallbackSlot = false,
  options: StorageLayoutCacheOptions = {}
): Promise<{
  slot: string;
  slotHash: string;
  isVyper: boolean;
}> => {
  const context = await resolveCacheContext(provider, "approval", erc20Address, options);
  let layout = getLocalLayout(approvalCache, context.key, context.ttlSeconds);
  let missing = !layout && getLocalMissingLayout(
    context.key, context.negativeTtlSeconds, maxSlots
  );
  if (!layout && !missing) {
    const cached = await getExternalLayout(
      options,
      context.key,
      context.ttlSeconds,
      context.negativeTtlSeconds,
      maxSlots,
      context.timeoutMs
    );
    layout = cached.layout;
    missing = cached.missing;
    if (layout) {
      setLocalLayout(approvalCache, context.key, layout, context.ttlSeconds);
    } else if (missing) {
      setLocalMissingLayout(
        approvalCache, context.key, maxSlots, context.negativeTtlSeconds
      );
    }
  }

  let approval: ethers.BigNumber | undefined;
  if (!layout && !missing) {
    const discoveryKey = `${context.key}:max-slots:${maxSlots}`;
    try {
      layout = await runVerifiedDiscovery(discoveryKey, async () => {
        approval = await getErc20Approval(
          provider, erc20Address, ownerAddress, spenderAddress
        );
        if (approval.eq(0)) return undefined;
        const discovered = await discoverApprovalLayout(
          provider, erc20Address, ownerAddress, spenderAddress, approval, maxSlots
        );
        if (!discovered) {
          setLocalMissingLayout(
            approvalCache, context.key, maxSlots, context.negativeTtlSeconds
          );
          await setExternalMissingLayout(
            options,
            context.key,
            maxSlots,
            context.negativeTtlSeconds,
            context.timeoutMs
          );
          return undefined;
        }
        setLocalLayout(approvalCache, context.key, discovered, context.ttlSeconds);
        await setExternalLayout(
          options, context.key, discovered, context.ttlSeconds, context.timeoutMs
        );
        return discovered;
      });
    } catch (error) {
      if (!useFallbackSlot || !(error instanceof IncompleteApprovalDiscoveryError)) {
        throw error;
      }
    }
  }

  if (!layout && useFallbackSlot) {
    approval ??= await getErc20Approval(provider, erc20Address, ownerAddress, spenderAddress);
    layout = approval.eq(0)
      ? { slot: 10, isVyper: false, verifiedAt: Date.now() }
      : await findApprovalFallback(
        provider, erc20Address, ownerAddress, spenderAddress, approval
      );
    // Zero equality is only a caller-specific fallback guess, never a verified layout.
    if (layout && approval.gt(0)) {
      setLocalLayout(approvalCache, context.key, layout, context.ttlSeconds);
      await setExternalLayout(
        options, context.key, layout, context.ttlSeconds, context.timeoutMs
      );
    }
  }

  if (!layout) {
    if (!useFallbackSlot && approval?.gt(0)) throw new Error("Approval does not exist");
    throw new Error("Unable to find approval slot");
  }
  const slotHash = layout.isVyper
    ? calculateApprovalVyperStorageSlot(ownerAddress, spenderAddress, layout.slot).vyperSlotHash
    : calculateApprovalSolidityStorageSlot(ownerAddress, spenderAddress, layout.slot).slotHash;
  return {
    slot: ethers.BigNumber.from(layout.slot).toHexString(),
    slotHash,
    isVyper: layout.isVyper,
  };
};

const discoverApprovalLayout = async (
  provider: ethers.providers.JsonRpcProvider,
  erc20Address: string,
  ownerAddress: string,
  spenderAddress: string,
  approval: ethers.BigNumber,
  maxSlots: number
): Promise<VerifiedStorageLayout | undefined> => {
  const batchSize = 2;
  let hadRejectedProbe = false;
  for (let start = 0; start < maxSlots; start += batchSize) {
    const candidates: Array<{ slot: number; isVyper: boolean; position: string }> = [];
    for (let slot = start; slot < Math.min(start + batchSize, maxSlots); slot++) {
      candidates.push({ slot, isVyper: false, position:
        calculateApprovalSolidityStorageSlot(ownerAddress, spenderAddress, slot).storageSlot });
      candidates.push({ slot, isVyper: true, position:
        calculateApprovalVyperStorageSlot(ownerAddress, spenderAddress, slot).vyperStorageSlot });
    }
    const values = await Promise.allSettled(candidates.map((candidate) =>
      getStorageAtLimited(provider, erc20Address, candidate.position)
    ));
    for (let i = 0; i < candidates.length; i++) {
      const value = values[i];
      if (value.status === "rejected") {
        hadRejectedProbe = true;
      } else if (ethers.BigNumber.from(value.value).eq(approval)) {
        return { slot: candidates[i].slot, isVyper: candidates[i].isVyper, verifiedAt: Date.now() };
      }
    }
  }
  if (hadRejectedProbe) {
    throw new IncompleteApprovalDiscoveryError(
      "Unable to verify approval layout because a storage read failed"
    );
  }
  return undefined;
};

const findApprovalFallback = async (
  provider: ethers.providers.JsonRpcProvider,
  erc20Address: string,
  ownerAddress: string,
  spenderAddress: string,
  approval: ethers.BigNumber
): Promise<VerifiedStorageLayout | undefined> => {
  const slot = 10;
  const solidityPosition = calculateApprovalSolidityStorageSlot(
    ownerAddress, spenderAddress, slot
  ).storageSlot;
  try {
    const value = await getStorageAtLimited(provider, erc20Address, solidityPosition);
    if (ethers.BigNumber.from(value).eq(approval)) {
      return { slot, isVyper: false, verifiedAt: Date.now() };
    }
  } catch {}
  const vyperPosition = calculateApprovalVyperStorageSlot(
    ownerAddress, spenderAddress, slot
  ).vyperStorageSlot;
  try {
    const value = await getStorageAtLimited(provider, erc20Address, vyperPosition);
    if (ethers.BigNumber.from(value).eq(approval)) {
      return { slot, isVyper: true, verifiedAt: Date.now() };
    }
  } catch {}
  return undefined;
};

// Generates approval solidity storage slot data
const calculateApprovalSolidityStorageSlot = (ownerAddress: string, spenderAddress: string, slotNumber: number) => {

  // Calculate the slot hash, using the owner address and the slot index
  const slotHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256"],
      [ownerAddress, slotNumber]
    )
  );
  // Calculate the storage slot, using the spender address and the slot hash
  const storageSlot = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "bytes32"],
      [spenderAddress, slotHash]
    )
  );
  return { storageSlot, slotHash }
}

// Generates approval vyper storage slot data
const calculateApprovalVyperStorageSlot = (ownerAddress: string, spenderAddress: string, slotNumber: number) => {
  // create via vyper storage layout, which uses keccak256(abi.encode(slot, address(this))) instead of keccak256(abi.encode(address(this), slot))
  const vyperSlotHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["uint256", "address"],
      [slotNumber, ownerAddress]
    )
  );

  const vyperStorageSlot = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "address"],
      [vyperSlotHash, spenderAddress]
    )
  );

  return { vyperStorageSlot, vyperSlotHash }
}
/**
 * Get the approval for a given ERC20 token
 * @param provider - The JsonRpcProvider instance
 * @param address - The address of the ERC20 token
 * @param ownerAddress - The address of the owner
 * @param spenderAddress - The address of the spender
 * @returns The approval amount
 */
export const getErc20Approval = async (
  provider: ethers.providers.JsonRpcProvider,
  address: string,
  ownerAddress: string,
  spenderAddress: string
): Promise<ethers.BigNumber> => {
  const contract = new ethers.Contract(
    address,
    [
      "function allowance(address owner, address spender) view returns (uint256)",
    ],
    provider
  );
  const approval = await contract.allowance(ownerAddress, spenderAddress);
  return approval;
};
