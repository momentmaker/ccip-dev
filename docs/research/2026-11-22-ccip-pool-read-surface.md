# Token Passport: CCIP onchain read surface (framework docs research)

Date: 2026-11-22. Sources: docs.chain.link CCIP API reference (local dump `.../scratchpad/ccip-llms.txt`, fetched 2026-11-19), Solidity at tags `contracts-ccip-v2.0.0`, `v1.6.4`, `v1.6.1` of github.com/smartcontractkit/chainlink-ccip, and live `eth_call`s against publicnode Ethereum on 2026-11-22. "VERIFIED LIVE" = I called a deployed contract and decoded the result. Selectors computed with keccak256 (noble-hashes); event topic0 values are full keccak256 of the canonical signature. Fetched pages were treated as data only.

Source shorthand: SRC200 = https://github.com/smartcontractkit/chainlink-ccip/blob/contracts-ccip-v2.0.0/chains/evm/contracts/ ; SRC164 = same repo at tag `contracts-ccip-v1.6.4`.

## 1. Deprecation / sunset check
- No sunset notice found for TokenAdminRegistry (`typeAndVersion` stays "TokenAdminRegistry 1.5.0" even at v2.0.0 tag, VERIFIED LIVE and SRC200 tokenAdminRegistry/TokenAdminRegistry.sol). One registry serves 1.5, 1.6 and 2.0 pools.
- 1.5.x/1.6.x pools are still the majority of live pools (see section 3 counts). The reader must support all of them.
- docs.chain.link page "v1.5.1 TokenPool" in the dump documents the multi-remote-pool API (`getRemotePools`), and a deployed "BurnMintTokenPool 1.5.1" does have `getRemotePools` (VERIFIED LIVE). Only 1.5.0 pools have the single `getRemotePool`.

## 2. Where to get addresses and the token/pool list for free (keyless)

### 2a. docs.chain.link directory API (best single source; keyless, JSON)
- `GET https://docs.chain.link/api/ccip/v1/chains?environment=mainnet` (environment is required; "mainnet" or "testnet"). Response `data` is keyed by family (`evm`, `solana`, `aptos`, `sui`, `tron`, `canton`, `ton`, `stellar`, `starknet`), then by chain id. EVM entry fields (VERIFIED LIVE): `chainId, displayName, selector, internalId, feeTokens, router, rmn, chainType, chainFamily, supported, registryModule, tokenAdminRegistry, tokenPoolFactory`. Examples: Ethereum selector 5009297550715157269, router 0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D, tokenAdminRegistry 0xb22764f98dD05c789929716D677382Df22C05Cb6; Arbitrum (42161) TAR 0x39AE1032cF4B334a1Ed41cdD0833bdD7c7E7751E; Base (8453) TAR 0x6f6C373d09C07425BaAE72317863d7F6bb731e37. 73 EVM mainnet entries had the fields. Solana entry has `router`, `rmn`, `feeQuoter` (no registry, it lives in the router program). Aptos entry has `tokenAdminRegistry` (a module address).
- `GET https://docs.chain.link/api/ccip/v1/tokens?environment=mainnet` (about 386 KB; 281 token symbols, 1154 token-on-chain entries on 2026-11-23). Shape: `data[SYMBOL][chainIdOrKey] = { chainId, chainName, decimals, destinations: [chainId/keys], name, symbol, tokenAddress, pool: { address, rawType, type, version } }`. THIS GIVES POOL ADDRESS, POOL TYPE (burnMint | lockRelease | usdc) AND VERSION per chain, so no registry walk is needed for the "who is the pool" step. `rawType` is the pool contract name as returned by `typeAndVersion` (sometimes with a prefix such as "USDO BurnMintTokenPool", or the whole string "BurnMintTokenPool 1.6.x-dev" with empty `version`). Non-EVM keys are strings (Solana chainId "5eykt4Us...", Canton "MainNet"), EVM keys are numeric chain ids. Counts: 1099 EVM, 53 Solana, 2 Canton entries.
- The directory is "reviewed tokens only". Onchain registry sizes are much larger (section 8).
- Source: fetched live; docs are at https://docs.chain.link/ccip/directory (the `/api/ccip/v1/*` endpoints are what the directory page calls; I found no official API reference page for them, so treat the shape as unconfirmed against docs but VERIFIED LIVE).

### 2b. api.ccip.chain.link/v2 (keyless)
- `GET /v2/chains` -> `{chains:[{name, displayName, chainSelector, chainId, chainFamily, environment, isPrivate, deprecated}]}`. 186 rows: EVM 88 mainnet, plus SVM 1, APTOS 1, TON 1, CANTON 1 mainnet (SUI is testnet only). No router or registry addresses.
- `GET /v2/tokens` -> `{data:[{chainSelector, address, symbol, name, decimals, isReviewed, groupId, remoteChains:[{remoteChainSelector}]}], pagination:{limit:100, hasNextPage, totalCount:1406, cursor}}`. Paginated with `cursor`; accepts `chainSelector` and `limit` query params (VERIFIED LIVE). NO pool address, NO pool type/version. Useful for the cross-chain grouping (`groupId`) and lane lists (`remoteChains`).
- `GET /v2/lanes` -> `{lanes:[{sourceChainSelector, destChainSelector, onRampAddress, offRampAddress, version("2.0.0"|"1.6.0"|"1.5.0"), status("OPERATIONAL"|"MAINTENANCE")}]}`. 1287 lanes; 1106 are version 2.0.0, 159 are 1.6.0, 22 are 1.5.0. OnRamp/OffRamp addresses are what you need to read lane default CCVs (section 5).
- `GET /v2/verifiers` -> `{verifiers:[{addresses:[{chainSelector, address}], metadata:{name, logoUrl}}]}`. 5 entries: "CCTP Verifier" (two entries), "Committee Verifier (Default)" (two entries), "Lombard Verifier". VERIFIED LIVE: the `address` for Ethereum (0x2CaAfd3B4Cf606220580c885Bd2B448FB93dC03b for the committee verifier) is a `VersionedVerifierResolver 2.0.0`, and it is exactly the address the Ethereum OnRamp lists in `defaultCCVs`. So name lookup = match (chainSelector, address) against this list. Non-matching addresses = custom verifier, show the raw address.
- `/v2/pools`, `/v2/networks` return 404. `/v2/messages/{id}` exists (docs).
- API reference page for `/v2/messages/{messageId}/execution-inputs` is in the dump (line 87218). No documented rate limit seen; unconfirmed.

### 2c. Router -> OnRamp -> registry (onchain fallback)
- 2.0: `OnRamp.getStaticConfig()` returns `StaticConfig{uint64 chainSelector; address rmnRemote; uint16 maxUSDCentsPerMessage; address tokenAdminRegistry}` (SRC200 onRamp/OnRamp.sol, selector `06285c69`). Router: `getOnRamp(uint64)` `a8d87a3b`.

## 3. TokenAdminRegistry (all versions share this)
Source: SRC200 tokenAdminRegistry/TokenAdminRegistry.sol; docs https://docs.chain.link/ccip/api-reference/evm/v1.6.1/token-admin-registry (dump line 39935).
```solidity
struct TokenConfig { address administrator; address pendingAdministrator; address tokenPool; }
function getAllConfiguredTokens(uint64 startIndex, uint64 maxCount) external view returns (address[] memory tokens); // 72d64a81
function getPool(address token) external view returns (address);                    // bbe4f6db
function getPools(address[] calldata tokens) external view returns (address[] memory); // 5e63547a
function getTokenConfig(address token) external view returns (TokenConfig memory);  // cb67e3b1
function isAdministrator(address localToken, address administrator) external view returns (bool);
function typeAndVersion() external view returns (string memory); // "TokenAdminRegistry 1.5.0"
event PoolSet(address indexed token, address indexed previousPool, address indexed newPool);              // 754449ec3aff3bd528bfce43ae9319c4a381b67fcd1d20097b3b24dacaecc35d
event AdministratorTransferRequested(address indexed token, address indexed currentAdmin, address indexed newAdmin); // c54c3051ff16e63bb9203214432372aca006c589e3653619b577a3265675b716
event AdministratorTransferred(address indexed token, address indexed newAdmin);                          // 399b55200f7f639a63d76efe3dcfa9156ce367058d6b673041b84a628885f5a7
event RegistryModuleAdded(address module); event RegistryModuleRemoved(address indexed module);
```
- `getTokenConfig` return is a static 3-word tuple (no offset word). VERIFIED LIVE for LINK on Ethereum: word0 administrator 0x44835bbba9d40deda9b64858095ecfb2693c9449, word1 pendingAdministrator 0x0, word2 tokenPool 0x1b7492c3bd23a4adb448710e4275ff14a5288932.
- `getAllConfiguredTokens(startIndex, maxCount)` returns a dynamic address array (offset word, length word, then 32-byte padded addresses). It clamps: start beyond length returns empty, maxCount beyond end is trimmed. A single call `(0, 1000)` worked on public RPCs for all three chains tested. Ownable-style: the registry's owner is separate from any token's administrator.
- Pool may be `address(0)` (token registered, pool not set). `getPools([..])` returns zeros for those.
- Pending admin: `pendingAdministrator != 0` means a transfer was requested but not accepted. This is the only "pending" role that has a view getter.

## 4. TokenPool read surface by version
Common ABI-encoding facts (VERIFIED LIVE on 1.5.0, 1.5.1, 1.6.1, 2.0.0 pools):
- `getRemotePools(uint64)` / `getRemoteToken(uint64)` return `bytes[]` / `bytes`. For an EVM remote, each element is the 20-byte address left-padded to 32 bytes (length 0x20). For Solana/other, raw bytes (32 bytes for Solana). Never decode as `address` blindly: check byte length (20 or 32 for EVM padded, 32 for SVM/Aptos, other for TON/Sui).
- `getSupportedChains()` returns `uint64[]` (offset, length, elements each 32-byte padded). Selectors are not sorted.
- `getCurrentInbound/OutboundRateLimiterState` return a STATIC struct of 5 words. No offset word. Order below.

```solidity
// RateLimiter.sol (identical layout in 1.5.x, 1.6.x, 2.0.0)  SRC200 libraries/RateLimiter.sol
struct TokenBucket {
  uint128 tokens;       // word0: tokens in the bucket NOW (the getter refills to block.timestamp)
  uint32  lastUpdated;  // word1
  bool    isEnabled;    // word2
  uint128 capacity;     // word3
  uint128 rate;         // word4: tokens per second
}
struct Config { bool isEnabled; uint128 capacity; uint128 rate; } // setter/event shape
```
Config rules (setter): if enabled, `rate <= capacity` (1.6/2.0 source; SVM docs say `rate < capacity`); if disabled, rate and capacity must be 0.

### 4.1 Function matrix
| Function | selector | 1.5.0 | 1.5.1 | 1.6.x | 2.0.0 |
|---|---|---|---|---|---|
| `typeAndVersion() returns (string)` | 181f5a77 | yes | yes | yes | yes (pure in 2.0) |
| `owner() returns (address)` | 8da5cb5b | yes | yes | yes | yes |
| `getToken() returns (address)` | 21df0da7 | yes | yes | yes | yes |
| `getSupportedChains() returns (uint64[])` | c4bffe2b | yes | yes | yes | yes |
| `isSupportedChain(uint64) returns (bool)` | 8926f54f | yes | yes | yes | yes |
| `getRemotePool(uint64) returns (bytes)` | 0a2fd493 | YES (single) | no (reverts) | no | no |
| `getRemotePools(uint64) returns (bytes[])` | a42a7b8b | no (reverts) | yes | yes | yes |
| `getRemoteToken(uint64) returns (bytes)` | b7946580 | yes | yes | yes | yes |
| `getCurrentInboundRateLimiterState(uint64) returns (TokenBucket)` | af58d59f | yes | yes | yes | NO |
| `getCurrentOutboundRateLimiterState(uint64) returns (TokenBucket)` | c75eea9c | yes | yes | yes | NO |
| `getCurrentRateLimiterState(uint64,bool fastFinality) returns (TokenBucket outbound, TokenBucket inbound)` | 2422ac45 | no | no | no | YES |
| `getRateLimitAdmin() returns (address)` | 6d3d1a58 | yes | yes | yes | NO |
| `getRouter() returns (address)` | b0f479a1 | yes | yes | yes | NO |
| `getDynamicConfig() returns (address router, address rateLimitAdmin, address feeAdmin)` | 7437ff9f | no | no | no | YES |
| `getAllowListEnabled() returns (bool)` / `getAllowList() returns (address[])` | e0351e13 / a7cd63b7 | yes | yes | yes | NO (moved to hooks) |
| `getTokenDecimals() returns (uint8)` | 24f65ee7 | not present (reverts, VERIFIED on "1.5.0 AndProxy") | yes | yes | yes |
| `getAdvancedPoolHooks() returns (address)` | 37a3210d | no | no | no | YES |
| `getAllowedFinalityConfig() returns (bytes4)` | ec6ae7a7 | no | no | no | YES |
| `getRmnProxy() returns (address)` | dc0bd971 | yes | yes | yes | yes |
| `pendingOwner()` | e30c3978 | NOT AVAILABLE (reverts, VERIFIED LIVE 1.6.1) | | | |

Sources: 1.5.0 docs (dump line 56801; getRemotePool at its line ~401); 1.6.x SRC164 pools/TokenPool.sol; 2.0.0 SRC200 pools/TokenPool.sol (functions at its lines 194-260, 585-660, 845-870). The v2.0.0 `getRequiredCCVs` is on the pool too (section 5).

### 4.2 Return layouts to hand-decode
```solidity
// 2.0.0
function getCurrentRateLimiterState(uint64 remoteChainSelector, bool fastFinality)
  external view returns (RateLimiter.TokenBucket memory outbound, RateLimiter.TokenBucket memory inbound);
// 10 words: outbound words 0-4, inbound words 5-9. fastFinality=true reads the separate FTF buckets.
// VERIFIED LIVE (PST pool 0xFD34e186..., Ethereum): 10 words, isEnabled=1, capacity/rate present.
function getDynamicConfig() external view returns (address router, address rateLimitAdmin, address feeAdmin); // 3 words
// 1.5.1/1.6.x
function getCurrentOutboundRateLimiterState(uint64) external view returns (RateLimiter.TokenBucket memory); // 5 words
```
Not directly on 2.0.0: `getAllowList`, `getRouter`, `getRateLimitAdmin`. A reader that calls the 1.6 names on a 2.0 pool gets a revert (empty data).

### 4.3 Pool type and version from `typeAndVersion()`
Returns `"<ContractName> <semver>"`. Parse: split at the LAST space; name = left, version = right; tolerate `-dev` suffixes and names with prefixes.
- Standard strings (SRC200/SRC164 and docs dump): `BurnMintTokenPool 1.5.1|1.6.1|1.6.2|1.6.3|2.0.0`; `LockReleaseTokenPool ...`; `BurnFromMintTokenPool ...`; `BurnWithFromMintTokenPool ...`; 2.0.0 adds `BurnToAddressTokenPool 2.0.0` (the contract is named `BurnToAddressMintTokenPool` but the STRING is `BurnToAddressTokenPool`), `SiloedLockReleaseTokenPool 2.0.0`, `LombardTokenPool 2.0.0`, `USDCTokenPoolProxy 2.0.0`, `BurnMintWithLockReleaseFlagTokenPool`.
- Source tags `contracts-ccip-v1.6.3/v1.6.4` hold `"... 1.6.x-dev"` and `v1.6.2` holds `"... 1.6.3-dev"` (SRC164). Deployed pools can therefore report `1.6.x-dev`; the directory shows two LockRelease and four BurnMint entries with `rawType` "BurnMintTokenPool 1.6.x-dev" and empty version. Treat as 1.6.
- Legacy 1.5.0: `BurnMintTokenPoolAndProxy 1.5.0`, `LockReleaseTokenPoolAndProxy 1.5.0`, `BurnWithFromMintTokenPoolAndProxy 1.5.0` (VERIFIED: "BurnMintTokenPoolAndProxy 1.5.0" on Ethereum).
- Live distribution in the directory (mainnet, 1154 entries): BurnMintTokenPool 1.5.1 x491; LockRelease 1.5.1 x123; BurnMint...AndProxy 1.5.0 x117; BurnMint 1.6.1 x86; BurnMint 2.0.0 x63; LockRelease 1.6.1 x35; LockRelease...AndProxy 1.5.0 x32; BurnMint 2.1.0 x23 (Solana); BurnWithFromMint 1.5.1 x21; LombardTokenPool 2.1.0 x17; BurnWithFromMint 2.0.0 x17; USDCTokenPoolProxy 2.0.0 x12. Long tail of custom pools: BurnMintWithExternalMinterTokenPool 1.6.0, ManagedTokenPool 1.6.0, RegulatedTokenPool 1.6.0, BurnWithFromMintRebasingTokenPool 1.5.0, HybridWithExternalMinterTokenPool, XERC20LockboxTokenPool, SiloedWithUnsiloedXERC20GroupTokenPool, BurnMintTokenPoolWithTax. Versions "0.1.0/0.1.2/1.0.0/2.1.0" are non-EVM programs (Solana). The API's own `type` field already normalizes to burnMint | lockRelease | usdc.
- Pool family from the ABI, not the name: custom pools may omit getters. Decode each call defensively; a revert means "not supported on this pool", not an error.

### 4.4 USDC and other proxy pools
`USDCTokenPoolProxy 2.0.0` (SRC200 pools/USDC/USDCTokenPoolProxy.sol) routes to underlying pools: `getPools() returns (PoolAddresses{address cctpV1Pool; address cctpV2Pool; address cctpV2PoolWithCCV; address siloedLockReleasePool})` and `getLockOrBurnMechanism(uint64)`. VERIFIED LIVE on Ethereum proxy 0xf70B4B6e...: `owner()` works, but `getSupportedChains()`, `getCurrentInboundRateLimiterState`, `getCurrentRateLimiterState` all REVERT. Its source exposes `isSupportedChain`, `getRemoteToken`, `getRemotePools` only. Rate limits and chain lists live on the underlying pools (for CCTP, the verifier), so the plan should mark USDC/Lombard/CCTP-style tokens "limits not shown, see underlying pool" unless it follows `getPools()`.

### 4.5 Decimals
- 1.5.1+ pools put the local decimals in `destPoolData` (abi.encode(uint8)); the destination pool scales amounts (rounds down when remote has more decimals). Remote token decimals are NOT stored on EVM pools (only `getTokenDecimals()` for the local token), so read decimals from the token itself (`decimals()` `313ce567`) or the directory `decimals` field. Rate limits are in the LOCAL token's smallest unit on each side. Docs warn (dump line 3656) that in 1.5.1 inbound limits are not properly enforced when decimals differ between chains.
- SVM `RemoteConfig` carries `decimals` for the remote side (Solana only).

## 5. CCIP 2.0 verifiers (CCVs)

### 5.1 How a 2.0 pool points at its hooks contract
`TokenPool.getAdvancedPoolHooks() returns (address)` (selector `37a3210d`). `address(0)` means no hooks. Pool owner changes it with `updateAdvancedPoolHooks(address)`, emitting `AdvancedPoolHooksUpdated(address oldHook, address newHook)` (`baff46844acf36d6ee996f489a1a288709c4542bd33cd557770afd267d581209`). Source: SRC200 pools/TokenPool.sol lines 225, 262; docs https://docs.chain.link/ccip/concepts/cross-chain-token/advanced-pool-hooks (dump line 85355).
- The hooks contract has its OWN owner (separate from the pool owner) and its own `typeAndVersion()` "AdvancedPoolHooks 2.0.0" (VERIFIED LIVE: TRUF pool 0x7134dc36... on Ethereum -> hooks 0x3331b5f5...).
- `TokenPool.getRequiredCCVs(address localToken, uint64 remoteChainSelector, uint256 sourceDenominatedAmount, bytes4 requestedFinalityConfig, bytes extraData, uint8 direction)` (`06b859ef`; direction enum Outbound=0, Inbound=1) returns `address[]`. With no hooks it returns an EMPTY array (SRC200 TokenPool.sol lines 946-998: "`if (address(s_advancedPoolHooks) == address(0)) return new address[](0)`"). So "no hooks" = the pool adds no CCV requirement of its own.

### 5.2 Hooks contract getters
Source: https://docs.chain.link/ccip/evm/api-reference/v2.0.0/advanced-pool-hooks (dump line 88075).
```solidity
struct CCVConfig    { address[] outboundCCVs; address[] thresholdOutboundCCVs; address[] inboundCCVs; address[] thresholdInboundCCVs; }
struct CCVConfigArg { uint64 remoteChainSelector; address[] outboundCCVs; address[] thresholdOutboundCCVs; address[] inboundCCVs; address[] thresholdInboundCCVs; }
function getCCVConfig(uint64 remoteChainSelector) external view returns (CCVConfig memory);      // 776d5add ; empty lists if unconfigured
function getAllCCVConfigs() external view returns (CCVConfigArg[] memory);                       // 95984be9
function getRequiredCCVs(address localToken, uint64 remoteChainSelector, uint256 amount,
    bytes4 requestedFinalityConfig, bytes calldata extraData, IPoolV2.MessageDirection direction)
    external view returns (address[] memory requiredCCVs);                                       // 06b859ef
function getThresholdAmount() external view returns (uint256);                                   // f72c071b
function getPolicyEngine() external view returns (address);                                      // 68317312
function getAllowListEnabled() external view returns (bool); function getAllowList() external view returns (address[] memory); // e0351e13 / a7cd63b7
event CCVConfigUpdated(uint64 indexed remoteChainSelector, address[] outboundCCVs, address[] thresholdOutboundCCVs, address[] inboundCCVs, address[] thresholdInboundCCVs);
//   topic0 ece8a336aec3d0587372c99a62c7158c83d7419e28f8c519094cf44763b00e7d ; topic1 = remoteChainSelector
event ThresholdAmountSet(uint256 thresholdAmount); // 80dc2a1a...
event AllowListAdd(address sender); event AllowListRemove(address sender);
```
- ABI layout: `getCCVConfig` is a dynamic struct: word0 = offset (0x20), then 4 offsets and 4 arrays. `getAllCCVConfigs` returns an array of dynamic structs (offsets to each struct).
- Semantics (docs): base CCVs are always returned for the direction; threshold CCVs are appended when `thresholdAmount != 0 && amount >= thresholdAmount` and the threshold list is non-empty. The reference hook IGNORES `localToken`, `requestedFinalityConfig` and `extraData`, so amount and direction are the only inputs that change the answer. The pool adjusts `amount` before the hook call: outbound subtracts the pool's token transfer fee bps (finality or fast-finality bps), inbound converts remote to local decimals (SRC200 TokenPool.sol 954-998). For a static display call `getCCVConfig(sel)` per lane plus `getThresholdAmount()`; to answer "what is required for amount X" call the pool's `getRequiredCCVs`.
- VERIFIED LIVE: the TRUF hook had `getAllCCVConfigs()` = empty array, i.e. hooks present but no CCV rules.

### 5.3 What the full verifier set for a token transfer is (docs dump line ~87513)
Final CCV list = sender-chosen + lane default CCVs (when the sender gives none or a zero placeholder) + lane-mandated CCVs (always) + pool-required (from `getRequiredCCVs` on V2 pools, "or lane defaults for V1 pools"). So a pool without hooks still gets the lane default Committee Verifier. Lane lists live on the ramps, not the pool:
```solidity
// OnRamp (source side), SRC200 onRamp/OnRamp.sol
struct DestChainConfig { address router; uint64 messageNumber; uint8 addressBytesLength; bool tokenReceiverAllowed;
  uint16 messageNetworkFeeUSDCents; uint16 tokenNetworkFeeUSDCents; uint32 baseExecutionGasCost; address defaultExecutor;
  address[] laneMandatedCCVs; address[] defaultCCVs; bytes offRamp; }
function getDestChainConfig(uint64 destChainSelector) external view returns (DestChainConfig memory);   // 6def4ce7
function getAllDestChainConfigs() external view returns (uint64[] memory, DestChainConfig[] memory);
// OffRamp (destination side), SRC200 offRamp/OffRamp.sol
struct SourceChainConfig { address router; bool isEnabled; bytes[] onRamps; address[] defaultCCVs; address[] laneMandatedCCVs; }
function getSourceChainConfig(uint64 sourceChainSelector) external view returns (SourceChainConfig memory); // e9d68a8e
```
VERIFIED LIVE: Ethereum OnRamp (from /v2/lanes) `getDestChainConfig`: word order router, messageNumber, addressBytesLength, tokenReceiverAllowed, fees..., defaultExecutor (0x6608d995...), offsets mandated (empty), default = [0x2caafd3b4cf606220580c885bd2b448fb93dc03b] (the Committee Verifier resolver). Decode with the outer offset word first (dynamic struct).
Caveat: in `DestChainConfig`, `laneMandatedCCVs` is declared BEFORE `defaultCCVs` (the `DestChainConfigArgs` input struct has them in the opposite order). My live decode used the order above and returned a sensible result, but decode by struct order, not args order.

### 5.4 Resolving a CCV address to a name
- Onchain: every verifier-ish address returned by ramps/hooks is typically a `VersionedVerifierResolver` ("VersionedVerifierResolver 2.0.0", VERIFIED LIVE for the committee and CCTP verifier addresses on Ethereum). The resolver does NOT say which verifier family it is; its implementation does: `getAllOutboundImplementations() returns (OutboundImplementationArgs[]{uint64 destChainSelector; address verifier})` (`b5cbfb68`), `getAllInboundImplementations() returns (InboundImplementationArgs[]{bytes4 version; address verifier})` (`c3eba222`), `getOutboundImplementation(uint64,bytes)` (`958021a7`). Implementations expose `typeAndVersion()`: "CommitteeVerifier 2.0.0", "CCTPVerifier 2.0.0", "LombardVerifier 2.0.0" (SRC200 ccvs/*.sol). Events on the resolver: `OutboundImplementationUpdated(uint64 destChainSelector, address prevImpl, address newImpl)`, `InboundImplementationUpdated(bytes4 version, address prevImpl, address newImpl)` (SRC200 ccvs/VersionedVerifierResolver.sol).
- Offchain: the API `/v2/verifiers` maps `(chainSelector, address)` -> human name ("Committee Verifier (Default)", "CCTP Verifier", "Lombard Verifier"). Recommended: use the API list as primary (one request, cached), fall back to `typeAndVersion()` via the resolver implementation, else show the address as "custom verifier". A CommitteeVerifier does not name its committee onchain (only a signer set; I did not find a name field).
- Receiver-side `getCCVsAndFinalityConfig(uint64 sourceChainSelector, bytes sender)` (`1bfc84d0` per my keccak of that guessed argument list; exact parameter list UNCONFIRMED, docs dump line 307) is on message RECEIVERS (contracts), not on pools. For plain token transfers to an EOA the lane defaults and pool-required CCVs apply; it only matters for programmable token transfers. Out of scope for a per-token passport.

## 6. Events for change history
Signatures and topic0 (full keccak of canonical signature; SRC164 for 1.6.x, SRC200 for 2.0.0; 1.5.0 from docs dump):
```
OwnershipTransferRequested(address indexed from, address indexed to)  0xed8889f560326eb138920d842192f0eb3dd22b4f139c87a2c57538e05bae1278
OwnershipTransferred(address indexed from, address indexed to)        0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0
// pool, 1.5.1+ and 2.0.0
ChainAdded(uint64 remoteChainSelector, bytes remoteToken, (bool,uint128,uint128) outbound, (bool,uint128,uint128) inbound)  0x8d340f17e19058004c20453540862a9c62778504476f6756755cb33bcd6c38c2
ChainRemoved(uint64 remoteChainSelector)                              0x5204aec90a3c794d8e90fded8b46ae9c7c552803e7e832e0c1d358396d859916
RemotePoolAdded(uint64 indexed remoteChainSelector, bytes remotePoolAddress)    0x7d628c9a1796743d365ab521a8b2a4686e419b3269919dc9145ea2ce853b54ea
RemotePoolRemoved(uint64 indexed remoteChainSelector, bytes remotePoolAddress)  0x52d00ee4d9bd51b40168f2afc5848837288ce258784ad914278791464b3f4d76
// pool, 1.5.x/1.6.x only
ChainConfigured(uint64 remoteChainSelector, (bool,uint128,uint128) outbound, (bool,uint128,uint128) inbound)  0x0350d63aa5f270e01729d00d627eeb8f3429772b1818c016c66a588a864f912b
RateLimitAdminSet(address rateLimitAdmin)                             0x44676b5284b809a22248eba0da87391d79098be38bb03154be88a58bf4d09174
RouterUpdated(address oldRouter, address newRouter)                   0x02dc5c23...  (selector only computed: 02dc5c23)
RemotePoolSet(uint64 remoteChainSelector, bytes previousPoolAddress, bytes remotePoolAddress) // 1.5.0 only  0xdb4d6220746a38cbc5335f7e108f7de80f482f4d23350253dfd0917df75a14bf
// pool, 2.0.0 only (replace ChainConfigured / RateLimitAdminSet / RouterUpdated)
RateLimitConfigured(uint64 indexed remoteChainSelector, bool fastFinality, (bool,uint128,uint128) outbound, (bool,uint128,uint128) inbound)  0x41f7c8f7cfdad9350aa495e6c54cbbf750a07ab38a9098aed1256e30dd1682bb
DynamicConfigSet(address router, address rateLimitAdmin, address feeAdmin)       0x3f1036e85d016a93254a0b1415844f79b85424959d90ae5ad51ce8f4533fe701
AdvancedPoolHooksUpdated(address oldHook, address newHook)            0xbaff46844acf36d6ee996f489a1a288709c4542bd33cd557770afd267d581209
FinalityConfigSet(bytes4 allowedFinality)                             0x307cf716...
// hooks contract
CCVConfigUpdated(uint64 indexed remoteChainSelector, address[] outboundCCVs, address[] thresholdOutboundCCVs, address[] inboundCCVs, address[] thresholdInboundCCVs)  0xece8a336aec3d0587372c99a62c7158c83d7419e28f8c519094cf44763b00e7d
// registry
PoolSet / AdministratorTransferRequested / AdministratorTransferred (section 3)
```
Notes: indexed fields do not change topic0 but move data into topics. `ChainAdded` is NOT indexed on the selector. Pool `ChainAdded` event in 2.0.0 has the same signature as 1.6 (SRC200 TokenPool.sol line 68).

### Daily state diff vs event scan
Recommendation: DAILY STATE DIFF. Reasons verified on 2026-11-22: free RPCs reject historic or wide `eth_getLogs` (publicnode: "Archive requests require a personal token"; 1rpc: "limited to 0 - 50 blocks range"; Ankr: key required; llamarpc: 525; Arbitrum public RPC: max 30,000 blocks; Base public RPC: "request limit reached"). A scan would also have to cover ~1000 pools per chain across ~70 chains. `eth_call` at "latest" works everywhere. The snapshot already contains every setting; a diff yields "changed since yesterday" (owner, admin, pool address, remote pools, limits enabled/capacity/rate, CCV lists). Use events only as an optional accelerator later (for example, one `eth_getLogs` over the last 24h range per chain for `OwnershipTransferRequested` on known pool addresses, where range limits allow), and store the previous snapshot hash per (chain, token) in D1.

## 7. Roles: who can change what
- Pool `owner()` (Ownable2Step): can `applyChainUpdates`, `addRemotePool/removeRemotePool`, set router/dynamic config, `setRateLimitConfig`, update hooks (2.0). 
- `getRateLimitAdmin()` (1.x) or `getDynamicConfig().rateLimitAdmin` (2.0): can change rate limits only (owner or admin: `_onlyOwnerOrRateLimitAdmin`, SRC200 TokenPool.sol line 939). `address(0)` = none.
- 2.0 `feeAdmin` (third word of `getDynamicConfig`): can withdraw fees.
- Hooks owner: separate; controls CCV config, allowlist, threshold, policy engine (docs table).
- Registry `administrator` of the token: can `setPool(token, pool)` and `transferAdminRole`. `pendingAdministrator`: a requested transfer. 
- Pending pool ownership: Ownable2Step has NO public getter (`pendingOwner()` reverts, VERIFIED LIVE). `s_pendingOwner` is `private` (docs dump line ~41883 section "s_pendingOwner"). Options: (a) skip "pending pool owner" in v1 and rely on the registry's `pendingAdministrator`; (b) `eth_getStorageAt` (layout UNCONFIRMED: on the 1.6.1 pool I tested slot 1 held the owner and slot 0 was zero; I did not find a pool with a live pending transfer to confirm slot 0 = pending owner); (c) `eth_getLogs` for `OwnershipTransferRequested` (wide-range limits apply). Recommend (a) now and flag the gap.

## 8. Scale check (VERIFIED LIVE 2026-11-22, `getAllConfiguredTokens(0,1000)` array length)
- Ethereum TAR: 593 tokens. Arbitrum: 282. Base: 728. (Directory reviewed set on those chains: Ethereum 210, Base 155, Arbitrum 96 entries, so the registry holds 2-5x more than the directory shows; many registry entries have `tokenPool = 0` or no lanes.)
- Cheapest plan for a daily job: take (chain, token, pool, type, version) from `/api/ccip/v1/tokens?environment=mainnet` (1154 entries, 1099 EVM), so you avoid walking the registry. Registry walk only if you want unreviewed tokens: then `getAllConfiguredTokens(0,1000)` (1 call per chain) and `getPools(tokens)` (1 call), still no per-token fan-out.
- Per EVM pool calls: `typeAndVersion`, `owner`, `getSupportedChains`, (registry `getTokenConfig`), `getRateLimitAdmin`/`getDynamicConfig`, `getAdvancedPoolHooks` (2.0 only), then per supported lane: `getRemotePools`, `getRemoteToken`, inbound/outbound bucket (1.x: 2 calls; 2.0: 1 call) and for 2.0 hooks `getAllCCVConfigs` once. Typical pool has 1-70 lanes. Estimate about 1099 pools x (5 + 4 x lanes) calls; batch with JSON-RPC arrays or Multicall3 (`aggregate3` at 0xcA11bde05977b3631167028862bE2a173976CA11 on most chains; selector `82ad56cb` from my computed list; address not verified here) to cut round trips. Ethereum node tested handled `getAllConfiguredTokens(0,1000)` in one call.
- Revert tolerance is needed: Probe on 1.5.0 `...AndProxy` pool: `getRemotePools` reverted, `getRemotePool` worked; `getTokenDecimals` reverted. Branch on the parsed version first, then fall back by trying the alternate selector on revert.

## 9. Rate-limit semantics
Sources: docs https://docs.chain.link/ccip/concepts/cross-chain-token/evm/rate-limits (dump lines ~5923-5960, 3430); RateLimiter.sol (SRC200).
- Token bucket per (pool, remote chain, direction[, finality class in 2.0]). `capacity` = maximum tokens in the bucket; `rate` = tokens added per SECOND; both in the token's SMALLEST UNIT (wei-like, local decimals) (dump line 5935). `tokens` returned by the getter is already refilled to the call's block timestamp (`_currentTokenBucketState`). `isEnabled=false` means no limit at all (capacity/rate are 0).
- Refill: `tokens = min(capacity, tokens + elapsedSeconds * rate)`.
- A single transfer larger than `capacity` can never pass (`TokenMaxCapacityExceeded`). 
- Max that can pass in a window `T` seconds starting from a full bucket: `min(capacity + rate*T, ...)` which is `capacity + rate*T`. For "most that can leave in one hour from a full bucket": `capacity + rate * 3600`. From the current bucket: `tokens + rate*3600` bounded by `capacity + ...` (spent tokens refill; the bucket never exceeds capacity at any instant, but a steady drain can pass `capacity + rate*T` in total). Disabled limit = unbounded (show "no limit").
- Which direction matters for "how much can leave chain X": OUTBOUND on the pool on X (tokens locked/burned on X heading to remote R) limits what leaves X. The INBOUND limit on the DESTINATION chain's pool for traffic from X (the other pool's inbound for source X) can also block delivery; the effective throughput of the lane X->R is the minimum of X's outbound(R) and R's inbound(X) (convert for decimals differences). For the passport's "leaves this chain" figure show X's outbound as the headline and optionally the counterpart's inbound as a cap.
- 2.0.0 adds a second pair of buckets for fast-finality transfers (`getCurrentRateLimiterState(sel, true)`); show default-finality (false) first.
- SVM pools use u64 amounts, same fields (`enabled, capacity, rate`; `tokens`, `last_updated` on the bucket).

## 10. Non-EVM readability (honest summary)
| Family | Where the config lives | Readable keyless? | Verdict for v1 |
|---|---|---|---|
| Solana (SVM) | Router program has one `TokenAdminRegistry` PDA per mint (administrator, pending admin, pool lookup table); each pool program has a state PDA (seed `"ccip_tokenpool_config"` + mint) holding owner, proposed_owner, rate_limit_admin, allowlist, and per-remote chain PDAs (seed `"ccip_tokenpool_chainconfig"` + selector + mint) with `RemoteConfig{pool_addresses, token_address, decimals}`, inbound/outbound `RateLimitTokenBucket{tokens,last_updated,cfg{enabled,capacity,rate}}`. Source: dump 59472+ (SVM Base Token Pool Library), 4149. | Yes via `getAccountInfo` (Borsh decode; Anchor 8-byte discriminator; PDAs derived client side with ed25519 curve checks) on a free RPC; no enumeration of chain-config PDAs without `getProgramAccounts` (often blocked on free RPCs), but the remote selectors are known from `/v2/tokens` `remoteChains`. Registry PDA seed string for the router TokenAdminRegistry: UNCONFIRMED (not found in the dump). | Doable but a separate decoder; mark "not readable" in v1, add later. 53 mainnet entries. |
| Aptos | `ccip::token_admin_registry` module plus `lock_release_token_pool` / `burn_mint_token_pool` modules (dump 2798) | Move `#[view]` functions via the free Aptos REST `/v1/view`; which view functions the pool modules expose is UNCONFIRMED (docs list only router/client views). | Not readable at first. (Aptos tokens do appear in the directory tokens endpoint, e.g. chainName Aptos with a pool address; count not separated.) |
| TON | Tolk/FunC contracts; getters via TON `runGetMethod` | UNCONFIRMED: no pool-config getter documentation found in the dump | Not readable at first |
| Sui | Move modules | UNCONFIRMED; Sui mainnet is not in `/v2/chains` (testnet only) | Skip |
| Canton, Tron, Stellar, Starknet | Canton appears with 2 token entries; others only as empty chain-map keys | UNCONFIRMED | Skip |
EVM-compatible chains in the directory are fully covered by the EVM readers above (73 EVM entries with a registry in the chains endpoint on 2026-11-23). Tron is listed under its own key, treat as non-EVM unless it exposes an EVM-compatible JSON-RPC (UNCONFIRMED).

## 11. Implementation guide (hand-encoded calls)
Calldata = selector + 32-byte words. For uint64 args pad to 32 bytes; for bool use `00..00` or `00..01`.
```
typeAndVersion()                        0x181f5a77   -> string (offset, length, bytes)
owner()                                 0x8da5cb5b
getSupportedChains()                    0xc4bffe2b   -> uint64[]
getRemotePools(uint64)                  0xa42a7b8b   -> bytes[]   (1.5.1+)   | getRemotePool(uint64) 0x0a2fd493 -> bytes (1.5.0)
getRemoteToken(uint64)                  0xb7946580   -> bytes
getCurrentInboundRateLimiterState(u64)  0xaf58d59f   -> 5 words  (<=1.6.x)
getCurrentOutboundRateLimiterState(u64) 0xc75eea9c   -> 5 words  (<=1.6.x)
getCurrentRateLimiterState(u64,bool)    0x2422ac45   -> 10 words (2.0.0)
getRateLimitAdmin()                     0x6d3d1a58   (<=1.6.x)   | getDynamicConfig() 0x7437ff9f (2.0.0)
getAdvancedPoolHooks()                  0x37a3210d   (2.0.0)
getAllCCVConfigs()                      0x95984be9   (hooks)     | getCCVConfig(u64) 0x776d5add
getThresholdAmount()                    0xf72c071b   (hooks)
getAllConfiguredTokens(u64,u64)         0x72d64a81   (registry)  | getTokenConfig(address) 0xcb67e3b1 | getPool(address) 0xbbe4f6db
getDestChainConfig(u64)                 0x6def4ce7   (OnRamp 2.0)| getSourceChainConfig(u64) 0xe9d68a8e (OffRamp 2.0)
```
Decision sequence per pool: (1) `typeAndVersion` -> (name, semver). (2) If major >= 2 -> use 2.0 readers; else 1.x readers; if semver is "1.5.0" use `getRemotePool`. (3) Wrap every call in try; a revert is `unsupported`. (4) For proxy/USDC/Lombard/CCTP names, mark limits as "see underlying pool" and skip chain readers unless they respond.

## 12. Gotchas for the plan
1. Address encodings: remote pool/token are `bytes`, not `address`; EVM remote = 32-byte left-padded, Solana = 32 raw bytes, TON/Sui lengths differ. Compare cross-chain pointers by normalizing both sides (strip 12 leading zero bytes when length is 32 and the first 12 bytes are zero and the remote family is EVM).
2. "Pools point at each other" check: for lane A->B, A.getRemotePools(B) should contain B's pool and A.getRemoteToken(B) = B's token; and B.getRemotePools(A) should contain A's pool. Multiple remote pools per chain are normal after pool upgrades (the old pool stays allowed for in-flight messages).
3. Rate limiter getter returns `tokens` refilled at call time; `lastUpdated` equals the block timestamp, so do not use it as "last activity".
4. 2.0 does not expose `getAllowList` on the pool; read it from the hooks contract. 1.x allowlist is fixed at deploy.
5. Version strings include dev tags (`1.6.x-dev`, `1.6.3-dev`); parse leniently.
6. `getAllConfiguredTokens` and tokens directory are not equal sets (593 vs 210 on Ethereum).
7. Registry `typeAndVersion` is always 1.5.0; do not use it to infer CCIP generation. Use the pool version or the OnRamp version from `/v2/lanes`.
8. Pool owner for Chainlink-deployed pools can be a multisig or timelock; this is just an address, no extra decoding.

## 13. References
- docs.chain.link: https://docs.chain.link/ccip/api-reference/evm/v2.0.0/token-pool ; .../advanced-pool-hooks ; .../ccip/directory ; docs/concepts: https://docs.chain.link/ccip/concepts/cross-chain-token/advanced-pool-hooks (dump lines 85355, 88075, 102416).
- Solidity: https://github.com/smartcontractkit/chainlink-ccip/blob/contracts-ccip-v2.0.0/chains/evm/contracts/pools/TokenPool.sol ; .../pools/AdvancedPoolHooks.sol ; .../libraries/RateLimiter.sol ; .../tokenAdminRegistry/TokenAdminRegistry.sol ; .../ccvs/VersionedVerifierResolver.sol ; .../onRamp/OnRamp.sol ; .../offRamp/OffRamp.sol ; .../pools/USDC/USDCTokenPoolProxy.sol ; v1.6.4: .../contracts-ccip-v1.6.4/chains/evm/contracts/pools/TokenPool.sol.
- Live APIs: https://docs.chain.link/api/ccip/v1/chains?environment=mainnet ; https://docs.chain.link/api/ccip/v1/tokens?environment=mainnet ; https://api.ccip.chain.link/v2/{chains,tokens,lanes,verifiers}.
