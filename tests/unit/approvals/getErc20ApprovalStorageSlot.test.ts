import { getErc20ApprovalStorageSlot } from "../../../src";
import { ethers } from "ethers";

describe("getErc20ApprovalStorageSlot", () => {
  const baseProvider = new ethers.providers.JsonRpcProvider(
    process.env.BASE_RPC_URL ?? "https://localhost:8545"
  );

  const ethProvider = new ethers.providers.JsonRpcProvider(
    process.env.ETH_RPC_URL ?? "https://localhost:8545"
  );

  it("should return the slot for the approval", async () => {
    const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const ownerAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000";
    const spenderAddress = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    const maxSlots = 30;
    const { slot, slotHash, isVyper } = await getErc20ApprovalStorageSlot(
      baseProvider,
      tokenAddress,
      ownerAddress,
      spenderAddress,
      maxSlots
    );
    expect(slot).toBeDefined();
    expect(slot).toBe("0x0a");
    expect(slotHash).toBeDefined();
    expect(slotHash).toBe(
      "0xf2dfc0227cd25ec2dc7c59717d57cc191c316c525cb2f0ea056315d3be9b1d39"
    );
    expect(isVyper).toBe(false);
  }, 30000);
  it("[vyper] should return the slot for the approval", async () => {
    const tokenAddress = "0xD533a949740bb3306d119CC777fa900bA034cd52";
    const ownerAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000";
    const spenderAddress = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    const maxSlots = 30;
    const { slot, slotHash, isVyper } = await getErc20ApprovalStorageSlot(
      ethProvider,
      tokenAddress,
      ownerAddress,
      spenderAddress,
      maxSlots
    );
    expect(slot).toBeDefined();
    expect(slot).toBe("0x04");
    expect(slotHash).toBeDefined();
    expect(slotHash).toBe(
      "0xfdea71adb068939bcb1c6cec44c1a3b422cf39891d820933d2cc03eb8a72f14c"
    );
    expect(isVyper).toBe(true);
  }, 30000);
});
