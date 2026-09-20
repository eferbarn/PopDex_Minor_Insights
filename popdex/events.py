"""PopDEX precompile event definitions, taken from https://popdex.xyz/docs/smart-contract/*.

Solidity enums are uint8 on the wire; structs are tuples. Everything here is
derived from the docs text, so if an event fails to decode, check the docs page
for that contract first.
"""
import re
from eth_utils import keccak
from eth_abi import decode as abi_decode

CONTRACTS = {
    "0x0000000000000000000000000000000000001000": "Order",
    "0x0000000000000000000000000000000000001002": "Oracle",
    "0x0000000000000000000000000000000000001003": "Token",
    "0x0000000000000000000000000000000000001005": "Sysconfig",
    "0x0000000000000000000000000000000000001007": "SysConsensus",
    "0x0000000000000000000000000000000000001008": "Account",
    "0x0000000000000000000000000000000000001009": "UserConfig",
    "0x000000000000000000000000000000000000100e": "Vault",
    "0x000000000000000000000000000000000000100f": "TokenBridge",
    "0x0000000000000000000000000000000000001011": "Referral",
    "0x0000000000000000000000000000000000001012": "Builder",
}

# Named types used inside event signatures -> canonical ABI type
TYPE_ALIASES = {
    "OrderStatus": "uint8", "OrderType": "uint8", "TriggerStatus": "uint8",
    "Category": "uint8", "PositionMode": "uint8", "CodeType": "uint8",
    "FundAgentScope": "uint8",
    "OptionalCategory": "(bool,uint8)",
    "OptionalOrderCategory": "(bool,uint8)",
    "OptionalBool": "(bool,bool)",
}

ENUMS = {
    "OrderStatus": ["WaitToSend", "PendingNew", "PendingCancel", "NewAccept", "PartiallyFilled",
                    "FullyFilled", "Cancelled", "PartiallyFilledCancelled"],
    "OrderType": ["Limit", "Market", "Plan", "Tpsl"],
    "TriggerStatus": ["WaitToTrigger", "AlreadyTrigger", "Cancelled"],
    "Category": ["Spot", "Margin", "Futures"],
    "PositionMode": ["Oneway", "Hedge"],
    "CodeType": ["Referral", "Affiliate", "SubAffiliate"],
    "FundAgentScope": ["InternalTransferOnly", "ExternalTransferOnly", "FullTransferAccess"],
}

EVENT_SOURCES = """
event OrderCreate(address indexed account, uint16 indexed symbol, uint128 orderId, bytes32 clientOid, int256 price, int256 qty, int256 borrowAmount, OrderStatus status, bool succeeded, uint32 code);
event OrderCancel(address indexed account, uint128 orderId, bytes32 clientOid, bool succeeded, uint32 code);
event OrderAllCancel(address indexed account, uint16 symbolId, OptionalCategory category, OptionalOrderCategory orderCategory, OptionalBool isFullPositionTpsl, bool succeeded, uint32 code);
event TriggerOrderCreate(address indexed account, uint16 indexed symbol, uint128 orderId, OrderType orderType, bytes32 clientOid, TriggerStatus status, bool succeeded, uint32 code);
event TriggerOrderCancel(address indexed account, uint128 orderId, bytes32 clientOid, bool succeeded, uint32 code);
event TriggerOrderBatchCancel(address indexed account, uint16 indexed symbol, uint128[] orderIds, bool succeeded, uint32 code);
event TriggerOrder(address indexed account, uint16 indexed symbol, uint128[] orderIds, bool succeeded, uint32 code);
event CloseAllPositions(address indexed account, uint128[] orderIds, uint16[] symbolIds, uint8[] positionSides, bool succeeded, uint32 code);
event SubaccountCreated(address indexed main, address indexed subaccount);
event AgentApproved(address indexed sender, address indexed agent, address indexed delegator, bytes32 name, uint64 expiresAt, bool isGlobal);
event FundAgentApproved(address indexed sender, address indexed agent, address indexed delegator, bytes32 name, uint64 expiresAt, bool isGlobal, FundAgentScope scope, address[] allowedRecipients);
event AgentReplaced(address indexed sender, address indexed delegator, bytes32 indexed name, address oldAgent, address newAgent, uint64 expiresAt, bool isGlobal);
event AgentRevoked(address indexed sender, address indexed agent, address indexed delegator, bytes32 name, uint64 revokedAt);
event AgentExpirationUpdated(address indexed sender, address indexed agent, address indexed delegator, bytes32 name, uint64 oldExpiresAt, uint64 newExpiresAt, uint64 updatedAt);
event FundAgentAllowedRecipientsReplaced(address indexed sender, address indexed agent, address indexed delegator, bytes32 name, address[] allowedRecipients);
event Withdraw(address indexed sender, address receiver, uint16 indexed token, int256 amount, int256 fee, uint128 id, OrderStatus status, uint256 indexed toChainId, bool succeeded, uint32 code);
event VaultCreate(address indexed vaultAddress, address indexed leader, uint128 requestId, uint8 vaultType, uint16 quoteTokenId, int256 initialDeposit, int256 share, int256 creationFee, bool succeeded, uint8 vaultStage, uint32 code);
event VaultClose(address indexed vaultAddress, address indexed leader, uint128 requestId, uint16 quoteTokenId, int256 totalSharesBefore, int256 autoRedeemShares, uint32 autoRedeemUserCount, bool succeeded, uint8 vaultStage, uint32 code);
event VaultCloseRedeemDetail(address indexed vaultAddress, address indexed userWalletId, uint128 requestId, bool isLeaderRedeem, uint16 quoteTokenId, int256 sharesBefore, int256 sharesDelta, int256 sharesAfter, int256 totalSharesBefore, int256 totalSharesAfter, int256 avgDepositPrice, int256 grossAmount, int256 userAmount, int256 leaderFee, bool positionDeleted, bool succeeded, uint8 vaultStage, uint32 code);
event VaultSubvaultUpdated(address indexed parentVaultAddress, address indexed subvaultAddress, string nameBefore, string nameAfter, string descriptionBefore, string descriptionAfter, bool succeeded, uint32 code);
event VaultDeposit(address indexed vaultAddress, address indexed userWalletId, uint128 requestId, uint16 quoteTokenId, int256 amount, int256 share, int256 price, int256 averagePrice, uint64 lockupUntil, bool succeeded, uint8 vaultStage, uint32 code);
event VaultWithdraw(address indexed vaultAddress, address indexed userWalletId, uint128 requestId, uint16 quoteTokenId, int256 amount, int256 share, int256 price, int256 averagePrice, int256 leaderFee, bool succeeded, uint8 vaultStage, uint32 code);
event CodeCreated(bytes8 indexed code, CodeType indexed codeType, address indexed actor, address owner, uint256 rebateRate, uint256 refereeShare, uint32 maxUse, bytes8 parentAffiliateCode);
event CodeBound(address indexed user, bytes8 referralCode, bool succeeded, uint32 code);
event CodeUpdated(bytes8 indexed code, CodeType indexed codeType, address indexed actor, address owner);
event RebateClaimed(address indexed beneficiary, address indexed tokenAddress, uint256 amount, uint256 exchangeRate, bool succeeded, uint32 code);
event BuilderAuthorized(address indexed account, bool succeeded, uint32 code);
event BuilderRevoked(address indexed user, address indexed builder);
event BuilderFeeWithdrawn(address indexed builder, address indexed token, uint256 amount);
event LeverageUpdated(address indexed account, Category category, uint16 symbolId, address tokenAddress, uint8 newLeverage, bool succeeded, uint32 code);
event PositionModeUpdated(address indexed account, PositionMode positionMode, bool succeeded, uint32 code);
event Transfer(address indexed tokenAddress, address indexed from, address indexed to, uint256 amount, uint256 fee, uint128 id, bool succeeded, uint32 code);
event InternalTransfer(address indexed tokenAddress, address indexed from, address indexed to, uint256 amount, uint256 fee, uint128 id, bool succeeded, uint32 code);
"""

_EVENT_RE = re.compile(r"event\s+(\w+)\s*\((.*?)\)\s*;", re.S)


def _canon(t):
    return TYPE_ALIASES.get(t, t)


def _parse():
    events = {}
    for name, body in _EVENT_RE.findall(EVENT_SOURCES):
        params = []
        for raw in body.split(","):
            parts = raw.split()
            if not parts:
                continue
            typ, indexed, pname = parts[0], "indexed" in parts, parts[-1]
            params.append({"type": _canon(typ), "solType": typ, "indexed": indexed, "name": pname})
        sig = f"{name}({','.join(p['type'] for p in params)})"
        topic0 = "0x" + keccak(text=sig).hex()
        events[topic0] = {"name": name, "sig": sig, "params": params}
    return events


EVENTS = _parse()


def _decode_topic(typ, topic):
    b = bytes.fromhex(topic[2:])
    if typ == "address":
        return "0x" + b[-20:].hex()
    if typ.startswith("bytes") and typ != "bytes":
        return "0x" + b.hex()
    if typ == "bool":
        return int.from_bytes(b, "big") != 0
    return int.from_bytes(b, "big", signed=typ.startswith("int"))


def _pretty(value, sol_type):
    if sol_type in ENUMS and isinstance(value, int) and value < len(ENUMS[sol_type]):
        return ENUMS[sol_type][value]
    if sol_type == "bytes32" and isinstance(value, str):
        # clientOid is UTF-8 right-padded
        try:
            s = bytes.fromhex(value[2:]).rstrip(b"\0").decode()
            return s if s.isprintable() else value
        except UnicodeDecodeError:
            return value
    if sol_type == "bytes8" and isinstance(value, str):
        return bytes.fromhex(value[2:]).rstrip(b"\0").decode(errors="replace")
    if isinstance(value, bytes):
        return "0x" + value.hex()
    return value


def decode_log(log):
    """Return {"contract","event","args"} or None if the event is unknown."""
    ev = EVENTS.get(log["topics"][0])
    if ev is None:
        return None
    args = {}
    topics = log["topics"][1:]
    indexed = [p for p in ev["params"] if p["indexed"]]
    unindexed = [p for p in ev["params"] if not p["indexed"]]
    for p, t in zip(indexed, topics):
        args[p["name"]] = _pretty(_decode_topic(p["type"], t), p["solType"])
    if unindexed:
        data = bytes.fromhex(log["data"][2:])
        values = abi_decode([p["type"] for p in unindexed], data)
        for p, v in zip(unindexed, values):
            args[p["name"]] = _pretty(v, p["solType"])
    return {"contract": CONTRACTS.get(log["address"], log["address"]), "event": ev["name"], "args": args}


if __name__ == "__main__":
    for t, e in EVENTS.items():
        print(t[:12], e["sig"])
