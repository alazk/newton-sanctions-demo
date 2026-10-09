// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

/**
 * Minimal Newton v0.7 PolicyClient for the sanctions demo.
 *
 * The public newton-contracts repo lags the deployed 0.7 protocol. This
 * implements the v0.7 client interface as published in @newton-xyz/sdk 1.2.2
 * (NewtonPolicyClientAbi). Its ERC-165 id is 0xf67e14d6, which is the id the
 * deployed NewtonPolicy and PolicyClientRegistry check:
 *
 *   getNewtonPolicyTaskManager()                 0x2d895bfd
 *   getOwner()                                   0x893d20e8
 *   getPolicies()                                0x3b04f6f1
 *   getPolicyId()                                0xef7b2be2
 *   getPolicySetSnapshot()                       0xc96f8936
 *   policyRevision()                             0x26a7d805
 *   setPolicies((address,(bytes,uint32))[])      0x697de3e3
 *                                        XOR  =  0xf67e14d6
 *
 * policyId follows the SDK's precomputePolicyId:
 *   keccak256(abi.encode(POLICY_SET_DOMAIN, chainid, client, revision, policies))
 */

struct PolicyConfig {
    bytes policyParams;
    uint32 expireAfter;
}

struct PolicySpec {
    address policy;
    PolicyConfig config;
}

interface INewtonPolicyV7 {
    function setPolicy(PolicyConfig calldata policyConfig) external returns (bytes32);
}

contract SanctionsDemoClient {
    bytes32 public constant POLICY_SET_DOMAIN =
        0x671cdd5663cea1dd5f0b42278ce65570194bc54e20449731d2ae86713689de91;
    bytes4 public constant INTERFACE_ID = 0xf67e14d6;

    address private immutable _taskManager;
    address private _owner;
    bytes32 private _policyId;
    uint64 private _revision;
    PolicySpec[] private _policies;

    event PolicyClientInitialized(address indexed taskManager, address indexed owner);
    event PolicyClientOwnerUpdated(address indexed previousOwner, address indexed newOwner);
    event PoliciesUpdated(
        bytes32 indexed previousPolicyId, bytes32 indexed newPolicyId, uint64 revision, PolicySpec[] policies
    );

    error OnlyPolicyClientOwner();
    error EmptyPolicySet();
    error ZeroExpireAfter(uint256 index);

    modifier onlyOwner() {
        if (msg.sender != _owner) revert OnlyPolicyClientOwner();
        _;
    }

    constructor(address taskManager, address owner_) {
        _taskManager = taskManager;
        _owner = owner_;
        emit PolicyClientInitialized(taskManager, owner_);
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == INTERFACE_ID;
    }

    function getNewtonPolicyTaskManager() external view returns (address) {
        return _taskManager;
    }

    function getOwner() external view returns (address) {
        return _owner;
    }

    function getPolicyId() external view returns (bytes32) {
        return _policyId;
    }

    function policyRevision() external view returns (uint64) {
        return _revision;
    }

    function getPolicies() external view returns (PolicySpec[] memory) {
        return _policies;
    }

    function getPolicySetSnapshot()
        external
        view
        returns (bytes32 policyId, uint64 revision, PolicySpec[] memory policies)
    {
        return (_policyId, _revision, _policies);
    }

    function setPolicies(PolicySpec[] calldata policies) external onlyOwner returns (bytes32 policyId) {
        if (policies.length == 0) revert EmptyPolicySet();

        delete _policies;
        for (uint256 i = 0; i < policies.length; i++) {
            if (policies[i].config.expireAfter == 0) revert ZeroExpireAfter(i);
            _policies.push(policies[i]);
            // Also register the config on the policy itself, as older clients did.
            INewtonPolicyV7(policies[i].policy).setPolicy(policies[i].config);
        }

        uint64 revision = _revision + 1;
        _revision = revision;
        policyId = keccak256(abi.encode(POLICY_SET_DOMAIN, block.chainid, address(this), revision, policies));

        bytes32 previous = _policyId;
        _policyId = policyId;
        emit PoliciesUpdated(previous, policyId, revision, policies);
    }

    function setPolicyClientOwner(address newOwner) external onlyOwner {
        emit PolicyClientOwnerUpdated(_owner, newOwner);
        _owner = newOwner;
    }

    function version() external pure returns (string memory) {
        return "0.7.2";
    }

    /// Single-policy reads kept for older tooling (check.mjs etc).
    function getPolicyAddress() external view returns (address) {
        return _policies.length > 0 ? _policies[0].policy : address(0);
    }

    function getPolicyConfig() external view returns (PolicyConfig memory) {
        if (_policies.length == 0) return PolicyConfig("", 0);
        return _policies[0].config;
    }
}
