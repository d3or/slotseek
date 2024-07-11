import { ethers } from "ethers";

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
  }: {
    tokenAddress: string;
    holderAddress: string;
    mockAddress: string;
    mockBalanceAmount?: string;
    maxSlots?: number;
  }
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
    maxSlots
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
  maxSlots = 100
): Promise<{
  slot: string;
  balance: ethers.BigNumber;
  isVyper: boolean;
}> => {
  // Get the balance of the holder, that we can use to find the slot
  const userBalance = await getErc20Balance(
    provider,
    erc20Address,
    holderAddress
  );
  // If the balance is 0, we can't find the slot, so throw an error
  if (userBalance.eq(0)) {
    throw new Error("User has no balance");
  }
  // We iterate over maxSlots, maxSlots is set to 100 by default, its unlikely that an erc20 token will be using up more than 100 slots tbh
  // For each slot, we compute the storage slot key [holderAddress, slot index] and get the value at that storage slot
  // If the value at the storage slot is equal to the balance, return the slot as we have found the correct slot for balances
  for (let i = 0; i < maxSlots; i++) {
    const slot = ethers.utils.solidityKeccak256(
      ["uint256", "uint256"],
      [holderAddress, i]
    );
    const balance = await provider.getStorageAt(erc20Address, slot);
    if (ethers.BigNumber.from(balance).eq(userBalance)) {
      return {
        slot: ethers.BigNumber.from(i).toHexString(),
        balance: ethers.BigNumber.from(balance),
        isVyper: false,
      };
    }

    // check via vyper storage layout, which uses keccak256(abi.encode(slot, address(this))) instead of keccak256(abi.encode(address(this), slot))
    const vyperSlotHash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["uint256", "address"],
        [i, holderAddress]
      )
    );
    const vyperBalance = await provider.getStorageAt(
      erc20Address,
      vyperSlotHash
    );
    if (ethers.BigNumber.from(vyperBalance).eq(userBalance)) {
      return {
        slot: ethers.BigNumber.from(i).toHexString(),
        balance: ethers.BigNumber.from(vyperBalance),
        isVyper: true,
      };
    }
  }
  throw new Error("Unable to find balance slot");
};

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
