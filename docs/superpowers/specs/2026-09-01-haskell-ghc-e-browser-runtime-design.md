# Haskell GHC `-e` 浏览器运行时设计

**日期：** 2026-09-01  
**状态：** Approved by explicit user decisions and ambiguity-free self-review  
**产品：** LocalCoder

## 1. 决策、目标与范围

LocalCoder 继续提供受限 Haskell 源码编译，统一使用 `ghc -e` 解释执行。它服务于本地算法练习，不改变 Runtime Kernel 中由主线程 OJ 选择用例、比较 expected 值并决定 verdict 的边界。

生产调用固定为：

```text
ghc -ignore-dot-ghci -v0 -B /ghc -hide-all-packages -package base -e main /work/Main.hs
```

实现可因真实 GHC 的可验证要求做最小参数调整。每增加一个 package，必须更新构建期 profile 合同并重新完成全部证明门，不得把临时可用的 package 作为隐式依赖。

本阶段不包含 GHCi UI、Template Haskell、用户代码的 C 或 JS FFI、任意 Hackage 或 Cabal、网络、文件、进程或线程能力、静态 `program.wasm` 输出、wasm-ld 或 clang 集成、任意 package 集、MLE verdict、安全沙箱、权威设备计时、Racket 或 RustPython 改造，以及 UI 重构。`readonly` 仅描述内容和 namespace 隔离，不构成安全沙箱，也不承诺 inode 历史不可见。

## 2. 已证实的起点

`haskell-ghc-wasi` 已 packaged，但仍是 unverified，产品保持 disabled。此前 bounded 迁移已把压缩资产改为 `ghc.wasm.gz.bin` 与 `libdir.tar.gz.bin`，tar producer 前导 `./` 已安全接受；focused 测试为 24/24、全量测试为 295/295，build 和 smoke 通过。真实浏览器初始化失败，所以这些改动不能单独被视为完成。当前 Worker buildId 是 `cb5ee067f9482da3`，它仅是此代构建相关值，不是将来实现的永久 identity。

完整 libdir gzip 为 643,211,474 B，解压 tar 为 2,898,432,000 B，payload 为 2,888,833,482 B。在 Chromium，eager `Response(...).arrayBuffer()` 会以 `TypeError: Failed to fetch` 失败，并达到约 3.54 GB working set 与 4.31 GB private memory。streaming reader 完整成功，约 25.3 秒，约 773 MB working set 和 501 MB private memory。现有 tar 加 entry slice 加每 operation `File` copy 的主数据理论峰值约 8.676 GB，不能进入发布方案。

当前 `ghc.wasm` 除 WASI 外还导入 `ghc_wasm_jsffi`，包括 ObjLink 的 `findSystemLibrary`、`addLibrarySearchPath`、`lookupSymbol`、`loadDLLs`，以及 promise、type、JSVal 和 scheduler 接口。当前 `runHaskellWasi()` 只提供 WASI，必然无法 instantiate。libdir 中的 `prelude.mjs` 提供 JSValManager 与 scheduler，`post-link.mjs` 可以从 custom sections 生成 imports，`dyld.mjs` 提供 `DyLDBrowserHost`、`main` 和 in-memory VFS；但它的 browser 分支会远程 import esm.sh shim，违反 LocalCoder 的 same-origin 与离线合同。

## 3. 备选方案与取舍

1. **构建期裁剪 dynamic eval profile，加本地 JSFFI 和 dyld binding，采用 `ghc -e`，本设计选择。** 它保留源码执行体验，并把可交付资产限制为经真实证明的闭包。代价是需要验证 GHC 内部动态加载和浏览器内存合同。
2. **仅预编译程序。** 这是最小、最可靠的路径，但失去编辑源码后即时编译的产品体验，用户未选择。
3. **`ghc -o` 加浏览器 wasm-ld 静态编译。** 它会重新引入外部 wasm-ld、链接工具链和静态输出链路，复杂度与失败面均扩大，用户未选择。
4. **完整 GHCi 或完整动态 package set。** 这是超出产品需求的功能和预算承诺，拒绝。若真实 `ghc -e` 证明表明必须带入 33 个包的完整 GHC/GHCi 动态闭包，其静态估算 916,339,975 B 是预算停止信号，不是默认可接受资产。
5. **停止 Haskell 支持。** 保留为诚实的停止条件：任一证明门无法在预定设备预算内通过时，运行时继续 `LOADABLE_UNVERIFIED` 或转为 `UNAVAILABLE`，不以降级路径伪装成功。

## 4. 架构与数据所有权

### 4.1 构建期 dynamic eval profile

完整 2.9 GB libdir 不是发布目标。构建期生成固定的 `dynamic eval profile`，初始候选闭包为 `base`、`ghc-internal`、`ghc-prim`、`rts` 的 `.dyn_hi` 和非 profiling `.so`，连同必要的 `conf`、cache、settings、dyld、prelude、post-link 文件及展开后的 symlink。静态估算为 136,093,711 B，只用于决定先做何种实验，不能作为发布合同。

profile 生成器必须从版本锁定的 GHC 输入和显式 allowlist 产生：裁剪 tar、package DB、展开后的符号链接清单、每个文件的路径与 SHA-256、总字节数、上游许可证与归属清单。使用匹配的 `wasm32-wasi-ghc-pkg recache` 重建 package cache。若构建环境没有与 GHC 完全匹配的该工具链，生成阶段为 blocked，禁止手写、拷贝或伪造 cache。

profile 的唯一成立条件是实际浏览器中的 `ghc -e` toggle 证明。它至少要分别证明最小 `main`、`base` 解析、动态加载和 `solution :: String -> String` judge 包装所需的内容。任何缺失文件或新增 package 都要被记录为 profile 差异并重新验证。

### 4.2 本地 JSFFI 与 dyld

新增版本锁定的 `HaskellJsffiRuntime` 本地绑定模块。它消费经审核的、随 profile 一同打包且纳入 Worker identity 的 prelude、post-link 与 dyld 资产，只暴露启动 GHC 所需的 JSFFI import object、JSVal 生命周期、promise/type/scheduler 服务和 ObjLink 所需的本地库查询。

它必须拒绝 remote URL、动态 import、运行时拼接或生成而未进入 identity 的代码。`post-link.mjs` 的 custom-section 结果只能由构建期锁定的资产产生，运行时只装载 manifest 已声明且同源的模块。`DyLDBrowserHost` 的替代 binding 必须绑定本地 in-memory VFS 和本地库索引，禁止沿用会导入 esm.sh 的浏览器分支。这里不预设第三方 API 的精确签名，接口合同为：输入是锁定资产描述符和只读库索引，输出是 WebAssembly import namespaces 与本地动态库解析服务；不支持的 import、版本不匹配、远程来源或 shim 异常必须返回结构化基础设施失败。

### 4.3 A′ 共享边界与 operation filesystem

共享边界采用 A′。Worker generation 只缓存每个 libdir 文件精确定长的 `ArrayBuffer` snapshot 与不可变 descriptor，例如路径、字节长度、hash、文件类型和加载状态。绝不跨 operation 共享 shim 的 `File`、Inode、Directory、`Map`、FD、WASI 实例、stdio、cwd、env 或 WebAssembly instance。

`SharedLibdirSnapshot` 完成加载后，`instantiateOperationFilesystem(snapshot, source, input)` 为每次 execute 和每个 judge case 创建新的 root、`/work`、shim File/Directory 图、WASI、stdio、cwd、env 和 WebAssembly instance。创建只读 libdir 文件时必须调用形如 `new File(arrayBuffer, { readonly: true })` 的 view 路径，禁止传入 `Uint8Array` 触发复制。每个节点可引用同一个 snapshot buffer，但节点对象、Map、FD 和可变 API 状态必须不同。用户源文件、stdin、输出和编译产物只能位于该操作的 `/work`。

这项隔离避免操作间内容和 namespace 污染，不是对恶意代码的安全隔离。Worker 终止仍只改善本地响应性，不能产生 MLE 或权威性能判断。

### 4.4 流式加载与内存预算

压缩 profile tar 通过 `ReadableStream` reader、增量 gzip 解压和 streaming tar parser 进入 `SharedLibdirSnapshot`。解析器验证路径、header、长度、截断、重复与不支持的 entry 类型，在完整验证前不发布 snapshot。不得调用 eager `Response(...).arrayBuffer()`，也不得为了兼容性保留 eager fallback。

生产测试必须证明没有第二份 Θ(S_trim) payload。允许的持久数据是每个 profile 文件的精确定长 buffer 和 descriptor；允许的短寿命数据是受上限约束的 streaming chunk、tar header 和当前文件写入缓冲。实现前必须预先确定最低支持设备的可用内存预算、冷启动时间预算和并发策略。加载、operation 和浏览器 private/working set 任一测量或保守上界超过已确定设备预算的 70% 时停止，不得从当前开发机的成功结果推导支持性，也不得以整包或 eager 路径规避该门。

## 5. 执行与错误生命周期

metadata schema 收窄为 `ghc-e` 执行模式，声明 profile、JSFFI、dyld、本地 shim 资产、hash、字节数和必要的 profile contract。`ghc-compile` 与 `ghci` 不再是生产可选模式。catalog、Worker identity 和 generated manifest 必须将全部 profile 与 binding 资产视为 Haskell identity 输入。

Executor 直接执行用户源码。judge 也使用 `ghc -e` 的 `solution :: String -> String` 包装，不再调用当前 `ghc-compile -o program.wasm` 方式，因为后者要求外部 wasm-ld。每个 case 单独编译并执行，不引入自动 compile-once 优化。Worker 只返回实际 JSON-compatible 值或结构化 compile、runtime、infrastructure、protocol、cancelled 失败；expected、comparison 和 verdict 继续完全由主线程 OJ 拥有。

snapshot 状态严格为 `EMPTY → LOADING → READY`。hash、路径、截断、gzip、OOM、JSFFI 或 dyld 失败都不得发布 partial snapshot，并将当前 generation 视为基础设施故障。compile 或 runtime 错误若基础设施仍健康，可以保留 verified generation。timeout、cancel 或未知 shim fault 必须终止 Worker；下一次显式操作在 fresh Worker 中重新 initialize。不得自动 replay 当前或排队操作。所有失败都保留现有输出限制内的结构化 details、阶段和已握手 identity；握手前失败不得捏造 build identity。

## 6. 严格证明门

任何门失败都使 `haskell-ghc-wasi` 保持 unverified 且 disabled，不得降级为 eager、完整 libdir、远程 import 或静态编译 fallback。

| 门 | 证明内容 | 通过证据 |
|---|---|---|
| Gate A，compiler startup | 仅用本地版本锁定 JSFFI glue，在空或最小 FS 中运行 `ghc --numeric-version` 或等价检查，且不触发 dyld。 | Chromium 中成功 instantiate、标准输出、无网络请求、所载 binding 的 identity。 |
| Gate B，build-time dynamic profile | 固定闭包、symlink 展开、匹配 `ghc-pkg recache`、manifest 的 hash/bytes/license。 | 生成可复现的 profile 报告和资产清单；实际工具链缺失时明确 blocked。 |
| Gate C，browser dyld 与 `ghc -e` | 最小 main、Unicode JSON、compile failure、runtime failure，以及无 remote request。 | Chromium 测试记录每个结果和 Network 日志的远程请求数为 0。 |
| Gate D，streaming snapshot 与 fresh-node 隔离 | streaming tar 到 `SharedLibdirSnapshot`、每 operation fresh node、内存合同。 | 无 eager fallback、无第二份 Θ(S_trim) payload、不同 case 的节点对象不同且可复用 buffer、变异 API 不污染 snapshot。 |
| Gate E，产品集成 | existing optional-v1 receipt、timeout/cancel/fresh-worker 恢复、Executor 与 judge contract。 | 当前 manifest 和 identity 匹配的 receipt，产品中可执行和判断，故障后下一次显式操作在新 Worker 成功。 |

Chromium 至少必须通过。Firefox 与 WebKit 是产品化前兼容门，不得表述为已验证。Gate E 之前，`LOADABLE_UNVERIFIED` 和 `UNAVAILABLE` 都是诚实的禁用状态，exit code 2 不是通过。

## 7. 预期文件面与迁移

以下是实现应触及的精确文件面，列出的新增文件名是本设计建议，实际实现可在相同职责目录内拆分，但不得扩大职责或跳过合同：

| 范围 | 文件 | 责任 |
|---|---|---|
| Profile 输入与生成 | `runtimes/haskell-ghc/build.mjs`、`runtimes/haskell-ghc/runner.meta.json`、新增 `runtimes/haskell-ghc/dynamic-e-profile.json` | 固定 allowlist、版本、执行模式与构建输入合同。 |
| 构建脚本 | `scripts/build-runtimes.mjs`、新增 `scripts/lib/haskell-ghc-dynamic-profile.mjs`、`scripts/lib/runtime-catalog.mjs` | 生成并校验裁剪资产、recache、许可证清单和 manifest asset groups。 |
| Identity 与生成物 | `scripts/lib/worker-build-identity.mjs`、`scripts/build-worker-assets.mjs`、生成的 `public/haskell/*`、`public/runtime-manifest.json` | 把 profile、JSFFI、dyld 和 shim 纳入 identity，不手改生成物。 |
| Worker 加载 | `src/workers/haskell/assets.ts`、新增 `src/workers/haskell/jsffi-runtime.ts`、新增 `src/workers/haskell/streaming-tar.ts`、新增 `src/workers/haskell/shared-libdir-snapshot.ts` | 校验 metadata，装载同源本地 binding，以流式方式创建 immutable snapshot。 |
| Worker 执行 | `src/workers/haskell/wasi-execution.ts`、`src/workers/haskell/ghc-host.ts`、`src/workers/haskell/tar-filesystem.ts`、新增 `src/workers/haskell/operation-filesystem.ts` | 供应 JSFFI 与 WASI imports，并为每个 operation/case 创建 fresh filesystem 和 instance。 |
| 契约与验证 | `src/workers/haskell.worker.ts`、`src/runtime/adapters/haskell.ts`、`src/harness/runtime-contract-harness.ts`、`scripts/verify-optional-runtime.mjs` | 维持 endpoint、optional-v1、主线程 OJ 所有权和恢复语义。 |
| 测试 | `tests/workers/haskell-bridge.test.ts`、`tests/workers/haskell-filesystem.test.ts`、新增 `tests/workers/haskell-jsffi-runtime.test.ts`、新增 `tests/workers/haskell-shared-libdir-snapshot.test.ts`、`tests/integration/build-worker-assets.test.ts`、`tests/scripts/runtime-manifest-generation.test.mjs` | TDD 覆盖资产合同、隔离、错误与生成 identity。 |
| 文档与 LFS | `.gitattributes`、`README.md`、`runtimes/haskell-ghc/README.md`、`docs/operations/runtime-assets.md`、`docs/qa/2026-08-24-localcoder-rebuild-results.md` 或其后继 QA 记录 | 同步 LFS 资产、产品可用性、操作要求与当前 receipt。 |

Gate B 成功前，现有巨大 `.bin` 保留为诊断资产，不提交新架构已完成的状态，也不据此启用运行时。Gate B 成功后才生成裁剪资产、更新 LFS 跟踪与 manifest。旧的 current Haskell QA failure 必须被归档或由带日期的新 QA 结果明确替代，不能与新的 verified claim 并存而造成歧义。CI 不重建外部 GHC 工具链，只消费固定、经 LFS 检出的资产，并验证 manifest、identity、hash、许可证和浏览器 receipt。

## 8. 测试、验收与安全

按 TDD 先写失败测试，再实现最小行为。每个组件至少包含 happy、edge 和 regression 用例。生产级测试必须覆盖：空或最小启动、动态闭包缺件、非法 hash/path、截断流、OOM/JSFFI/dyld 结构化失败、Unicode JSON、compile/runtime 失败、`-hide-all-packages -package base` 命令合同、judge 每 case 的 fresh root/WASI/instance、timeout/cancel 后 fresh Worker、无自动 replay，以及现有输出截断边界。

特别的回归断言是：不存在 eager fallback；不存在第二份 Θ(S_trim) payload；两个 case 的所有节点对象完全不同但可引用相同 buffer；全部可变 API 均不能污染 snapshot；远程请求数为 0；manifest 与 receipt 的 identity 为当前值。浏览器验收在 Chromium 中运行，并记录设备预算、峰值、网络日志、握手 build identity 与 optional-v1 receipt。超过预先确定预算 70% 的结果是停止，不是性能优化待办。

资产、GHC、JSFFI glue 和 dyld binding 的上游许可证必须由 Gate B 生成的清单逐项保留。加载器只接受 manifest 声明的同源路径和匹配 hash，拒绝路径穿越、远程模块和未声明资产。这些检查改善供应链一致性和操作隔离，但不把浏览器 Worker、readonly 文件或本地计时描述成安全或权威边界。

## 9. Spec self-review

- 无 `TBD`、`TODO`、占位符或未指定的交付结论。
- 无矛盾：生产和 judge 都是 `ghc -e`，完整 libdir 只作诊断，optional runtime 只有 current receipt 才能启用。
- 范围单一：只设计 Haskell GHC `-e` 浏览器运行时及其资产、Worker 和验证合同，不扩展到其他运行时或 UI 重构。
- 所有不确定性均通过 Gate A 至 Gate E、匹配工具链要求或明确停止条件处理；未把静态估算、打包状态或本机观察误写为发布保证。

*作者注：面向负责实现和验收 Haskell 可选运行时的维护者，要求他们先逐门证明 `ghc -e` 的可交付性，再改变产品可用状态。*
