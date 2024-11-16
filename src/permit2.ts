import { ethers } from "ethers";


/**
 * Compute the storage slot for permit2 allowance. 
 *  NOTE: unlike arbitrary erc20 contracts, we know the slot for where this is stored (1) :)
 *
 * @param erc20Address - The address of the ERC20 token
 * @param ownerAddress - The address of the ERC20 token owner
 * @param spenderAddress - The address of the spender
 * @returns The slot where the allowance amount is stored, mock this 
 *
 * - This uses a brute force approach similar to the balance slot search. See the balance slot search comment for more details.
 */
export const computePermit2AllowanceStorageSlot = (ownerAddress: string, erc20Address: string, spenderAddress: string): {
  slot: string;
  slotHash: string;
  slotHash2: string;
} => {

  // Calculate the slot hash, using the owner address and the slot index (1)
  const slotHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256"],
      [ownerAddress, 1]
    )
  );

  // Calcualte the storage slot hash for spender slot
  const slotHash2 = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "bytes32"],
      [erc20Address, slotHash]
    )
  );
  // Calculate the final storage slot to mock, using the spender address and the slot hash2
  const slot = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "bytes32"],
      [spenderAddress, slotHash2]
    )
  );
  return { slot, slotHash, slotHash2 }
}


/**
 * Get the permit2 erc20 allowance for a given ERC20 token and spender
 * @param provider - The JsonRpcProvider instance
 * @param permit2Address - The permit2 contract address
 * @param erc20Address - The address of the ERC20 token
 * @param ownerAddress - The address of the ERC20 token owner
 * @param spenderAddress - The address of the spender
 * @returns The approval amount
 */
export const getPermit2ERC20Allowance = async (
  provider: ethers.providers.JsonRpcProvider,
  permit2Address: string,
  ownerAddress: string, erc20Address: string, spenderAddress: string): Promise<ethers.BigNumber> => {
  const contract = new ethers.Contract(
    permit2Address,
    [
      "function allowance(address owner, address token, address spender) view returns (uint256)",
    ],
    provider
  );
  const approval = await contract.allowance(ownerAddress, erc20Address, spenderAddress);
  return approval;
};
