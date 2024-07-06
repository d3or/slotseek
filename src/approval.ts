import { ethers } from "ethers";

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
    maxSlots = 100,
  }: {
    tokenAddress: string;
    ownerAddress: string;
    spenderAddress: string;
    mockAddress: string;
    mockApprovalAmount: string;
    maxSlots?: number;
  }
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
    maxSlots
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
  maxSlots: number
): Promise<{
  slot: string;
  slotHash: string;
  isVyper: boolean;
}> => {
  // Get the approval for the spender, that we can use to find the slot
  const approval = await getErc20Approval(
    provider,
    erc20Address,
    ownerAddress,
    spenderAddress
  );

  // If the approval is 0, we can't find the slot, so throw an error
  if (approval.eq(0)) {
    throw new Error("Approval does not exist");
  }

  for (let i = 0; i < maxSlots; i++) {
    // Caalculate the slot hash, using the owner address and the slot index
    const slot = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [ownerAddress, i]
      )
    );
    // Calculate the storage slot, using the spender address and the slot hash
    const storageSlot = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["address", "bytes32"],
        [spenderAddress, slot]
      )
    );
    // Get the value at the storage slot
    const storageValue = await provider.getStorageAt(erc20Address, storageSlot);
    // If the value at the storage slot is equal to the approval, return the slot as we have found the correct slot for approvals
    if (ethers.BigNumber.from(storageValue).eq(approval)) {
      return {
        slot: ethers.BigNumber.from(i).toHexString(),
        slotHash: slot,
        isVyper: false,
      };
    }

    // check via vyper storage layout, which uses keccak256(abi.encode(slot, address(this))) instead of keccak256(abi.encode(address(this), slot))
    const vyperSlotHash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["uint256", "address"],
        [i, ownerAddress]
      )
    );

    const vyperStorageSlot = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "address"],
        [vyperSlotHash, spenderAddress]
      )
    );
    const vyperStorageValue = await provider.getStorageAt(
      erc20Address,
      vyperStorageSlot
    );
    if (ethers.BigNumber.from(vyperStorageValue).eq(approval)) {
      return {
        slot: ethers.BigNumber.from(i).toHexString(),
        slotHash: vyperSlotHash,
        isVyper: true,
      };
    }
  }

  throw new Error("Unable to find approval slot");
};

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
