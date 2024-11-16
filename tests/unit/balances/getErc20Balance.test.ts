import { getErc20Balance } from "../../../src";
import { ethers } from "ethers";

describe("getErc20Balance", () => {
  const baseProvider = new ethers.providers.JsonRpcProvider(
    process.env.BASE_RPC_URL ?? "https://localhost:8545"
  );

  const ethProvider = new ethers.providers.JsonRpcProvider(
    process.env.ETH_RPC_URL ?? "https://localhost:8545"
  );

  it("should return the balance for the owner", async () => {
    const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const ownerAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000";
    const balance = await getErc20Balance(
      baseProvider,
      tokenAddress,
      ownerAddress
    );
    expect(balance).toBeDefined();
    expect(balance.toString()).toBe("8600000");
  }, 30000);

  it("[vyper] should return the balance for the owner", async () => {
    const tokenAddress = "0xD533a949740bb3306d119CC777fa900bA034cd52";
    const ownerAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000";
    const balance = await getErc20Balance(
      ethProvider,
      tokenAddress,
      ownerAddress
    );
    expect(balance).toBeDefined();
    expect(balance.toString()).toBe("45868293345383087538");
  }, 30000);
});
