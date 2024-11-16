import { computePermit2AllowanceStorageSlot } from "../../../src";

describe("computePermit2AllowanceStorageSlot", () => {
	it("should compute a permit2 allowance storage slot", () => {
		const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
		const ownerAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000";
		const spenderAddress = "0x3e34b27a9bf37D8424e1a58aC7fc4D06914B76B9";

		const data = computePermit2AllowanceStorageSlot(ownerAddress, tokenAddress, spenderAddress);
		expect(data).toBeDefined();
		expect(data.slot).toBeDefined();
		expect(data.slot).toBe("0x661d04a618eb4f8048d934a2379f8d7627537668a69b0c43512058a631e31c57")
	}, 30000);

});
