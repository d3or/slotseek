import { ethers } from "ethers";
import { computePermit2AllowanceStorageSlot } from "../../../src";

describe("computePermit2AllowanceStorageSlot", () => {
	it("should compute a permit2 allowance storage slot", async () => {
		const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
		const ownerAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000";
		const spenderAddress = "0x0000000000000000000000000000000000000000";

		const permit2Contract = '0x000000000022d473030f116ddee9f6b43ac78ba3'

		const data = computePermit2AllowanceStorageSlot(ownerAddress, tokenAddress, spenderAddress);
		expect(data).toBeDefined();
		expect(data.slot).toBeDefined();
		expect(data.slot).toBe("0x31c9cad297553b4448680116a2d90c11b601cf1811034cd3bbe54da53c870184")

		const baseProvider = new ethers.providers.JsonRpcProvider(
			process.env.BASE_RPC_URL ?? "https://localhost:8545"
		);

		const valueAtStorageSlot = await baseProvider.getStorageAt(permit2Contract, data.slot)

		expect(valueAtStorageSlot).toBeDefined()
		expect(valueAtStorageSlot).toBe('0x00000000000001aa7be40acd0000000000000000000000000000000000000001')
	}, 120000);

});
