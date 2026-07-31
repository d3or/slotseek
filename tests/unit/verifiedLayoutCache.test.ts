import { ethers } from "ethers";
import {
  approvalCache,
  balanceCache,
  getErc20ApprovalStorageSlot,
  getErc20BalanceStorageSlot,
  getStorageLayoutCacheKey,
  StorageLayoutCacheAdapter,
  StorageLayoutCacheValue,
} from "../../src";
import { missingLayoutCache } from "../../src/cache";

const token = "0x1111111111111111111111111111111111111111";
const owner = "0x2222222222222222222222222222222222222222";
const spender = "0x3333333333333333333333333333333333333333";
const zero = ethers.constants.HashZero;
const encoded = (value: number) =>
  ethers.utils.defaultAbiCoder.encode(["uint256"], [value]);

const balancePosition = (address: string, slot: number, vyper = false) =>
  vyper
    ? ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
      ["uint256", "address"], [slot, address]
    ))
    : ethers.utils.solidityKeccak256(["uint256", "uint256"], [address, slot]);

const approvalPosition = (
  ownerAddress: string,
  spenderAddress: string,
  slot: number,
  vyper = false
) => {
  const inner = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
    vyper ? ["uint256", "address"] : ["address", "uint256"],
    vyper ? [slot, ownerAddress] : [ownerAddress, slot]
  ));
  return ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
    vyper ? ["bytes32", "address"] : ["address", "bytes32"],
    vyper ? [inner, spenderAddress] : [spenderAddress, inner]
  ));
};

const provider = () => {
  const instance = new ethers.providers.JsonRpcProvider();
  jest.spyOn(instance, "getNetwork").mockResolvedValue({
    chainId: 1,
    name: "test",
  });
  return instance;
};

describe("verified storage layout caching", () => {
  beforeEach(() => {
    balanceCache.clear();
    approvalCache.clear();
    missingLayoutCache.clear();
    jest.restoreAllMocks();
  });

  it("builds chain-aware, kind-aware, lowercased versioned keys", () => {
    expect(getStorageLayoutCacheKey("balance", 1, token.toUpperCase()))
      .toBe(`slotseek:v1:balance:1:${token}`);
    expect(getStorageLayoutCacheKey("approval", 8453, token))
      .toBe(`slotseek:v1:approval:8453:${token}`);
  });

  it("uses a warm external balance layout with only the required storage read", async () => {
    const rpc = provider();
    const cache: StorageLayoutCacheAdapter = {
      get: jest.fn().mockResolvedValue({ slot: 3, isVyper: false, verifiedAt: Date.now() }),
      set: jest.fn(),
    };
    const storage = jest.spyOn(rpc, "getStorageAt").mockResolvedValue(encoded(12));
    const call = jest.spyOn(rpc, "call");

    const result = await getErc20BalanceStorageSlot(rpc, token, owner, 10, {
      cache,
      chainId: 1,
    });

    expect(result.balance.toNumber()).toBe(12);
    expect(storage).toHaveBeenCalledTimes(1);
    expect(call).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent verified cold discovery", async () => {
    const rpc = provider();
    const call = jest.spyOn(rpc, "call").mockResolvedValue(encoded(9));
    const storage = jest.spyOn(rpc, "getStorageAt").mockImplementation(async (_address, position) =>
      position === balancePosition(owner, 1) ? encoded(9) : zero
    );

    const [first, second] = await Promise.all([
      getErc20BalanceStorageSlot(rpc, token, owner, 4, { chainId: 1 }),
      getErc20BalanceStorageSlot(rpc, token, owner, 4, { chainId: 1 }),
    ]);

    expect(first.slot).toBe("0x01");
    expect(second.slot).toBe("0x01");
    expect(call).toHaveBeenCalledTimes(1);
    expect(storage).toHaveBeenCalledTimes(5);
  });

  it("isolates the same token address across chains", async () => {
    const cache: StorageLayoutCacheAdapter = {
      get: jest.fn().mockImplementation(async (key: string) => ({
        slot: key.includes(":1:") ? 1 : 2,
        isVyper: false,
        verifiedAt: Date.now(),
      })),
      set: jest.fn(),
    };
    const ethereum = provider();
    const base = provider();
    jest.spyOn(ethereum, "getStorageAt").mockResolvedValue(encoded(1));
    jest.spyOn(base, "getStorageAt").mockResolvedValue(encoded(2));

    const [ethereumLayout, baseLayout] = await Promise.all([
      getErc20BalanceStorageSlot(ethereum, token, owner, 3, { cache, chainId: 1 }),
      getErc20BalanceStorageSlot(base, token, owner, 3, { cache, chainId: 8453 }),
    ]);

    expect(ethereumLayout.slot).toBe("0x01");
    expect(baseLayout.slot).toBe("0x02");
    expect(cache.get).toHaveBeenCalledWith(`slotseek:v1:balance:1:${token}`);
    expect(cache.get).toHaveBeenCalledWith(`slotseek:v1:balance:8453:${token}`);
  });

  it("honors a shorter TTL from a later caller", async () => {
    const rpc = provider();
    const call = jest.spyOn(rpc, "call").mockResolvedValue(encoded(9));
    jest.spyOn(rpc, "getStorageAt").mockImplementation(async (_address, position) =>
      position === balancePosition(owner, 0) ? encoded(9) : zero
    );
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);

    await getErc20BalanceStorageSlot(rpc, token, owner, 2, {
      chainId: 1,
      cacheTtlSeconds: 7 * 24 * 60 * 60,
    });
    now.mockReturnValue(1_000_000 + 2 * 60 * 60 * 1000);
    await getErc20BalanceStorageSlot(rpc, token, owner, 2, {
      chainId: 1,
      cacheTtlSeconds: 60 * 60,
    });

    expect(call).toHaveBeenCalledTimes(2);
  });

  it("uses the zero-allowance fallback without reading storage or caching it", async () => {
    const rpc = provider();
    const cache: StorageLayoutCacheAdapter = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn(),
    };
    const call = jest.spyOn(rpc, "call").mockResolvedValue(encoded(0));
    const storage = jest.spyOn(rpc, "getStorageAt").mockResolvedValue(zero);

    const results = await Promise.all([
      getErc20ApprovalStorageSlot(rpc, token, owner, spender, 2, true, { cache, chainId: 1 }),
      getErc20ApprovalStorageSlot(rpc, token, owner, spender, 2, true, { cache, chainId: 1 }),
    ]);

    expect(results.map((result) => result.slot)).toEqual(["0x0a", "0x0a"]);
    expect(call).toHaveBeenCalledTimes(2);
    expect(storage).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
    expect(approvalCache.size).toBe(0);
  });

  it("shares and negative-caches failed balance discovery", async () => {
    const rpc = provider();
    let cached: StorageLayoutCacheValue | undefined;
    const cache: StorageLayoutCacheAdapter = {
      get: jest.fn().mockImplementation(async () => cached),
      set: jest.fn().mockImplementation(async (_key, value) => {
        cached = value;
      }),
    };
    const call = jest.spyOn(rpc, "call").mockResolvedValue(encoded(9));
    const storage = jest.spyOn(rpc, "getStorageAt").mockResolvedValue(zero);

    const results = await Promise.allSettled([
      getErc20BalanceStorageSlot(rpc, token, owner, 2, { cache, chainId: 1 }),
      getErc20BalanceStorageSlot(rpc, token, owner, 2, { cache, chainId: 1 }),
    ]);

    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(call).toHaveBeenCalledTimes(1);
    expect(storage).toHaveBeenCalledTimes(4);
    expect(cache.set).toHaveBeenCalledWith(
      `slotseek:v1:balance:1:${token}:missing`,
      expect.objectContaining({ maxSlots: 2 }),
      5 * 60
    );

    missingLayoutCache.clear();
    await expect(getErc20BalanceStorageSlot(
      rpc, token, owner, 2, { cache, chainId: 1 }
    )).rejects.toThrow("Unable to find balance slot");
    expect(call).toHaveBeenCalledTimes(1);
    expect(storage).toHaveBeenCalledTimes(4);
  });

  it("negative-caches failed positive-allowance discovery", async () => {
    const rpc = provider();
    let cached: StorageLayoutCacheValue | undefined;
    const cache: StorageLayoutCacheAdapter = {
      get: jest.fn().mockImplementation(async () => cached),
      set: jest.fn().mockImplementation(async (_key, value) => {
        cached = value;
      }),
    };
    const call = jest.spyOn(rpc, "call").mockResolvedValue(encoded(7));
    const storage = jest.spyOn(rpc, "getStorageAt").mockResolvedValue(zero);

    await expect(getErc20ApprovalStorageSlot(
      rpc, token, owner, spender, 2, false, { cache, chainId: 1 }
    )).rejects.toThrow("Approval does not exist");
    expect(storage).toHaveBeenCalledTimes(4);

    missingLayoutCache.clear();
    await expect(getErc20ApprovalStorageSlot(
      rpc, token, owner, spender, 2, false, { cache, chainId: 1 }
    )).rejects.toThrow("Unable to find approval slot");
    expect(call).toHaveBeenCalledTimes(1);
    expect(storage).toHaveBeenCalledTimes(4);
  });

  it("retries discovery after a negative cache entry expires", async () => {
    const rpc = provider();
    let now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    let cached: StorageLayoutCacheValue | undefined = {
      missingAt: now,
      maxSlots: 2,
    };
    const cache: StorageLayoutCacheAdapter = {
      get: jest.fn().mockImplementation(async () => cached),
      set: jest.fn().mockImplementation(async (_key, value) => {
        cached = value;
      }),
    };
    const call = jest.spyOn(rpc, "call").mockResolvedValue(encoded(9));
    const storage = jest.spyOn(rpc, "getStorageAt").mockImplementation(
      async (_address, position) => position === balancePosition(owner, 0)
        ? encoded(9)
        : zero
    );

    await expect(getErc20BalanceStorageSlot(
      rpc, token, owner, 2, { cache, chainId: 1 }
    )).rejects.toThrow("Unable to find balance slot");
    expect(call).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();

    now += 5 * 60 * 1000 + 1;
    const result = await getErc20BalanceStorageSlot(
      rpc, token, owner, 2, { cache, chainId: 1 }
    );
    expect(result.slot).toBe("0x00");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a negative entry from a shallower search", async () => {
    const rpc = provider();
    const cache: StorageLayoutCacheAdapter = {
      get: jest.fn().mockResolvedValue({
        missingAt: Date.now(),
        maxSlots: 2,
      }),
      set: jest.fn(),
    };
    jest.spyOn(rpc, "call").mockResolvedValue(encoded(9));
    jest.spyOn(rpc, "getStorageAt").mockImplementation(
      async (_address, position) => position === balancePosition(owner, 10)
        ? encoded(9)
        : zero
    );

    const result = await getErc20BalanceStorageSlot(
      rpc, token, owner, 12, { cache, chainId: 1 }
    );
    expect(result.slot).toBe("0x0a");
  });

  it("tolerates an individual rejected storage read", async () => {
    const rpc = provider();
    jest.spyOn(rpc, "call").mockResolvedValue(encoded(7));
    jest.spyOn(rpc, "getStorageAt").mockImplementation(async (_address, position) => {
      if (position === balancePosition(owner, 0)) throw new Error("single read failed");
      return position === balancePosition(owner, 1) ? encoded(7) : zero;
    });

    const result = await getErc20BalanceStorageSlot(rpc, token, owner, 3, { chainId: 1 });
    expect(result.slot).toBe("0x01");
  });

  it("does not negative-cache an incomplete discovery with rejected reads", async () => {
    const rpc = provider();
    const cache: StorageLayoutCacheAdapter = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn(),
    };
    jest.spyOn(rpc, "call").mockResolvedValue(encoded(7));
    jest.spyOn(rpc, "getStorageAt").mockRejectedValue(new Error("RPC unavailable"));

    await expect(getErc20BalanceStorageSlot(
      rpc, token, owner, 2, { cache, chainId: 1 }
    )).rejects.toThrow("Unable to verify balance layout");
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("still tries the approval fallback after an incomplete primary search", async () => {
    const rpc = provider();
    jest.spyOn(rpc, "call").mockResolvedValue(encoded(7));
    jest.spyOn(rpc, "getStorageAt").mockImplementation(
      async (_address, position) => {
        if (position === approvalPosition(owner, spender, 10)) return encoded(7);
        throw new Error("RPC unavailable");
      }
    );

    const result = await getErc20ApprovalStorageSlot(
      rpc, token, owner, spender, 2, true, { chainId: 1 }
    );
    expect(result.slot).toBe("0x0a");
  });

  it("caps aggregate storage probes at eight across tokens", async () => {
    let active = 0;
    let peak = 0;
    const discoveries = Array.from({ length: 6 }, (_, index) => {
      const rpc = provider();
      jest.spyOn(rpc, "call").mockResolvedValue(encoded(5));
      jest.spyOn(rpc, "getStorageAt").mockImplementation(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return zero;
      });
      const address = `0x${(index + 10).toString(16).padStart(40, "0")}`;
      return getErc20BalanceStorageSlot(rpc, address, owner, 4, { chainId: 1 });
    });

    await Promise.allSettled(discoveries);
    expect(peak).toBeLessThanOrEqual(8);
    expect(peak).toBe(8);
  });

  it.each(["error", "timeout"])("fails open on adapter read %s", async (mode) => {
    const rpc = provider();
    const get = mode === "error"
      ? jest.fn().mockRejectedValue(new Error("cache unavailable"))
      : jest.fn().mockReturnValue(new Promise(() => {}));
    const cache: StorageLayoutCacheAdapter = { get, set: jest.fn() };
    jest.spyOn(rpc, "call").mockResolvedValue(encoded(4));
    jest.spyOn(rpc, "getStorageAt").mockImplementation(async (_address, position) =>
      position === balancePosition(owner, 0) ? encoded(4) : zero
    );

    const result = await getErc20BalanceStorageSlot(rpc, token, owner, 2, {
      cache,
      chainId: 1,
      cacheTimeoutMs: 5,
    });
    expect(result.slot).toBe("0x00");
  });

  it.each(["error", "timeout"])("fails open on adapter write %s", async (mode) => {
    const rpc = provider();
    const set = mode === "error"
      ? jest.fn().mockRejectedValue(new Error("cache unavailable"))
      : jest.fn().mockReturnValue(new Promise(() => {}));
    const cache: StorageLayoutCacheAdapter = {
      get: jest.fn().mockResolvedValue(undefined),
      set,
    };
    jest.spyOn(rpc, "call").mockResolvedValue(encoded(4));
    jest.spyOn(rpc, "getStorageAt").mockImplementation(async (_address, position) =>
      position === balancePosition(owner, 0) ? encoded(4) : zero
    );

    const result = await getErc20BalanceStorageSlot(rpc, token, owner, 2, {
      cache,
      chainId: 1,
      cacheTimeoutMs: 5,
    });
    expect(result.slot).toBe("0x00");
  });

  it("stores and reuses the Vyper approval flag correctly", async () => {
    const rpc = provider();
    jest.spyOn(rpc, "call").mockResolvedValue(encoded(11));
    const storage = jest.spyOn(rpc, "getStorageAt").mockImplementation(
      async (_address, position) => position === approvalPosition(owner, spender, 1, true)
        ? encoded(11)
        : zero
    );

    const first = await getErc20ApprovalStorageSlot(
      rpc, token, owner, spender, 3, false, { chainId: 1 }
    );
    const readsAfterDiscovery = storage.mock.calls.length;
    const second = await getErc20ApprovalStorageSlot(
      rpc, token, owner, spender, 3, false, { chainId: 1 }
    );

    expect(first.isVyper).toBe(true);
    expect(second.isVyper).toBe(true);
    expect(storage).toHaveBeenCalledTimes(readsAfterDiscovery);
  });
});
