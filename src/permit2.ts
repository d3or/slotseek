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
} => {

  // Calculate the slot hash, using the owner address and the slot index (1)
  const ownerSlotHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256"],
      [ownerAddress, 1]
    )
  );

  // Calcualte the storage slot hash for spender slot
  const tokenSlotHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "bytes32"],
      [erc20Address, ownerSlotHash]
    )
  );
  // Calculate the final storage slot to mock, using the spender address and the slot hash2
  const slot = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "bytes32"],
      [spenderAddress, tokenSlotHash]
    )
  );
  return { slot }
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

async function findStorageSlot() {
  // Setup - Base RPC
  const provider = new ethers.providers.JsonRpcProvider(
    "https://mainnet.base.org"
  );

  // Constants
  const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // USDC on Base
  const holderAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000"; // USDC holder
  const spenderAddress = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"

  // Compute storage slot of where the allowance would be held
  const { slot } = computePermit2AllowanceStorageSlot(mockAddress, tokenAddress, spenderAddress)

  const permit2Contract = '0x000000000022d473030f116ddee9f6b43ac78ba3'

  // Prepare state diff object
  const stateDiff = {
    [permit2Contract]: {
      stateDiff: {
        [slot]: ethers.utils.hexZeroPad(
          ethers.utils.hexlify(ethers.BigNumber.from("1461501637330902918203684832716283019655932142975")),
          32
        )
        ,
      },
    },
  };

  // Function selector for allowance(address,address,address)
  const allowanceSelector = "0x927da105";
  // Encode the owner and spender addresses
  const encodedAddresses = ethers.utils.defaultAbiCoder
    .encode(["address", "address", "address"], [mockAddress, tokenAddress, spenderAddress])
    .slice(2);
  const getAllowanceCalldata = allowanceSelector + encodedAddresses;


  const callParams = [
    {
      to: permit2Contract,
      data: getAllowanceCalldata,
    },
    "latest",
  ];

  const allowanceResponse = await baseProvider.send("eth_call", [
    ...callParams,
    stateDiff,
  ]);

  // convert the response to a BigNumber
  const approval = ethers.BigNumber.from(
    ethers.utils.defaultAbiCoder.decode(["uint256"], allowanceResponse)[0]
  );

  console.log(
    `Mocked balance for ${mockAddress}: ${ethers.utils.formatUnits(
      approval,
      6
    )} USDC`
  );

}
