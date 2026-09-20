# LUMINA Engineering: Prompt Playbook & Master Guide

> A curated prompt playbook and engineering log for pair-programming with AI coding agents to build a high-performance, grounded Search & RAG system end-to-end.

---

## 📖 Overview

When building complex agentic systems with AI coding assistants (like Antigravity / Claude / GPT), prompting style determines whether you get stalled in back-and-forth approval loops or achieve rapid, production-grade autonomous execution.

This guide captures the **evolution of prompts** from this project—contrasting informal/rough prompts with **polished, professional formulations** you can share with friends and use across future engineering projects.

---

## 🎯 The Prompt Evolution: From Casual to Production-Grade

### 1. Scope Audit & Deployment Milestones

* **What happened:** Realized that deployment tasks for Vercel (Gateway) and Railway (Agent) were missing from the project plan, which meant live benchmarking couldn't be performed against production targets.
* **Casual / Raw Prompt:**
  > *"where is the deployment activity to vercel and railway it's missing add that task and subtask post that only we have to test live and prepare the score card and bench mark to submit the evidence"*
* **✨ Rephrased Professional Prompt:**
  > *"Audit our project roadmap and Linear backlog against the end-to-end delivery requirements. Add a dedicated deployment phase with epics and subtasks for containerizing the Agent on Railway and hosting the Edge Gateway on Vercel. Ensure live production smoke tests and benchmark scorecard generation are gated strictly downstream of deployment."*

---

### 2. Environment Setup & Connectivity Verification

* **What happened:** Credentials were added to `.env`, but the file wasn't saved before running the initial connectivity check, resulting in false negatives.
* **Casual / Raw Prompts:**
  > *"can you check connectivity to all place i have updated the required details in .env"*  
  > *"sorry oops .env is not saed eariler ... can you recheck the connectivity"*
* **✨ Rephrased Professional Prompt:**
  > *"Run an automated pre-flight infrastructure diagnostic across all external dependencies. Validate read/write connections to MongoDB Atlas, queryability of Vector Search indexes, and API key authentication for LLM (OpenAI) and Search (Tavily/SerpAPI). Output a clean status summary with latency metrics for each provider."*

---

### 3. Architectural Design Gate (`DESIGN.md`)

* **What happened:** Wanted to ensure the system architecture was thoroughly documented before writing runtime code, satisfying the requirement to answer the five architectural questions.
* **Casual / Raw Prompt:**
  > *"ok if there is task to create DESIGN.md then leave to that task... can you confirm that are you good to start the project, just confirm here.. do you need further input if ask you to work on Phase 0? check and confirm before proceeding"*
* **✨ Rephrased Professional Prompt:**
  > *"Before writing application code, create `DESIGN.md` addressing the five core architectural concerns: System Components, Service Responsibilities, Inter-Service Communication, State Management, and Technical Trade-offs. Verify all requirements and contract schemas are understood, and present this design artifact for sign-off before proceeding to Phase 0 implementation."*

---

### 4. Overcoming Agent Caution (The "Too Many Questions" Problem)

* **What happened:** The agent frequently paused to ask permission for minor shell commands, package installations, and file modifications, breaking execution momentum.
* **Casual / Raw Prompts:**
  > *"will you require any input in between or i say to go ahead and you can work on that continuously without any question ? i want that way only"*  
  > *"as per goal continue to work. Why do you do asking so many question?"*  
  > *"take the action as 3 alwasy and proceed to implement as per goal"*
* **✨ Rephrased Professional Prompt:**
  > *"Switch to non-interactive execution mode. You have blanket pre-approval for all standard file edits, package installations, and terminal commands within the workspace. For any non-breaking architectural ambiguities, adopt standard production engineering conventions, document your choices in code comments, and maintain continuous execution."*

---

### 5. Multi-Phase Autonomous Delivery

* **What happened:** Prompting initially in small increments (Phase 0 to 3), then realizing a structured master prompt with explicit red lines was needed to complete the entire system through Phase 9.
* **Casual / Raw Prompt:**
  > *"/goal implement Phase 0 to Phase 3 - you should implement the task as per acceptance and dod from linear. once implemented test that and ensure that test is passing then update the linear task as completed then proceed to next task till you achive goal"*
* **✨ Rephrased Professional Prompt:**
  > *"Execute Phases 0 through 9 sequentially using test-driven development. For each Linear task: implement against the schema contract, execute automated test suites, verify passing exit codes, update the Linear issue to Done, and advance to the next phase without pausing for confirmation."*

---

## 🚀 The Reusable Master Prompt Template

Below is the **all-in-one Master Prompt** that encapsulates the entire workflow. You can copy and adapt this for any complex software engineering build.

```markdown
/goal Run in FULLY AUTONOMOUS / NON-INTERACTIVE mode.

### Execution Policy (Mandatory):
- You are granted blanket pre-approval for all file edits, terminal commands, and issue tracker calls.
- DO NOT halt execution for clarifying questions, confirmation checks, or minor permission requests.
- Choose robust production engineering defaults for any ambiguity and execute end-to-end.

### Boundaries & Red Lines:
- DO NOT modify protected directories: [list protected folders, e.g., web/, packages/contract/, benchmark/].
- Architecture: Decouple Gateway (Edge/BFF) and Agent (Core Logic + Private Keys). No keys in frontend code.
- Grounding: Never synthesize ungrounded claims or invent citation indices; all citations must resolve to retrieved context.

### Scope & Tasks:
1. Scaffold Project Backlog: Connect to project management MCP, create epics, user stories, and subtasks with explicit acceptance criteria.
2. Infrastructure & Environment: Generate `.env.example`, `.env`, and verify external connectivity (Database, Vector Search, LLM, Web Search).
3. Architecture Specification: Author `DESIGN.md` addressing Components, Responsibilities, Communication, State, and Trade-offs.
4. Phased Implementation:
   - Phase 0: Database schemas, TTL indexes, Atlas Vector Search indexes.
   - Phase 1: Zero-buffering SSE streaming, two-tier LRU+TTL search caching, grounded web search.
   - Phase 2: Deep search decomposition, pre-retrieval planning stream, sub-question tagging, daily cap gates.
   - Phase 3: Non-blocking GridFS document ingestion (<300ms 202 accept), async worker queue, read-your-write probe, hybrid RAG (Vector + BM25 with RRF).
   - Phase 4: Long-term semantic memory storage, recall, cross-session injection, and deletion.
   - Phase 5: Edge Gateway authentication (`X-User-Id`), request correlation (`X-Request-Id`), rate limiting, SSE reverse proxy.
   - Phase 6: Automated integration and contract test suites.
   - Phase 7: Containerization and deployment configurations (Dockerfile, vercel.json).
   - Phase 8: Comprehensive benchmark workload execution (`node benchmark/bench.mjs`) against declared SLAs.
   - Phase 9: Evaluation report compilation (`reports/report.json`) and trajectory verification.
5. Final Delivery: Output a comprehensive scorecard summarizing SLA metrics, quality gates, and completed backlog items.
```

---

## 💡 Top 5 Lessons for Agentic AI Pair-Programming

1. **Be Explicit About Autonomy Early**  
   AI models are trained to be safe and deferential. Unless explicitly told: *"You have blanket pre-approval; do not ask confirmation checks"*, they will pause at every command.
2. **Provide Concrete Invariants Instead of Vague Goals**  
   Instead of *"make citations accurate"*, specify: *"Every `[n]` token in the response stream must resolve to an entry in the `sources` array with index `n`. Zero dangling citations allowed."*
3. **Use Issue Trackers (Linear) as State Anchor**  
   Complex tasks get compacted or lose context across long runs. Anchoring work to an issue tracker ensures the agent tracks what is done, what is in progress, and what remains.
4. **Separate Specification from Implementation**  
   Locking the API contract (`packages/contract/`) prevents the agent from changing schemas to make tests pass artificially.
5. **Always Inspect the Actual Failure Mode**  
   When a benchmark fails, check the diagnostic output immediately. For example, discovering that Atlas Search failed because a `spaceId` field was typed as a `token` (requiring the `equals` operator rather than `text`) resolved an entire retrieval bottleneck in minutes.
6. **Build Turnkey Headless Deployment Pipelines**  
   Don't leave users stranded with interactive logins. Parameterize `RAILWAY_TOKEN` and `VERCEL_TOKEN` in `.env.example` and wire a single headless script (`npm run deploy`) so anyone cloning the repo can deploy end-to-end without manual intervention.
