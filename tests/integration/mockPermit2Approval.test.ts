import { ethers } from "ethers";
import { computePermit2AllowanceStorageSlot, getPermit2ERC20Allowance } from "../../src";

describe("mockErc20Approval", () => {
  const baseProvider = new ethers.providers.JsonRpcProvider(
    process.env.BASE_RPC_URL ?? "https://localhost:8545"
  );

  const mockAddress = ethers.Wallet.createRandom().address;

  it("should mock a random address to have a permit2 allowance", async () => {
    const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const spenderAddress = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const mockApprovalAmount =
      "1461501637330902918203684832716283019655932142975";
    const mockApprovalHex = ethers.utils.hexZeroPad(
      ethers.utils.hexlify(ethers.BigNumber.from(mockApprovalAmount)),
      32
    )
    const permit2Contract = '0x000000000022d473030f116ddee9f6b43ac78ba3'


    const permit2Slot = computePermit2AllowanceStorageSlot(mockAddress, tokenAddress, spenderAddress)
    expect(permit2Slot.slot).toBeDefined()

    // get approval of spenderAddress before, to make sure its 0 before we mock it
    const approvalBefore = await getPermit2ERC20Allowance(
      baseProvider,
      permit2Contract,
      mockAddress,
      tokenAddress,
      spenderAddress
    );
    expect(approvalBefore.toString()).toBe("0");

    // Create the stateDiff object
    const stateDiff = {
      [permit2Contract]: {
        stateDiff: {
          [permit2Slot.slot]: mockApprovalHex,
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

    // check the approval
    expect(approval.eq(mockApprovalAmount)).toBe(true);
  }, 30000);
});
