# slotseek

<a href="https://www.npmjs.com/package/@d3or/slotseek/"><img src="https://img.shields.io/npm/v/@d3or/slotseek.svg" alt="NPM version"></a>
<a href="https://twitter.com/intent/follow?screen_name=deor"><img src="https://img.shields.io/twitter/follow/deor.svg?style=social&label=Follow%20@deor" alt="Follow on Twitter" /></a>
<a href="https://github.com/d3or/slotseek/actions/workflows/test.yml"><img src="https://github.com/d3or/slotseek/actions/workflows/test.yml/badge.svg" alt="Build Status" /></a>

slotseek is a javascript library that assists with finding the storage slots for the `balanceOf` and `allowance` mappings in an ERC20 token contract, and the permit2 allowance mapping. It also provides a way to generate mock data that can be used to override the state of a contract in an `eth_call` or `eth_estimateGas` call.

The main use case for this library is to estimate gas costs of transactions that would fail if the address did not have the required balance or approval.

For example, estimating the gas a transaction will consume when swapping, before the user has approved the contract to spend their tokens.

## Features

- Find storage slots for `balanceOf` and `allowance` mappings in an ERC20 token contract, and permit2 allowance mapping
- Generates mock data that can be used to override the state of a contract in an `eth_call`/`eth_estimateGas` call
- Supports [vyper storage layouts](https://docs.vyperlang.org/en/stable/scoping-and-declarations.html#storage-layout)

## How it works

The library uses a brute force approach to find the storage slot of the `balanceOf` and `allowance` mappings in an ERC20 token contract. It does this by using a user-provided address that we know has a balance or approval, and then iterates through the storage slots of the contract via the `eth_getStorageAt` JSON-RPC method until it finds the slot where the storage value matches the user's balance or approval.

This is not a perfect method, and there are more efficient ways to find the storage slot outside of just interacting directly with the contract over RPC. But it's difficult to do so without needing to setup more tools/infra, especially for multi-chain support and gas estimation at runtime. Also, there are not many tools to help with this in javascript.

## Installation

```bash
npm install @d3or/slotseek
# or
yarn add @d3or/slotseek
```

## Optional verified-layout cache

Applications can supply any async cache implementation. slotseek does not create a
network connection or depend on a particular cache client.

```typescript
import { generateMockBalanceData, StorageLayoutCacheAdapter } from "@d3or/slotseek";

const cache: StorageLayoutCacheAdapter = {
  get: async (key) => JSON.parse((await redis.get(key)) ?? "null"),
  set: async (key, layout, ttlSeconds) => {
    await redis.set(key, JSON.stringify(layout), "EX", ttlSeconds);
  },
};

await generateMockBalanceData(provider, {
  tokenAddress,
  holderAddress,
  mockAddress,
  cache,
  chainId: 8453, // optional; otherwise resolved from provider.getNetwork()
  cacheTtlSeconds: 7 * 24 * 60 * 60,
  cacheTimeoutMs: 200,
});
```

Keys are versioned and scoped by layout kind, chain ID, and lowercased token.
Layouts verified against a positive on-chain balance or allowance are cached with
the long `cacheTtlSeconds` TTL (default 7 days). Malformed, expired, failed, or
slow cache reads are treated as misses, and cache write failures never fail slot
discovery.

### Negative caching

Failed discoveries are also cached, with a short TTL
(`negativeCacheTtlSeconds`, default 15 minutes), so repeated quotes for
unsupported tokens do not re-run the full storage probe on every call:

- Approval discovery that finds a zero allowance (reason `zero-allowance`) or
  exhausts all probes (reason `not-found`) writes a negative marker. Markers
  are keyed by `(kind, chainId, token)`, but allowance is owner/spender
  specific, so a fresh `zero-allowance` hit re-checks the current pair with a
  single `allowance()` call: if it is still zero the caller receives the
  fallback approval slot (10) with no storage probes; if it is positive the
  marker is ignored and full discovery runs for that pair.
- Balance discovery that exhausts all probes despite a positive on-chain
  balance writes a `not-found` marker, and fresh hits fail fast without RPC.
  Zero-balance outcomes are holder-specific and are never negative-cached.
- `not-found` markers record the probe budget (`maxSlots`) used; a caller
  searching more slots than the marker covered ignores it and retries.
- A search in which any storage probe rejected (rate limit, provider error) is
  treated as transient and never negative-cached.
- Negative markers carry an absolute `expiresAt` set by the writer; readers
  honor the minimum of that and their own `negativeCacheTtlSeconds`, so a
  marker never outlives its writer's TTL. After expiry, discovery runs again.
- Concurrent callers of the same discovery (same token, and same
  holder/owner/spender and probe budget) share the in-flight result, including
  failures and rejections, so a burst of identical quotes performs at most one
  probe sequence.

### Observability

Pass `onCacheEvent` to receive structured cache telemetry for wiring into
metrics or logs. Events carry `type`, `kind` (`balance` / `approval`),
`chainId`, `tokenAddress`, and (for negative outcomes) `reason`. Event types:

- `local_hit` - served from the in-process cache
- `external_hit` - served from the application-provided cache adapter
- `negative_hit` - a fresh negative marker was consumed
- `verified` - discovery succeeded and the layout was cached
- `discovery_failed` - discovery failed and a negative outcome was recorded
- `cache_error` - the external adapter threw or timed out (fail-open)

The callback may be sync or async; exceptions and rejections are swallowed.

```typescript
await generateMockApprovalData(provider, {
  ...args,
  cache,
  onCacheEvent: (event) => metrics.increment(`slotseek.cache.${event.type}`),
});
```

## TODO

- [X] Add caching options to reduce the number of RPC calls and reduce the time it takes to find the same slot again

## Example of overriding a users balance via eth_call

```javascript
import { ethers } from "ethers";
import { generateMockBalanceData } from "@d3or/slotseek";

async function fakeUserBalance() {
  // Setup - Base RPC
  const provider = new ethers.providers.JsonRpcProvider("YOUR_RPC_URL");

  // Constants
  const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // USDC on Base
  const holderAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000"; // USDC holder
  const mockAddress = ethers.Wallet.createRandom().address; // Address to fake balance for
  const mockBalanceAmount = "1000000000000"; // 1 million USDC (6 decimal places), optional. If not provided, defaults to the balance of the holder

  // Generate mock balance data
  const data = await generateMockBalanceData(provider, {
    tokenAddress,
    holderAddress,
    mockAddress,
    mockBalanceAmount,
  });

  // Prepare state diff object
  const stateDiff = {
    [tokenAddress]: {
      stateDiff: {
        [data.slot]: data.balance,
      },
    },
  };

  // Prepare balanceOf call
  const balanceOfSelector = "0x70a08231";
  const encodedAddress = ethers.utils.defaultAbiCoder
    .encode(["address"], [mockAddress])
    .slice(2);
  const getBalanceCalldata = balanceOfSelector + encodedAddress;

  // Make the eth_call with state overrides, or eth_estimateGas
  const balanceOfResponse = await provider.send("eth_call", [
    {
      from: mockAddress,
      to: tokenAddress,
      data: getBalanceCalldata,
    },
    "latest",
    stateDiff,
  ]);

  // Decode and log the result
  const balance = ethers.BigNumber.from(
    ethers.utils.defaultAbiCoder.decode(["uint256"], balanceOfResponse)[0]
  );

  console.log(
    `Mocked balance for ${mockAddress}: ${ethers.utils.formatUnits(
      balance,
      6
    )} USDC`
  );
}

fakeUserBalance().catch(console.error);
```

This can also be used to fake approvals, by using the `generateMockApprovalData` function instead of `generateMockBalanceData`.

```javascript
import { ethers } from "ethers";
import { generateMockApprovalData } from "@d3or/slotseek";

async function fakeUserApproval() {
  // Setup
  const provider = new ethers.providers.JsonRpcProvider("YOUR_RPC_URL");

  // Constants
  const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // USDC on Base
  const ownerAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000"; // USDC holder
  const spenderAddress = "0x000000000022D473030F116dDEE9F6B43aC78BA3"; // Spender address
  const mockAddress = ethers.Wallet.createRandom().address; // Address to fake balance for
  const mockApprovalAmount = "1000000000000"; // 1 million USDC (6 decimal places)

  // Generate mock approval data
  const mockApprovalData = await generateMockApprovalData(provider, {
    tokenAddress,
    ownerAddress,
    spenderAddress,
    mockAddress,
    mockApprovalAmount,
  });

  // Prepare state diff object
  const stateDiff = {
    [tokenAddress]: {
      stateDiff: {
        [mockApprovalData.slot]: mockApprovalData.approval,
      },
    },
  };

  // Function selector for allowance(address,address)
  const allowanceSelector = "0xdd62ed3e";
  // Encode the owner and spender addresses
  const encodedAddresses = ethers.utils.defaultAbiCoder
    .encode(["address", "address"], [mockAddress, spenderAddress])
    .slice(2);
  const getAllowanceCalldata = allowanceSelector + encodedAddresses;

  // Make the eth_call with state overrides, or eth_estimateGas
  const allowanceResponse = await provider.send("eth_call", [
    {
      from: mockAddress,
      to: tokenAddress,
      data: getAllowanceCalldata,
    },
    "latest",
    stateDiff,
  ]);

  // Decode and log the result
  const allowance = ethers.BigNumber.from(
    ethers.utils.defaultAbiCoder.decode(["uint256"], allowanceResponse)[0]
  );

  console.log(
    `Mocked allowance for ${mockAddress}: ${ethers.utils.formatUnits(
      allowance,
      6
    )} USDC`
  );
}

fakeUserApproval().catch(console.error);
```

You can also override both the balance and the allowance at the same time by providing both the `balance` and `approval` fields in the state diff object.

## Example of just finding the storage slot in a contract

```javascript
import { ethers } from "ethers";
import { getErc20BalanceStorageSlot } from "@d3or/slotseek";

async function findStorageSlot() {
  // Setup - Base RPC
  const provider = new ethers.providers.JsonRpcProvider(
    "https://mainnet.base.org"
  );

  // Constants
  const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // USDC on Base
  const holderAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000"; // USDC holder
  const maxSlots = 100; // Max slots to search

  // Find the storage slot for the balance of the holde
  // or for approvals, use getErc20AllowanceStorageSlot
  const { slot, balance, isVyper } = await getErc20BalanceStorageSlot(
    provider,
    tokenAddress,
    holderAddress,
    maxSlots
  );

  console.log(
    `User has balance of ${ethers.utils.formatUnits(
      balance,
      6
    )} USDC stored at slot #${Number(slot)}`
  );
}

findStorageSlot().catch(console.error);
```

## Example of mocking the permit2 allowance mapping 

```javascript
import { ethers } from "ethers";
import { computePermit2AllowanceStorageSlot } from "@d3or/slotseek";

async function findStorageSlot() {
  // Setup - Base RPC
  const provider = new ethers.providers.JsonRpcProvider(
    "https://mainnet.base.org"
  );

  // Constants
  const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // USDC on Base
  const mockAddress = "0x0000c3Caa36E2d9A8CD5269C976eDe05018f0000"; // USDC holder to mock approval for
  const spenderAddress = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"

  // Compute storage slot of where the allowance would be held
  const { slot } = computePermit2AllowanceStorageSlot(mockAddress, tokenAddress, spenderAddress)

  const permit2Contract = '0x000000000022d473030f116ddee9f6b43ac78ba3'

  // Prepare state diff object
  const stateDiff = {
    [permit2Contract]: {
      stateDiff: {
        [slot]: ethers.utils.hexZeroPad(
          ethers.utils.hexlify(ethers.BigNumber.from("1461501637330902918203684832716283019655932142975")),
          32
        )
        ,
      },
    },
  };

  // Function selector for allowance(address,address,address)
  const allowanceSelector = "0x927da105";
  // Encode the owner and spender addresses
  const encodedAddresses = ethers.utils.defaultAbiCoder
    .encode(["address", "address", "address"], [mockAddress, tokenAddress, spenderAddress])
    .slice(2);
  const getAllowanceCalldata = allowanceSelector + encodedAddresses;


  const callParams = [
    {
      to: permit2Contract,
      data: getAllowanceCalldata,
    },
    "latest",
  ];

  const allowanceResponse = await baseProvider.send("eth_call", [
    ...callParams,
    stateDiff,
  ]);

  // convert the response to a BigNumber
  const approvalAmount = ethers.BigNumber.from(
    ethers.utils.defaultAbiCoder.decode(["uint256"], allowanceResponse)[0]
  );

  console.log(
    `Mocked balance for ${mockAddress}: ${ethers.utils.formatUnits(
      approvalAmount,
      6
    )} USDC`
  );

}
findStorageSlot().catch(console.error);
```
