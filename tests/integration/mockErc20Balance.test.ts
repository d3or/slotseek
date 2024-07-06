// mock the balance of an address for an ERC20 token, and then use eth_call to get the balance by passing in the stateDiff to override the storage

import { ethers } from "ethers";
import { generateMockBalanceData, getErc20Balance } from "../../src";

describe("mockErc20Balance", () => {
  const baseProvider = new ethers.providers.JsonRpcProvider(
    process.env.BASE_RPC_URL ?? "https://localhost:8545"
  );

  const ethProvider = new ethers.providers.JsonRpcProvider(
    process.env.ETH_RPC_URL ?? "https://localhost:8545"
  );

  const mockAddress = ethers.Wallet.createRandom().address;

  it("[solidity] should mock the balance of an address for an ERC20 token", async () => {
    const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const holderAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000";
    const mockBalanceAmount = "9600000";
    const maxSlots = 100;

    // get balance of mockAddress before, to make sure its 0 before we mock it
    const balanceBefore = await getErc20Balance(
      baseProvider,
      tokenAddress,
      mockAddress
    );
    expect(balanceBefore.toString()).toBe("0");

    const data = await generateMockBalanceData(baseProvider, {
      tokenAddress,
      holderAddress,
      mockAddress,
      mockBalanceAmount,
      maxSlots,
    });

    // Create the stateDiff object
    const stateDiff = {
      [tokenAddress]: {
        stateDiff: {
          [data.slot]: data.balance,
        },
      },
    };

    // Function selector for balanceOf(address)
    const balanceOfSelector = "0x70a08231";

    // Encode the address we want to check the balance of (in this case, mockAddress)
    const encodedAddress = ethers.utils.defaultAbiCoder
      .encode(["address"], [mockAddress])
      .slice(2);

    const getBalanceCalldata = balanceOfSelector + encodedAddress;

    const callParams = [
      {
        from: mockAddress,
        to: tokenAddress,
        data: getBalanceCalldata,
      },
      "latest",
    ];

    const balanceOfResponse = await baseProvider.send("eth_call", [
      ...callParams,
      stateDiff,
    ]);

    // convert the response to a BigNumber
    const balance = ethers.BigNumber.from(
      ethers.utils.defaultAbiCoder.decode(["uint256"], balanceOfResponse)[0]
    );

    expect(balance.eq(data.balance)).toBe(true);
  }, 30000);

  it("[vyper] should mock the balance of an address for an ERC20 token", async () => {
    const tokenAddress = "0xD533a949740bb3306d119CC777fa900bA034cd52";
    const holderAddress = "0x5f3b5DfEb7B28CDbD7FAba78963EE202a494e2A2";
    const mockBalanceAmount = "9600000";
    const maxSlots = 100;

    // get balance of mockAddress before, to make sure its 0 before we mock it
    const balanceBefore = await getErc20Balance(
      ethProvider,
      tokenAddress,
      mockAddress
    );
    expect(balanceBefore.toString()).toBe("0");

    const data = await generateMockBalanceData(ethProvider, {
      tokenAddress,
      holderAddress,
      mockAddress,
      mockBalanceAmount,
      maxSlots,
    });

    // Create the stateDiff object
    const stateDiff = {
      [tokenAddress]: {
        stateDiff: {
          [data.slot]: data.balance,
        },
      },
    };

    // Function selector for balanceOf(address)
    const balanceOfSelector = "0x70a08231";

    // Encode the address we want to check the balance of (in this case, mockAddress)
    const encodedAddress = ethers.utils.defaultAbiCoder
      .encode(["address"], [mockAddress])
      .slice(2);

    const getBalanceCalldata = balanceOfSelector + encodedAddress;

    const callParams = [
      {
        from: mockAddress,
        to: tokenAddress,
        data: getBalanceCalldata,
      },
      "latest",
    ];

    const balanceOfResponse = await ethProvider.send("eth_call", [
      ...callParams,
      stateDiff,
    ]);

    // convert the response to a BigNumber
    const balance = ethers.BigNumber.from(
      ethers.utils.defaultAbiCoder.decode(["uint256"], balanceOfResponse)[0]
    );

    expect(balance.eq(data.balance)).toBe(true);
  }, 30000);
});
