import { generateMockApprovalData } from "../../../src";
import { ethers } from "ethers";

describe("generateMockApprovalData", () => {
  const baseProvider = new ethers.providers.JsonRpcProvider(
    process.env.BASE_RPC_URL ?? "https://localhost:8545"
  );
  const ethProvider = new ethers.providers.JsonRpcProvider(
    process.env.ETH_RPC_URL ?? "https://localhost:8545"
  );

  const mockAddress = ethers.Wallet.createRandom().address;

  it("should generate mock approval data", async () => {
    const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const ownerAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000";
    const spenderAddress = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    const mockApprovalAmount = "1000000";
    const maxSlots = 100;

    const data = await generateMockApprovalData(baseProvider, {
      tokenAddress,
      ownerAddress,
      spenderAddress,
      mockAddress,
      mockApprovalAmount,
      maxSlots,
    });
    expect(data).toBeDefined();
    expect(data.slot).toBeDefined();
    expect(data.approval).toBeDefined();
    expect(data.isVyper).toBe(false);
  }, 30000);

  it("[vyper] should generate mock approval data", async () => {
    const tokenAddress = "0xD533a949740bb3306d119CC777fa900bA034cd52";
    const ownerAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000";
    const spenderAddress = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    const mockAddress = ethers.Wallet.createRandom().address;
    const mockApprovalAmount = "1000000";
    const maxSlots = 100;

    const data = await generateMockApprovalData(ethProvider, {
      tokenAddress,
      ownerAddress,
      spenderAddress,
      mockAddress,
      mockApprovalAmount,
      maxSlots,
    });
    expect(data).toBeDefined();
    expect(data.slot).toBeDefined();
    expect(data.approval).toBeDefined();
    expect(data.isVyper).toBe(true);
  }, 30000);
});
