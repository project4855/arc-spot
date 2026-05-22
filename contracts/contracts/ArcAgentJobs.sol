// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ArcAgentJobs
 * @notice ERC-8183-style job escrow for the Arc Agentic Economy
 * @dev USDC is the payment token (Arc Testnet: 0x3600000000000000000000000000000000000000)
 *
 * Job lifecycle:
 *   createJob()  → Open
 *   fund()       → Funded  (USDC escrowed onchain)
 *   submit()     → Submitted (provider posts deliverable hash)
 *   complete()   → Completed (USDC released to provider)
 *   reject()     → Rejected  (USDC returned to creator)
 *   claimRefund()→ Expired   (creator reclaims after deadline)
 */
contract ArcAgentJobs is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Enums ─────────────────────────────────────────────────────────────────

    enum Status { Open, Funded, Submitted, Completed, Rejected, Expired }

    // ── Structs ───────────────────────────────────────────────────────────────

    struct Job {
        uint256  id;
        address  creator;
        address  provider;    // 0x0 if open to anyone
        address  evaluator;   // who can complete/reject (defaults to creator)
        uint256  budgetUsdc;  // in USDC units (6 decimals)
        uint256  deadline;    // unix timestamp
        string   title;
        string   description;
        bytes32  deliverable; // IPFS CID hash submitted by provider
        Status   status;
        uint256  createdAt;
    }

    // ── State ─────────────────────────────────────────────────────────────────

    IERC20   public immutable usdc;
    uint256  public jobCount;

    mapping(uint256 => Job)      public jobs;
    mapping(address => uint256[]) public jobsByCreator;
    mapping(address => uint256[]) public jobsByProvider;

    // ── Events ────────────────────────────────────────────────────────────────

    event JobCreated(uint256 indexed id, address indexed creator, string title, uint256 budgetUsdc, uint256 deadline);
    event JobFunded(uint256 indexed id, address indexed funder, uint256 amount);
    event JobSubmitted(uint256 indexed id, address indexed provider, bytes32 deliverable);
    event JobCompleted(uint256 indexed id, address indexed provider, uint256 payout);
    event JobRejected(uint256 indexed id, address indexed evaluator);
    event JobExpired(uint256 indexed id, address indexed creator, uint256 refund);

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }

    // ── Write functions ───────────────────────────────────────────────────────

    /**
     * @notice Create a new job (no USDC sent yet — use fund() next)
     * @param provider  Specific provider address, or address(0) for open market
     * @param evaluator Who can approve/reject. Pass address(0) to default to creator.
     * @param budgetUsdc USDC amount in token units (e.g. 5_000_000 = 5 USDC)
     * @param deadlineHours Hours from now until job expires
     * @param title       Short job title
     * @param description Full job description
     */
    function createJob(
        address provider,
        address evaluator,
        uint256 budgetUsdc,
        uint256 deadlineHours,
        string calldata title,
        string calldata description
    ) external returns (uint256 id) {
        require(budgetUsdc > 0, "Budget must be > 0");
        require(deadlineHours > 0 && deadlineHours <= 8760, "Deadline 1h-8760h");
        require(bytes(title).length > 0, "Title required");

        id = ++jobCount;
        jobs[id] = Job({
            id:          id,
            creator:     msg.sender,
            provider:    provider,
            evaluator:   evaluator == address(0) ? msg.sender : evaluator,
            budgetUsdc:  budgetUsdc,
            deadline:    block.timestamp + deadlineHours * 1 hours,
            title:       title,
            description: description,
            deliverable: bytes32(0),
            status:      Status.Open,
            createdAt:   block.timestamp
        });

        jobsByCreator[msg.sender].push(id);
        if (provider != address(0)) jobsByProvider[provider].push(id);

        emit JobCreated(id, msg.sender, title, budgetUsdc, jobs[id].deadline);
    }

    /**
     * @notice Fund the job — escrows USDC onchain.
     *         Caller must approve this contract for budgetUsdc first.
     * @param jobId The job to fund
     */
    function fund(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job not found");
        require(job.status == Status.Open, "Not open");
        require(
            job.creator == msg.sender ||
            job.provider == msg.sender ||
            job.provider == address(0),
            "Not authorized to fund"
        );
        require(block.timestamp < job.deadline, "Deadline passed");

        usdc.safeTransferFrom(msg.sender, address(this), job.budgetUsdc);
        job.status = Status.Funded;

        emit JobFunded(jobId, msg.sender, job.budgetUsdc);
    }

    /**
     * @notice Provider submits a deliverable hash (e.g. IPFS CID)
     * @param jobId       The funded job
     * @param deliverable bytes32 hash of the deliverable (keccak256 of IPFS CID or content)
     */
    function submit(uint256 jobId, bytes32 deliverable) external {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job not found");
        require(job.status == Status.Funded, "Not funded");
        require(block.timestamp < job.deadline, "Deadline passed");
        require(
            job.provider == address(0) || job.provider == msg.sender,
            "Not the assigned provider"
        );

        job.provider    = msg.sender;
        job.deliverable = deliverable;
        job.status      = Status.Submitted;

        jobsByProvider[msg.sender].push(jobId);

        emit JobSubmitted(jobId, msg.sender, deliverable);
    }

    /**
     * @notice Evaluator approves — releases USDC to provider
     * @param jobId The submitted job
     */
    function complete(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job not found");
        require(job.status == Status.Submitted, "Not submitted");
        require(job.evaluator == msg.sender, "Not the evaluator");

        job.status = Status.Completed;
        usdc.safeTransfer(job.provider, job.budgetUsdc);

        emit JobCompleted(jobId, job.provider, job.budgetUsdc);
    }

    /**
     * @notice Evaluator rejects — returns USDC to creator
     * @param jobId The submitted job
     */
    function reject(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job not found");
        require(job.status == Status.Submitted, "Not submitted");
        require(job.evaluator == msg.sender, "Not the evaluator");

        job.status = Status.Rejected;
        usdc.safeTransfer(job.creator, job.budgetUsdc);

        emit JobRejected(jobId, msg.sender);
    }

    /**
     * @notice Creator reclaims USDC if job expired without completion
     * @param jobId The funded or submitted job past its deadline
     */
    function claimRefund(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job not found");
        require(job.creator == msg.sender, "Not the creator");
        require(
            job.status == Status.Funded || job.status == Status.Submitted,
            "Not refundable"
        );
        require(block.timestamp >= job.deadline, "Deadline not passed");

        uint256 refund = job.budgetUsdc;
        job.status = Status.Expired;
        usdc.safeTransfer(msg.sender, refund);

        emit JobExpired(jobId, msg.sender, refund);
    }

    // ── Read functions ────────────────────────────────────────────────────────

    function getJob(uint256 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }

    function getJobsByCreator(address creator) external view returns (uint256[] memory) {
        return jobsByCreator[creator];
    }

    function getJobsByProvider(address provider) external view returns (uint256[] memory) {
        return jobsByProvider[provider];
    }

    /**
     * @notice Get the most recent N jobs (paginated from the end)
     */
    function getRecentJobs(uint256 count) external view returns (Job[] memory result) {
        uint256 total = jobCount;
        uint256 n = count > total ? total : count;
        result = new Job[](n);
        for (uint256 i = 0; i < n; i++) {
            result[i] = jobs[total - i];
        }
    }
}
