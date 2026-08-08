import { ethers } from "ethers";
import {
  approvalCache,
  balanceCache,
  generateMockBalanceData,
  getErc20ApprovalStorageSlot,
  getErc20BalanceStorageSlot,
  getStorageLayoutCacheKey,
  StorageLayoutCacheAdapter,
} from "../../src";

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

  it("skips the cached balance storage read when a mock amount is provided", async () => {
    const rpc = provider();
    const cache: StorageLayoutCacheAdapter = {
      get: jest.fn().mockResolvedValue({ slot: 3, isVyper: false, verifiedAt: Date.now() }),
      set: jest.fn(),
    };
    const storage = jest.spyOn(rpc, "getStorageAt");
    const call = jest.spyOn(rpc, "call");

    const result = await generateMockBalanceData(rpc, {
      tokenAddress: token,
      holderAddress: owner,
      mockAddress: spender,
      mockBalanceAmount: "12",
      cache,
      chainId: 1,
    });

    expect(result.balance).toBe(encoded(12));
    expect(storage).not.toHaveBeenCalled();
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

  it("caches a zero-allowance outcome and skips storage probes afterwards", async () => {
    const rpc = provider();
    const cache: StorageLayoutCacheAdapter = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn(),
    };
    const call = jest.spyOn(rpc, "call").mockResolvedValue(encoded(0));
    const storage = jest.spyOn(rpc, "getStorageAt").mockResolvedValue(zero);

    const first = await getErc20ApprovalStorageSlot(
      rpc, token, owner, spender, 2, true, { cache, chainId: 1 }
    );
    const second = await getErc20ApprovalStorageSlot(
      rpc, token, owner, spender, 2, true, { cache, chainId: 1 }
    );

    expect([first.slot, second.slot]).toEqual(["0x0a", "0x0a"]);
    // One allowance read per call (the marker is re-verified per pair), but
    // the zero-allowance fallback never probes storage.
    expect(call).toHaveBeenCalledTimes(2);
    expect(storage).not.toHaveBeenCalled();
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(
      `slotseek:v1:approval:1:${token}`,
      expect.objectContaining({ status: "unverifiable", reason: "zero-allowance" }),
      15 * 60
    );
  });

  it("serves an external negative marker with one allowance read and no probes", async () => {
    const rpc = provider();
    const cache: StorageLayoutCacheAdapter = {
      get: jest.fn().mockResolvedValue({
        status: "unverifiable",
        reason: "zero-allowance",
        failedAt: Date.now(),
      }),
      set: jest.fn(),
    };
    const call = jest.spyOn(rpc, "call").mockResolvedValue(encoded(0));
    const storage = jest.spyOn(rpc, "getStorageAt");

    const result = await getErc20ApprovalStorageSlot(
      rpc, token, owner, spender, 2, true, { cache, chainId: 1 }
    );

    expect(result.slot).toBe("0x0a");
    expect(call).toHaveBeenCalledTimes(1);
    expect(storage).not.toHaveBeenCalled();
  });

  it("ignores a zero-allowance marker for a pair with a positive allowance", async () => {
    const rpc = provider();
    const cache: StorageLayoutCacheAdapter = {
      get: jest.fn().mockResolvedValue({
        status: "unverifiable",
        reason: "zero-allowance",
        failedAt: Date.now(),
      }),
      set: jest.fn(),
    };
    jest.spyOn(rpc, "call").mockResolvedValue(encoded(11));
    jest.spyOn(rpc, "getStorageAt").mockImplementation(async (_address, position) =>
      position === approvalPosition(owner, spender, 1) ? encoded(11) : zero
    );

    const result = await getErc20ApprovalStorageSlot(
      rpc, token, owner, spender, 3, true, { cache, chainId: 1 }
    );

    // The token-global marker must not route a verifiable pair to the fallback slot.
    expect(result.slot).toBe("0x01");
    expect(result.isVyper).toBe(false);
    expect(cache.set).toHaveBeenCalledWith(
      `slotseek:v1:approval:1:${token}`,
      expect.objectContaining({ slot: 1, isVyper: false }),
      expect.any(Number)
    );
  });

  it("retries discovery after the negative TTL expires", async () => {
    const rpc = provider();
    const call = jest.spyOn(rpc, "call").mockResolvedValue(encoded(0));
    jest.spyOn(rpc, "getStorageAt").mockResolvedValue(zero);
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);

    await getErc20ApprovalStorageSlot(rpc, token, owner, spender, 2, true, {
      chainId: 1,
      negativeCacheTtlSeconds: 60,
    });
    now.mockReturnValue(1_000_000 + 61 * 1000);
    await getErc20ApprovalStorageSlot(rpc, token, owner, spender, 2, true, {
      chainId: 1,
      negativeCacheTtlSeconds: 60,
    });

    expect(call).toHaveBeenCalledTimes(2);
  });

  it("caches a failed balance discovery and fails fast afterwards", async () => {
    const rpc = provider();
    const cache: StorageLayoutCacheAdapter = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn(),
    };
    const call = jest.spyOn(rpc, "call").mockResolvedValue(encoded(9));
    const storage = jest.spyOn(rpc, "getStorageAt").mockResolvedValue(zero);

    await expect(
      getErc20BalanceStorageSlot(rpc, token, owner, 2, { cache, chainId: 1 })
    ).rejects.toThrow("Unable to find balance slot");
    const probesAfterDiscovery = storage.mock.calls.length;
    await expect(
      getErc20BalanceStorageSlot(rpc, token, owner, 2, { cache, chainId: 1 })
    ).rejects.toThrow("Unable to find balance slot");

    expect(call).toHaveBeenCalledTimes(1);
    expect(storage).toHaveBeenCalledTimes(probesAfterDiscovery);
    expect(cache.set).toHaveBeenCalledWith(
      `slotseek:v1:balance:1:${token}`,
      expect.objectContaining({ status: "unverifiable", reason: "not-found" }),
      15 * 60
    );
  });

  it("does not cache a zero-balance holder outcome", async () => {
    const rpc = provider();
    const cache: StorageLayoutCacheAdapter = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn(),
    };
    const call = jest.spyOn(rpc, "call").mockResolvedValue(encoded(0));

    await expect(
      getErc20BalanceStorageSlot(rpc, token, owner, 2, { cache, chainId: 1 })
    ).rejects.toThrow("User has no balance");
    await expect(
      getErc20BalanceStorageSlot(rpc, token, owner, 2, { cache, chainId: 1 })
    ).rejects.toThrow("User has no balance");

    expect(call).toHaveBeenCalledTimes(2);
    expect(cache.set).not.toHaveBeenCalled();
    expect(balanceCache.size).toBe(0);
  });

  it("shares a failed discovery with concurrent callers instead of re-probing", async () => {
    const rpc = provider();
    const call = jest.spyOn(rpc, "call").mockResolvedValue(encoded(0));
    const storage = jest.spyOn(rpc, "getStorageAt");

    const results = await Promise.allSettled([
      getErc20BalanceStorageSlot(rpc, token, owner, 4, { chainId: 1 }),
      getErc20BalanceStorageSlot(rpc, token, owner, 4, { chainId: 1 }),
    ]);

    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(call).toHaveBeenCalledTimes(1);
    expect(storage).not.toHaveBeenCalled();
  });

  it("emits cache observability events", async () => {
    const rpc = provider();
    const events: Array<{ type: string; reason?: string }> = [];
    const onCacheEvent = (event: { type: string; reason?: string }) => {
      events.push({ type: event.type, reason: event.reason });
    };
    jest.spyOn(rpc, "call").mockResolvedValue(encoded(0));
    jest.spyOn(rpc, "getStorageAt").mockResolvedValue(zero);

    await getErc20ApprovalStorageSlot(
      rpc, token, owner, spender, 2, true, { chainId: 1, onCacheEvent }
    );
    await getErc20ApprovalStorageSlot(
      rpc, token, owner, spender, 2, true, { chainId: 1, onCacheEvent }
    );

    expect(events).toEqual([
      { type: "discovery_failed", reason: "zero-allowance" },
      { type: "negative_hit", reason: "zero-allowance" },
    ]);
  });

  it("does not negative-cache a search with rejected probes", async () => {
    const rpc = provider();
    const cache: StorageLayoutCacheAdapter = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn(),
    };
    const call = jest.spyOn(rpc, "call").mockResolvedValue(encoded(9));
    const storage = jest.spyOn(rpc, "getStorageAt")
      .mockRejectedValue(new Error("rate limited"));

    await expect(
      getErc20BalanceStorageSlot(rpc, token, owner, 2, { cache, chainId: 1 })
    ).rejects.toThrow("Unable to find balance slot");
    const probesAfterFirst = storage.mock.calls.length;
    await expect(
      getErc20BalanceStorageSlot(rpc, token, owner, 2, { cache, chainId: 1 })
    ).rejects.toThrow("Unable to find balance slot");

    // The transient failure is retried, not served from a poisoned negative cache.
    expect(call).toHaveBeenCalledTimes(2);
    expect(storage.mock.calls.length).toBe(probesAfterFirst * 2);
    expect(cache.set).not.toHaveBeenCalled();
    expect(balanceCache.size).toBe(0);
  });

  it("re-runs a not-found discovery when the caller searches more slots", async () => {
    const rpc = provider();
    const call = jest.spyOn(rpc, "call").mockResolvedValue(encoded(9));
    const storage = jest.spyOn(rpc, "getStorageAt").mockImplementation(
      async (_address, position) =>
        position === balancePosition(owner, 3) ? encoded(9) : zero
    );

    await expect(
      getErc20BalanceStorageSlot(rpc, token, owner, 2, { chainId: 1 })
    ).rejects.toThrow("Unable to find balance slot");
    const result = await getErc20BalanceStorageSlot(rpc, token, owner, 6, { chainId: 1 });

    // The maxSlots=2 marker must not suppress the deeper maxSlots=6 search.
    expect(result.slot).toBe("0x03");
    expect(call).toHaveBeenCalledTimes(2);
    expect(storage.mock.calls.length).toBeGreaterThan(4);
  });

  it("never extends an external negative marker past its writer's TTL", async () => {
    const rpc = provider();
    const now = Date.now();
    // Written by a process configured with a 60s negative TTL, 2 minutes ago.
    const cache: StorageLayoutCacheAdapter = {
      get: jest.fn().mockResolvedValue({
        status: "unverifiable",
        reason: "not-found",
        failedAt: now - 2 * 60 * 1000,
        expiresAt: now - 60 * 1000,
        maxSlots: 2,
      }),
      set: jest.fn(),
    };
    const call = jest.spyOn(rpc, "call").mockResolvedValue(encoded(9));
    jest.spyOn(rpc, "getStorageAt").mockImplementation(async (_address, position) =>
      position === balancePosition(owner, 0) ? encoded(9) : zero
    );

    // A reader with the default 15-minute TTL must treat the marker as expired.
    const result = await getErc20BalanceStorageSlot(rpc, token, owner, 2, {
      cache,
      chainId: 1,
    });

    expect(result.slot).toBe("0x00");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("propagates the leader's rejection to concurrent waiters and retries after", async () => {
    const rpc = provider();
    const call = jest.spyOn(rpc, "call")
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValue(encoded(9));
    jest.spyOn(rpc, "getStorageAt").mockImplementation(async (_address, position) =>
      position === balancePosition(owner, 0) ? encoded(9) : zero
    );

    const results = await Promise.allSettled([
      getErc20BalanceStorageSlot(rpc, token, owner, 2, { chainId: 1 }),
      getErc20BalanceStorageSlot(rpc, token, owner, 2, { chainId: 1 }),
    ]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect((results[0] as PromiseRejectedResult).reason.message).toContain("provider down");
    expect((results[1] as PromiseRejectedResult).reason.message).toContain("provider down");
    expect(call).toHaveBeenCalledTimes(1);

    // The failed in-flight discovery is not sticky; the next call succeeds.
    const retried = await getErc20BalanceStorageSlot(rpc, token, owner, 2, { chainId: 1 });
    expect(retried.slot).toBe("0x00");
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
