# slotseek

<a href="https://www.npmjs.com/package/@d3or/slotseek/"><img src="https://img.shields.io/npm/v/@d3or/slotseek.svg" alt="NPM version"></a>
<a href="https://twitter.com/intent/follow?screen_name=deor"><img src="https://img.shields.io/twitter/follow/deor.svg?style=social&label=Follow%20@deor" alt="Follow on Twitter" /></a>
<a href="https://github.com/d3or/slotseek/actions/workflows/test.yml"><img src="https://github.com/d3or/slotseek/actions/workflows/test.yml/badge.svg" alt="Build Status" /></a>

slotseek is a javascript library that assists with finding the storage slots for the `balanceOf` and `allowance` mappings in an ERC20 token contract. It also provides a way to generate mock data that can be used to override the state of a contract in an `eth_call` or `eth_estimateGas` call.

The main use case for this library is to estimate gas costs of transactions that would fail if the address did not have the required balance or approval.

For example, estimating the gas a transaction will consume when swapping, before the user has approved the contract to spend their tokens.

## Features

- Find storage slots for `balanceOf` and `allowance` mappings in an ERC20 token contract
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
