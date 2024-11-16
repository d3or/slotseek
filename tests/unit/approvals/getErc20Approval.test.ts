import { getErc20Approval } from "../../../src";
import { ethers } from "ethers";

describe("getErc20Approval", () => {
  const baseProvider = new ethers.providers.JsonRpcProvider(
    process.env.BASE_RPC_URL ?? "https://localhost:8545"
  );

  const ethProvider = new ethers.providers.JsonRpcProvider(
    process.env.ETH_RPC_URL ?? "https://localhost:8545"
  );

  it("should return the approval for the spender", async () => {
    const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const ownerAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000";
    const spenderAddress = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    const approval = await getErc20Approval(
      baseProvider,
      tokenAddress,
      ownerAddress,
      spenderAddress
    );
    expect(approval).toBeDefined();
    expect(approval.toString()).toBe(
      "1461501637330902918203684832716283019655931142975"
    );
  }, 120000);

  it("[vyper] should return the approval for the spender", async () => {
    const tokenAddress = "0xD533a949740bb3306d119CC777fa900bA034cd52";
    const ownerAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000";
    const spenderAddress = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    const approval = await getErc20Approval(
      ethProvider,
      tokenAddress,
      ownerAddress,
      spenderAddress
    );
    expect(approval).toBeDefined();
    expect(approval.toString()).toBe(
      "1461501637330902918203684832716283019655932542975"
    );
  }, 120000);
});
