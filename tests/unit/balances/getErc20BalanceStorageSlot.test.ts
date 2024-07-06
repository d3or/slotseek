import { getErc20BalanceStorageSlot } from "../../../src";
import { ethers } from "ethers";

describe("getErc20BalanceStorageSlot", () => {
  const baseProvider = new ethers.providers.JsonRpcProvider(
    process.env.BASE_RPC_URL ?? "https://localhost:8545"
  );

  const ethProvider = new ethers.providers.JsonRpcProvider(
    process.env.ETH_RPC_URL ?? "https://localhost:8545"
  );

  it("should return the slot and balance for the holder", async () => {
    const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const holderAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000";
    const maxSlots = 100;
    const { slot, balance, isVyper } = await getErc20BalanceStorageSlot(
      baseProvider,
      tokenAddress,
      holderAddress,
      maxSlots
    );
    expect(slot).toBeDefined();
    expect(balance).toBeDefined();
    expect(slot).toBe("0x09");
    expect(balance.toString()).toBe("9600000");
    expect(isVyper).toBe(false);
  }, 30000);

  it("[vyper] should return the slot and balance for the holder", async () => {
    const tokenAddress = "0xD533a949740bb3306d119CC777fa900bA034cd52";
    const holderAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000";
    const maxSlots = 100;
    const { slot, balance, isVyper } = await getErc20BalanceStorageSlot(
      ethProvider,
      tokenAddress,
      holderAddress,
      maxSlots
    );
    expect(slot).toBeDefined();
    expect(balance).toBeDefined();
    expect(slot).toBe("0x03");
    expect(balance.toString()).toBe("45868293345383087538");
    expect(isVyper).toBe(true);
  }, 30000);
});
