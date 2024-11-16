import { generateMockBalanceData } from "../../../src";
import { ethers } from "ethers";

describe("generateMockBalanceData", () => {
  const baseProvider = new ethers.providers.JsonRpcProvider(
    process.env.BASE_RPC_URL ?? "https://localhost:8545"
  );

  const ethProvider = new ethers.providers.JsonRpcProvider(
    process.env.ETH_RPC_URL ?? "https://localhost:8545"
  );

  it("should generate mock balance data", async () => {
    const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const holderAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000";
    const mockAddress = "0x3e34b27a9bf37D8424e1a58aC7fc4D06914B76B9";
    const mockBalanceAmount = "9600000";
    const maxSlots = 30;

    const data = await generateMockBalanceData(baseProvider, {
      tokenAddress,
      holderAddress,
      mockAddress,
      mockBalanceAmount,
      maxSlots,
    });
    expect(data).toBeDefined();
    expect(data.slot).toBeDefined();
    expect(data.balance).toBeDefined();
  }, 120000);

  it("[vyper] should generate mock balance data", async () => {
    const tokenAddress = "0xD533a949740bb3306d119CC777fa900bA034cd52";
    const holderAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000";
    const mockAddress = ethers.Wallet.createRandom().address;
    const mockBalanceAmount = "1000000";
    const maxSlots = 30;

    const data = await generateMockBalanceData(ethProvider, {
      tokenAddress,
      holderAddress,
      mockAddress,
      mockBalanceAmount,
      maxSlots,
    });
    expect(data).toBeDefined();
    expect(data.slot).toBeDefined();
    expect(data.balance).toBeDefined();
    expect(data.isVyper).toBe(true);
  }, 120000);
});
