import { computePermit2AllowanceStorageSlot, getPermit2ERC20Allowance } from "../../../src";
import { ethers } from "ethers";

describe("getPermit2ERC20Allowance", () => {
	const baseProvider = new ethers.providers.JsonRpcProvider(
		process.env.BASE_RPC_URL ?? "https://localhost:8545"
	);

	it("should return the permit2 ERC20 allowance for the owner", async () => {
		const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
		const ownerAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000";
		const spenderAddress = "0x0000000000000000000000000000000000000000";

		const permit2Contract = '0x000000000022d473030f116ddee9f6b43ac78ba3'
		const allowance = await getPermit2ERC20Allowance(
			baseProvider,
			permit2Contract,
			ownerAddress,
			tokenAddress,
			spenderAddress
		);
		expect(allowance).toBeDefined();
		expect(allowance.toString()).toBe("1");

	}, 120000);

	it("should return 0 allowance for permit2 ERC20 allowance for vitalik", async () => {
		const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
		const ownerAddress = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
		const spenderAddress = "0x0000000000000000000000000000000000000000";

		const permit2Contract = '0x000000000022d473030f116ddee9f6b43ac78ba3'
		const allowance = await getPermit2ERC20Allowance(
			baseProvider,
			permit2Contract,
			ownerAddress,
			tokenAddress,
			spenderAddress
		);
		expect(allowance).toBeDefined();
		expect(allowance.toString()).toBe("0");
	}, 120000);

});
