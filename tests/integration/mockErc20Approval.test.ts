// mock the approval of an address for an ERC20 token, and then use eth_call to get the approval by passing in the stateDiff to override the storage

import { ethers } from "ethers";
import { generateMockApprovalData, getErc20Approval } from "../../src";

describe("mockErc20Approval", () => {
  const baseProvider = new ethers.providers.JsonRpcProvider(
    process.env.BASE_RPC_URL ?? "https://localhost:8545"
  );

  const ethProvider = new ethers.providers.JsonRpcProvider(
    process.env.ETH_RPC_URL ?? "https://localhost:8545"
  );

  const mockAddress = ethers.Wallet.createRandom().address;

  it("should mock the approval of an address for an ERC20 token", async () => {
    const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const ownerAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000";
    const spenderAddress = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    const mockApprovalAmount =
      "1461501637330902918203684832716283019655932142975";
    const maxSlots = 100;

    // get approval of spenderAddress before, to make sure its 0 before we mock it
    const approvalBefore = await getErc20Approval(
      baseProvider,
      tokenAddress,
      mockAddress,
      spenderAddress
    );
    expect(approvalBefore.toString()).toBe("0");

    const data = await generateMockApprovalData(baseProvider, {
      tokenAddress,
      ownerAddress,
      spenderAddress,
      mockAddress,
      mockApprovalAmount,
      maxSlots,
    });

    // Create the stateDiff object
    const stateDiff = {
      [tokenAddress]: {
        stateDiff: {
          [data.slot]: data.approval,
        },
      },
    };

    // Function selector for allowance(address,address)
    const allowanceSelector = "0xdd62ed3e";
    // Encode the owner and spender addresses
    const encodedAddresses = ethers.utils.defaultAbiCoder
      .encode(["address", "address"], [mockAddress, spenderAddress])
      .slice(2);
    const getAllowanceCalldata = allowanceSelector + encodedAddresses;

    const callParams = [
      {
        to: tokenAddress,
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

  it("[vyper] should mock the approval of an address for an ERC20 token", async () => {
    const tokenAddress = "0xD533a949740bb3306d119CC777fa900bA034cd52";
    const ownerAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000";
    const spenderAddress = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    const mockApprovalAmount =
      "1461501637330902918203684832716283019655932542975";
    const maxSlots = 100;

    // get approval of spenderAddress before, to make sure its 0 before we mock it
    const approvalBefore = await getErc20Approval(
      ethProvider,
      tokenAddress,
      mockAddress,
      spenderAddress
    );

    expect(approvalBefore.toString()).toBe("0");

    const data = await generateMockApprovalData(ethProvider, {
      tokenAddress,
      ownerAddress,
      spenderAddress,
      mockAddress,
      mockApprovalAmount,
      maxSlots,
    });

    // Create the stateDiff object
    const stateDiff = {
      [tokenAddress]: {
        stateDiff: {
          [data.slot]: data.approval,
        },
      },
    };

    // Function selector for allowance(address,address)
    const allowanceSelector = "0xdd62ed3e";
    // Encode the owner and spender addresses
    const encodedAddresses = ethers.utils.defaultAbiCoder
      .encode(["address", "address"], [mockAddress, spenderAddress])
      .slice(2);
    const getAllowanceCalldata = allowanceSelector + encodedAddresses;

    const callParams = [
      {
        to: tokenAddress,
        data: getAllowanceCalldata,
      },
      "latest",
    ];

    const allowanceResponse = await ethProvider.send("eth_call", [
      ...callParams,
      stateDiff,
    ]);

    // convert the response to a BigNumber
    const approval = ethers.BigNumber.from(
      ethers.utils.defaultAbiCoder.decode(["uint256"], allowanceResponse)[0]
    );

    // check the approval
    expect(approval.toString()).toBe(mockApprovalAmount);
  }, 30000);

  it("should mock the approval of an address for an ERC20 token, using the fallback slot", async () => {
    const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const ownerAddress = ethers.Wallet.createRandom().address;
    const spenderAddress = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    const mockApprovalAmount =
      "1461501637330902918203684832716283019655932142975";
    const maxSlots = 30;

    // get approval of spenderAddress before, to make sure its 0 before we mock it
    const approvalBefore = await getErc20Approval(
      baseProvider,
      tokenAddress,
      mockAddress,
      spenderAddress
    );
    expect(approvalBefore.toString()).toBe("0");

    const data = await generateMockApprovalData(baseProvider, {
      tokenAddress,
      ownerAddress,
      spenderAddress,
      mockAddress,
      mockApprovalAmount,
      maxSlots,
      useFallbackSlot: true
    });

    // Create the stateDiff object
    const stateDiff = {
      [tokenAddress]: {
        stateDiff: {
          [data.slot]: data.approval,
        },
      },
    };

    // Function selector for allowance(address,address)
    const allowanceSelector = "0xdd62ed3e";
    // Encode the owner and spender addresses
    const encodedAddresses = ethers.utils.defaultAbiCoder
      .encode(["address", "address"], [mockAddress, spenderAddress])
      .slice(2);
    const getAllowanceCalldata = allowanceSelector + encodedAddresses;

    const callParams = [
      {
        to: tokenAddress,
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
