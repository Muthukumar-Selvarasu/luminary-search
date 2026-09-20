# Graph Report - lumina-1  (2026-09-18)

## Corpus Check
- 99 files · ~77,134 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: (none) 3, .example 1, .jsonl 1)

## Summary
- 727 nodes · 1149 edges · 36 communities (35 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Web Ask Client (api.ts)
- Agent Ask Loop (executeAsk)
- Agent HTTP API + Mongo
- Benchmark SLA Runner
- Gateway Runtime (Express)
- Root Workspace Scripts
- Web UI Package
- HTTP Contract Schemas
- Eval Report Builder
- Agent Service Package
- Quality Check Rules
- Contract Package
- Persistence Document Schemas
- SSE Event Contract
- Base TypeScript Config
- Web TypeScript Config
- Evals Report Types
- Gold Corpus Builder
- Agent Runtime Deps
- Eval CLI Gates
- Entity ID Types
- Cloud Deploy Tokens
- Fetch Page + Tavily Extract
- Architecture Concepts
- Gold Set Validator
- Agent TypeScript Config
- Gateway TypeScript Config
- Mongo Index Scripts
- Agent DevDependencies
- Contract TypeScript Config
- Agent npm Scripts
- Gateway Env Loader
- Index Status CLI
- Vercel Project Rewrites
- Web vercel.json SPA
- Web UI Route Shell

## God Nodes (most connected - your core abstractions)
1. `db()` - 28 edges
2. `executeAsk()` - 16 edges
3. `compilerOptions` - 16 edges
4. `scripts` - 15 edges
5. `compilerOptions` - 15 edges
6. `env` - 11 edges
7. `SseStream` - 10 edges
8. `runRag()` - 10 edges
9. `ask()` - 9 edges
10. `hybridSearchDocuments()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `Agent Service (:8000)` --implements--> `Deep Search Engine`  [EXTRACTED]
  README.md → SPEC.md
- `Agent Service (:8000)` --implements--> `Semantic Memory System`  [EXTRACTED]
  README.md → SPEC.md
- `Agent Service (:8000)` --implements--> `RAG & Jobs Worker`  [EXTRACTED]
  README.md → TECHNICAL.md
- `Agent Service (:8000)` --implements--> `Two-Tier Search Cache`  [EXTRACTED]
  README.md → SPEC.md
- `Gateway Service (:8787)` --implements--> `SSE Streaming Protocol`  [EXTRACTED]
  README.md → SPEC.md

## Import Cycles
- None detected.

## Communities (36 total, 1 thin omitted)

### Community 0 - "Web Ask Client (api.ts)"
Cohesion: 0.06
Nodes (55): initSseStream(), packages_contract_dist_index, packages_contract_dist_index_askbody, packages_contract_dist_index_askmode, packages_contract_dist_index_depth, packages_contract_dist_index_doneevent, packages_contract_dist_index_evalsreport, packages_contract_dist_index_gateresult (+47 more)

### Community 1 - "Agent Ask Loop (executeAsk)"
Cohesion: 0.06
Nodes (48): clampPlan(), defaultPlan(), executeAsk(), ExecuteAskParams, hitCap(), log, RetrievedPassage, pingDb() (+40 more)

### Community 2 - "Agent HTTP API + Mongo"
Cohesion: 0.05
Nodes (53): db(), app, handleMemoryDelete(), implementedRoutes, log, persistUploadedDocument(), spaceCache, threadCache (+45 more)

### Community 3 - "Benchmark SLA Runner"
Cohesion: 0.07
Nodes (54): argv, assertSla(), buildWorkload(), cap(), client, computeMetrics(), distinctSources(), fail() (+46 more)

### Community 4 - "Gateway Runtime (Express)"
Cohesion: 0.05
Nodes (36): dependencies, cors, dotenv, express, @lumina/contract, pino, pino-http, zod (+28 more)

### Community 5 - "Root Workspace Scripts"
Cohesion: 0.06
Nodes (34): description, devDependencies, concurrently, eslint, @eslint/js, typescript, typescript-eslint, engines (+26 more)

### Community 6 - "Web UI Package"
Cohesion: 0.07
Nodes (27): react-dom, @types/react, @types/react-dom, vite, @vitejs/plugin-react, dependencies, @lumina/contract, react (+19 more)

### Community 7 - "HTTP Contract Schemas"
Cohesion: 0.07
Nodes (26): ACCEPTED_UPLOAD_TYPES, AskBody, AskMode, CreateSpaceBody, CreateSpaceResponse, CreateThreadBody, CreateThreadResponse, DocumentRow (+18 more)

### Community 8 - "Eval Report Builder"
Cohesion: 0.09
Nodes (16): argv, automated, bench, brokenRedLines, HERE, manual, outPath, quality (+8 more)

### Community 9 - "Agent Service Package"
Cohesion: 0.10
Nodes (20): description, dotenv, express, @lumina/contract, pino, tsx, @types/express, @types/node (+12 more)

### Community 10 - "Quality Check Rules"
Cohesion: 0.11
Nodes (16): CHECKS, ctx, evalPath, exp, expPath, fail(), GLYPH, HERE (+8 more)

### Community 11 - "Contract Package"
Cohesion: 0.10
Nodes (19): dependencies, zod, description, devDependencies, typescript, exports, files, typescript (+11 more)

### Community 12 - "Persistence Document Schemas"
Cohesion: 0.10
Nodes (19): ChunkDoc, COLLECTIONS, DocumentDoc, EMBEDDING_DIMS, GRIDFS_BUCKETS, iso, JobDoc, JobKind (+11 more)

### Community 13 - "SSE Event Contract"
Cohesion: 0.12
Nodes (17): AskStreamEvent, AskTool, citationNumbers(), DEEP_ONLY_TOOLS, Depth, DoneEvent, Locator, PlanEvent (+9 more)

### Community 14 - "Base TypeScript Config"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution (+8 more)

### Community 15 - "Web TypeScript Config"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+8 more)

### Community 16 - "Evals Report Types"
Cohesion: 0.13
Nodes (14): BenchReport, DesignAnswers, EvalsReport, GateResult, QualityReport, QualityRuleResult, RubricReport, RubricRow (+6 more)

### Community 17 - "Gold Corpus Builder"
Cohesion: 0.21
Nodes (11): AS_MD, AS_PDF, buildPdf(), esc(), HERE, manifest, OUT, pageContent() (+3 more)

### Community 18 - "Agent Runtime Deps"
Cohesion: 0.17
Nodes (12): dependencies, dotenv, express, jsdom, @lumina/contract, mongodb, @mozilla/readability, multer (+4 more)

### Community 19 - "Eval CLI Gates"
Cohesion: 0.17
Nodes (5): argv, deployUrl, gates, HERE, ROOT

### Community 20 - "Entity ID Types"
Cohesion: 0.17
Nodes (8): AnswerId, ArtifactId, DocId, MemoryId, RequestId, SpaceId, ThreadId, UserId

### Community 21 - "Cloud Deploy Tokens"
Cohesion: 0.18
Nodes (6): RAILWAY_TOKEN, railwayEnv, VERCEL_ORG_ID, VERCEL_PROJECT_ID, VERCEL_TOKEN, ref_node_child_process

### Community 22 - "Fetch Page + Tavily Extract"
Cohesion: 0.29
Nodes (9): secrets, capContent(), extractFromHtml(), fetchPage(), FetchPageOutput, pageCache, tavilyExtract(), jsdom (+1 more)

### Community 23 - "Architecture Concepts"
Cohesion: 0.25
Nodes (9): Agent Service (:8000), Deep Search Engine, Gateway Service (:8787), LUMINA Architecture, Semantic Memory System, MongoDB Atlas Vector Search, RAG & Jobs Worker, Two-Tier Search Cache (+1 more)

### Community 24 - "Gold Set Validator"
Cohesion: 0.22
Nodes (7): byDoc, HERE, items, manifest, problems, seen, ref_node_path

### Community 25 - "Agent TypeScript Config"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, types, extends, include, ../../tsconfig.base.json

### Community 26 - "Gateway TypeScript Config"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, types, extends, include, ../../tsconfig.base.json

### Community 27 - "Mongo Index Scripts"
Cohesion: 0.25
Nodes (6): mongodb, client, HERE, limit, outDir, ROOT

### Community 28 - "Agent DevDependencies"
Cohesion: 0.29
Nodes (7): devDependencies, tsx, @types/express, @types/jsdom, @types/multer, @types/node, typescript

### Community 29 - "Contract TypeScript Config"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, ../../tsconfig.base.json

### Community 30 - "Agent npm Scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, start, typecheck, worker

### Community 31 - "Gateway Env Loader"
Cohesion: 0.33
Nodes (4): env, here, ref_dotenv, ref_node_url

### Community 32 - "Index Status CLI"
Cohesion: 0.33
Nodes (5): ref_node_fs, client, HERE, spec, statusOnly

### Community 33 - "Vercel Project Rewrites"
Cohesion: 0.40
Nodes (4): buildCommand, framework, outputDirectory, rewrites

### Community 34 - "Web vercel.json SPA"
Cohesion: 0.50
Nodes (3): _comment, rewrites, $schema

## Knowledge Gaps
- **371 isolated node(s):** `name`, `version`, `private`, `type`, `description` (+366 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 442 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `SSE Streaming & Protocol` to `API Contract & Schemas`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Why does `mongodb` connect `Database & Persistence` to `Fs Subsystem`, `API Contract & Schemas`, `SSE Streaming & Protocol`, `SSE Streaming & Protocol`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Why does `cors` connect `Gateway & Edge Proxy` to `SSE Streaming & Protocol`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _371 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `SSE Streaming & Protocol` be split into smaller, more focused modules?**
  _Cohesion score 0.056049213943950786 - nodes in this community are weakly interconnected._
- **Should `SSE Streaming & Protocol` be split into smaller, more focused modules?**
  _Cohesion score 0.06057945566286216 - nodes in this community are weakly interconnected._
- **Should `SSE Streaming & Protocol` be split into smaller, more focused modules?**
  _Cohesion score 0.05110809588421529 - nodes in this community are weakly interconnected._