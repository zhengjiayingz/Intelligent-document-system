# 项目优化清单

> **整理日期**：2026-08-16  
> **适用范围**：`intelligent_document` 全栈（Nest 后端 + Vue 3 前端 + Docker/CI）  
> **当前主后端**：`intelligent_document_backend_nest`（Express 版已归档，见 §3.1）

本文档汇总代码审查中发现的优化点，按优先级分类，便于后续逐项推进。每项包含：**问题描述**、**涉及文件**、**建议方案**、**预估难度**。

相关文档：[PERFORMANCE_NOTES.md](./PERFORMANCE_NOTES.md)（登录压测）、[DEVELOPMENT.md](./DEVELOPMENT.md)（本地开发）。

---

## 目录

1. [优先级说明](#1-优先级说明)
2. [P0 — 安全与稳定性](#2-p0--安全与稳定性)
3. [P1 — 后端性能](#3-p1--后端性能)
4. [P1 — 前端性能与 Bundle](#4-p1--前端性能与-bundle)
5. [P2 — 架构与代码质量](#5-p2--架构与代码质量)
6. [P2 — 前端体验与规范](#6-p2--前端体验与规范)
7. [P2 — DevOps / CI / 测试](#7-p2--devops--ci--测试)
8. [建议实施顺序](#8-建议实施顺序)
9. [进度跟踪表](#9-进度跟踪表)

---

## 1. 优先级说明

| 级别 | 含义 | 建议 |
|------|------|------|
| **P0** | 安全漏洞或生产环境稳定性风险 | 尽快处理 |
| **P1** | 明显性能瓶颈或用户体验问题 | 下一迭代优先 |
| **P2** | 技术债、可维护性、规范一致性 | 按资源排期 |

**难度**：🟢 低（1–2 天）｜ 🟡 中（3–5 天）｜ 🔴 高（1 周+）

---

## 2. P0 — 安全与稳定性

### 2.1 密码使用无盐 SHA-256 存储

| 项 | 内容 |
|----|------|
| **问题** | `createHash('sha256')` 无 salt/work factor，存在彩虹表风险 |
| **文件** | `intelligent_document_backend_nest/src/common/password-policy/password-policy.service.ts`（L41–43）<br>Express 遗留：`intelligent_document_backend/src/services/passwordPolicy.service.ts` |
| **建议** | 迁移至 **bcrypt** 或 **argon2**；登录时检测旧 hash 格式，验证通过后自动升级为新算法 |
| **难度** | 🟡 中（需兼容存量用户） |

**验收**：新注册用户使用新算法；旧用户登录后 `password_hash` 字段更新；单元测试覆盖双格式校验。

---

### 2.2 生产环境无条件暴露 Swagger

| 项 | 内容 |
|----|------|
| **问题** | 无 `NODE_ENV` 判断，生产也开放 `/api-docs` 及完整 API 结构 |
| **文件** | `intelligent_document_backend_nest/src/main.ts`（L71）<br>`intelligent_document_backend_nest/src/common/swagger/setup-swagger.ts` |
| **建议** | `NODE_ENV === 'production'` 时禁用；或加 Admin Basic Auth / IP 白名单 |
| **难度** | 🟢 低 |

---

### 2.3 500 错误可能回显内部信息

| 项 | 内容 |
|----|------|
| **问题** | 非 `HttpException` 时生产环境仍可能返回 Prisma/路径等原始 `err.message` |
| **文件** | `intelligent_document_backend_nest/src/common/filters/all-exceptions.filter.ts`（L81–84） |
| **建议** | 生产统一返回「服务器内部错误」；细节仅写入 pino 日志 |
| **难度** | 🟢 低 |

---

### 2.4 静态资源路径与 UPLOAD_PATH 不一致

| 项 | 内容 |
|----|------|
| **问题** | `main.ts` 硬编码 `../intelligent_document_backend/uploads`，而存储层使用 `UPLOAD_PATH`（Docker 中为 `./uploads`） |
| **文件** | `intelligent_document_backend_nest/src/main.ts`（L63–69）<br>`intelligent_document_backend_nest/.env.example`（L15）<br>`intelligent_document_backend_nest/docker-compose.yml`（L29） |
| **建议** | `useStaticAssets(getUploadRootDir())`，与 `storagePath.utils.ts` 统一 |
| **难度** | 🟢 低 |

---

### 2.5 JWT 支持 URL query 传参

| 项 | 内容 |
|----|------|
| **问题** | `?token=` 可能进入 access log、Referer，存在泄露风险 |
| **文件** | `intelligent_document_backend_nest/src/auth/guards/jwt-auth.guard.ts`（L87–90） |
| **建议** | 限定 query token 仅用于 SSE/下载等必要路由；其余路由仅 Accept Header |
| **难度** | 🟢 低 |

---

### 2.6 CORS 配置过宽

| 项 | 内容 |
|----|------|
| **问题** | 允许任意 `http://localhost:*` 与全部 `chrome-extension://` Origin |
| **文件** | `intelligent_document_backend_nest/src/main.ts`（L36–44） |
| **建议** | 改为显式 Origin 列表（环境变量 `CORS_ORIGIN` 逗号分隔）；扩展 ID 白名单化 |
| **难度** | 🟢 低 |

---

## 3. P1 — 后端性能

### 3.1 RAG / 语义检索在应用层全量扫 embedding

| 项 | 内容 |
|----|------|
| **问题** | MySQL JSON 存 embedding + 内存余弦相似度；单文件问答加载全部 chunk；语义搜索最多 200 文件 chunk 全载入内存 |
| **文件** | `src/files/query/files-search.service.ts`（L160–188）<br>`src/files/ai/chat/service/files-ai-rag.service.ts`（L140–176）<br>`prisma/schema.prisma`（L653，注释已写明「量大迁向量库」） |
| **建议** | 引入 **pgvector / Qdrant / Milvus**；短期可对 RAG 做 chunk 级 Redis 缓存 |
| **难度** | 🔴 高 |

**备注**：这是 AI 功能长期瓶颈，文档/chunk 增长后延迟线性上升。

---

### 3.2 网盘列表无分页

| 项 | 内容 |
|----|------|
| **问题** | `userFile.findMany` 无 `take/skip`；`include` 嵌套 `storage` + `userFileTags.tag`，大目录一次请求负载重 |
| **文件** | `intelligent_document_backend_nest/src/files/query/files-query.service.ts`（L180–196） |
| **建议** | 增加 cursor/offset 分页；标签改为 `select` 精简字段或单独接口 |
| **难度** | 🟡 中（需前后端联调） |

---

### 3.3 JWT 鉴权每次请求查 DB

| 项 | 内容 |
|----|------|
| **问题** | 每个受保护请求 `user.findUnique` 校验 `sessionVersion`，高 QPS 下 MySQL 压力大 |
| **文件** | `intelligent_document_backend_nest/src/auth/guards/jwt-auth.guard.ts`（L44–53） |
| **建议** | Redis 缓存 `{ userId → sessionVersion, status }`；踢人/改密/禁用时失效；敏感操作可二次校验 |
| **难度** | 🟡 中 |

**参考**：[PERFORMANCE_NOTES.md](./PERFORMANCE_NOTES.md) 登录压测已验证限流与 Redis 依赖。

---

### 3.4 队列 Worker 并发为 1

| 项 | 内容 |
|----|------|
| **问题** | 文档索引、Office 预览转码串行，多用户同时操作排队严重 |
| **文件** | `src/files/ai/index/processor/document-index.processor.ts`（L43：`concurrency: 1`）<br>`src/files/preview/preview.processor.ts`（L12：`concurrency: 1`） |
| **建议** | 按资源隔离将 concurrency 提到 2–4；embedding API 限流与 LibreOffice CPU 分开配置；加 per-user 公平调度 |
| **难度** | 🟡 中 |

---

### 3.5 以图搜图串行调用外部 embed

| 项 | 内容 |
|----|------|
| **问题** | `for` 循环内逐张 `imageFingerprint.ensure()`，最多 100 次 VL API，延迟可达数十秒 |
| **文件** | `intelligent_document_backend_nest/src/files/ai/image-search/service/image-search.service.ts`（L120–136） |
| **建议** | 上传/索引阶段批量预计算指纹；搜索侧 `p-limit` 并发 + 仅比对已有 `ready` 指纹 |
| **难度** | 🟡 中 |

---

### 3.6 Admin 仪表盘串行查询

| 项 | 内容 |
|----|------|
| **问题** | 约 8 次顺序 `await`，可并行 |
| **文件** | `intelligent_document_backend_nest/src/admin/admin.service.ts`（L57–105） |
| **建议** | `Promise.all` 合并无依赖查询 |
| **难度** | 🟢 低 |

---

## 4. P1 — 前端性能与 Bundle

> 构建数据参考（`pnpm build-only`，2026-08-16）：

| 资源 | min 体积 | gzip |
|------|----------|------|
| 主 vendor JS | ~1140 KB | ~377 KB |
| PDF 相关 JS | ~679 KB | ~231 KB |
| 首页 JS | ~506 KB | ~152 KB |
| renderMarkdown | ~331 KB | ~101 KB |
| Element Plus CSS | ~387 KB | ~58 KB |

---

### 4.1 主包过大，缺少 chunk 策略

| 项 | 内容 |
|----|------|
| **问题** | Vite 警告超过 500 KB；无 `rollupOptions.output.manualChunks` |
| **文件** | `intelligent_document_frontend/vite.config.ts` |
| **建议** | 拆分 `vue`/`vue-router`/`pinia`、`element-plus`、`pdfjs-dist`、`echarts`、`marked+katex` 为独立 chunk |
| **难度** | 🟢 低 |

---

### 4.2 首页同步引入 15+ 重量级弹窗

| 项 | 内容 |
|----|------|
| **问题** | PDF/Office/Video/AI 等全部静态 import；全项目无 `defineAsyncComponent` |
| **文件** | `intelligent_document_frontend/src/views/index/index.vue`（L198–216） |
| **建议** | 预览/AI/裁剪/语义搜索等弹窗改为 `defineAsyncComponent(() => import(...))`，打开时再加载 |
| **难度** | 🟡 中 |

**预期收益**：首屏 JS 可从 ~2MB 降至 ~500KB 量级。

---

### 4.3 全量 Element Plus CSS 进入首屏

| 项 | 内容 |
|----|------|
| **问题** | 组件虽按需注册，但 `import 'element-plus/dist/index.css'` 全量 theme-chalk |
| **文件** | `intelligent_document_frontend/src/main.ts`（L4–5） |
| **建议** | 改为 SCSS 按需引入，或配合 resolver 的 style import |
| **难度** | 🟡 中 |

---

### 4.4 FileList 全量 DOM 渲染

| 项 | 内容 |
|----|------|
| **问题** | `v-for` 为每个文件创建 DOM；项目已有 `@tanstack/vue-virtual` 却未用于主列表 |
| **文件** | `src/views/index/cpns/FileList.vue`（L41）<br>对比：`src/components/TextChunkPreviewDialog/index.vue`（已用虚拟列表） |
| **建议** | 列表模式接入虚拟滚动；网格模式分页或窗口化；缩略图 `IntersectionObserver` 懒加载 |
| **难度** | 🟡 中 |

---

### 4.5 Admin 全量拉用户 + 全量 ECharts

| 项 | 内容 |
|----|------|
| **问题** | `import * as echarts` 未 tree-shake；用户表无分页；主题切换后图表不更新 |
| **文件** | `intelligent_document_frontend/src/views/admin/index.vue` |
| **建议** | `echarts/core` + 按需 chart；用户表分页/虚拟滚动；`watch(themeStore)` 重绘；`resize` debounce |
| **难度** | 🟡 中 |

---

### 4.6 i18n 三语包一次性打包

| 项 | 内容 |
|----|------|
| **问题** | `zh-CN` / `zh-TW` / `en-US` 各 ~900 行、34 KB，全部 eager import |
| **文件** | `intelligent_document_frontend/src/locales/index.ts` |
| **建议** | `vue-i18n` 懒加载 locale：`import(\`./${locale}.ts\`)`，仅加载当前语言 |
| **难度** | 🟢 低 |

---

### 4.7 FriendPanel + Socket.IO 挂在根组件

| 项 | 内容 |
|----|------|
| **问题** | 865 行 `FriendPanel` 在所有路由（含 `/login`）同步挂载，拉入 `socket.io-client` |
| **文件** | `intelligent_document_frontend/src/App.vue`（L5、18） |
| **建议** | `v-if="authStore.isLoggedIn"` 后再异步挂载；或移到首页 layout |
| **难度** | 🟢 低 |

---

## 5. P2 — 架构与代码质量

### 5.1 归档或下线 Express 双栈

| 项 | 内容 |
|----|------|
| **问题** | Nest 已接管 API，Express 仍保留 65+ 路由、Worker、Docker、测试；密码策略等逻辑重复 |
| **文件** | `intelligent_document_backend/` 整个目录<br>`intelligent_document_backend/prisma/schema.prisma`（标注 DEPRECATED） |
| **建议** | 移入 `archive/` 或删除；根 `README.md` 更新为 Nest 启动方式 |
| **难度** | 🟡 中 |

---

### 5.2 拆分「上帝服务」FilesQueryService

| 项 | 内容 |
|----|------|
| **问题** | 984 行单文件：列表、下载、Range、ZIP、文本分片、缩略图、ffmpeg 等 |
| **文件** | `intelligent_document_backend_nest/src/files/query/files-query.service.ts` |
| **建议** | 拆为 `FilesListService`、`FilesDownloadService`、`FilesArchiveService` 等 |
| **难度** | 🟡 中 |

---

### 5.3 首页 / 回收站上帝组件

| 项 | 内容 |
|----|------|
| **问题** | `index.vue` 1071 行、`recycle-bin/index.vue` 1092 行，Sidebar/筛选/批量操作大量重复 |
| **文件** | `src/views/index/index.vue`<br>`src/views/recycle-bin/index.vue` |
| **建议** | 提取 composables：`useDriveFiles`、`useFilePreview`、`useBatchSelection` |
| **难度** | 🟡 中 |

---

### 5.4 Admin 单文件承载 4 个功能区

| 项 | 内容 |
|----|------|
| **问题** | 818 行 SFC：概览、图表、系统设置、用户管理、日志 + 全部业务逻辑 |
| **文件** | `intelligent_document_frontend/src/views/admin/index.vue` |
| **建议** | 拆为 `AdminOverviewCards.vue`、`AdminCharts.vue`、`AdminSystemSettings.vue`、`AdminUserTable.vue` |
| **难度** | 🟡 中 |

---

### 5.5 移除 Prisma bridge 死代码

| 项 | 内容 |
|----|------|
| **问题** | Express 迁移遗留，`PrismaBridgeInit` 未注册到任何 Module |
| **文件** | `src/lib/prisma-bridge.ts`<br>`src/lib/prisma-bridge-init.ts` |
| **建议** | 删除，统一 Nest DI 注入 `PrismaService` |
| **难度** | 🟢 低 |

---

### 5.6 API 层大量 `any` + Pinia 状态过少

| 项 | 内容 |
|----|------|
| **问题** | `api/file.ts` 20+ 处 `request.get<any>`；文件列表/筛选/选中仅在组件内，跨页面无法共享 |
| **文件** | `src/api/file.ts`<br>`src/stores/`（仅 auth、theme、messageUnread） |
| **建议** | 统一 `ApiResponse<T>` + `getData<T>()`；新增 `useDriveStore` 缓存目录状态 |
| **难度** | 🟡 中 |

---

## 6. P2 — 前端体验与规范

### 6.1 首页硬编码中文，i18n 不一致

| 项 | 内容 |
|----|------|
| **问题** | 批量工具栏、拖拽提示、对话框等仍为硬编码中文，同文件其他区域已用 `t()` |
| **文件** | `src/views/index/index.vue`（如 L57–58、81、97、814、1000） |
| **建议** | 补全 `zh-CN`/`en-US`/`zh-TW` 键并替换；`ElMessageBox` 按钮文案走 `t('common.cancel')` |
| **难度** | 🟢 低 |

---

### 6.2 KaTeX / Markdown 全局加载

| 项 | 内容 |
|----|------|
| **问题** | 入口加载 `katex/dist/katex.min.css`；`renderMarkdown` 独立 chunk ~331 KB，登录页不需要 |
| **文件** | `src/main.ts`（L6）<br>`src/utils/renderMarkdown.ts` |
| **建议** | 动态 import + 在使用页面内加载 KaTeX CSS |
| **难度** | 🟢 低 |

---

### 6.3 TypeScript strict 未开启

| 项 | 内容 |
|----|------|
| **问题** | 多处 `as any` 逃逸（auth store、locales、index.vue croppingFile 等） |
| **文件** | `tsconfig.app.json`<br>`src/stores/auth.ts`<br>`src/locales/index.ts` |
| **建议** | 开启 `strict`，逐步修复；locale 用联合类型 `'zh-CN' \| 'zh-TW' \| 'en-US'` |
| **难度** | 🟡 中 |

---

### 6.4 路由守卫调试日志

| 项 | 内容 |
|----|------|
| **问题** | 生产环境仍输出 `console.log` |
| **文件** | `src/router/index.ts`（L114–149） |
| **建议** | 移除或用 `import.meta.env.DEV` 包裹 |
| **难度** | 🟢 低 |

---

### 6.5 生产 build 仍含 Vue DevTools 插件

| 项 | 内容 |
|----|------|
| **问题** | `vite-plugin-vue-devtools` 始终启用 |
| **文件** | `vite.config.ts` |
| **建议** | `mode === 'development'` 时才加载 |
| **难度** | 🟢 低 |

---

## 7. P2 — DevOps / CI / 测试

### 7.1 Docker Compose 缺 MySQL、API 无 healthcheck

| 项 | 内容 |
|----|------|
| **问题** | 仅 Redis + api/worker，MySQL 依赖宿主机 `host.docker.internal` |
| **文件** | `intelligent_document_backend_nest/docker-compose.yml` |
| **建议** | 增加可选 MySQL service；api 加 `healthcheck: GET /health` |
| **难度** | 🟢 低 |

---

### 7.2 CI 与迁移策略不一致

| 项 | 内容 |
|----|------|
| **问题** | CI 用 `prisma db push --accept-data-loss`；Dockerfile CMD 用 `migrate deploy` |
| **文件** | `.github/workflows/backend-ci.yml`（L67）<br>`Dockerfile`（L36） |
| **建议** | CI 改为 `migrate deploy`；避免 schema 漂移 |
| **难度** | 🟢 低 |

---

### 7.3 单元测试未进 CI

| 项 | 内容 |
|----|------|
| **问题** | 31 个 `*.spec.ts` 存在，CI 只跑 `test:e2e`；核心模块（auth/share/files-query/admin）无单测 |
| **文件** | `intelligent_document_backend_nest/src/**/*.spec.ts`<br>`.github/workflows/backend-ci.yml` |
| **建议** | CI 增加 `pnpm test && pnpm test:e2e`；优先补 auth、files-query 单测 |
| **难度** | 🟡 中 |

---

### 7.4 根 README 仍指向 Express

| 项 | 内容 |
|----|------|
| **问题** | 快速开始写的是 `intelligent_document_backend`，实际主后端已是 Nest |
| **文件** | `README.md`（L22–50） |
| **建议** | 更新为 Nest 目录、`pnpm start:dev`、Worker 启动说明 |
| **难度** | 🟢 低 |

---

### 7.5 Nest `.env.example` 缺限流变量文档

| 项 | 内容 |
|----|------|
| **问题** | Express 有 `LOGIN_RATE_LIMIT_*` / `API_RATE_LIMIT_*`，Nest 侧未文档化 |
| **文件** | `intelligent_document_backend/.env.example`（L29–35）<br>`intelligent_document_backend_nest/.env.example` |
| **建议** | 同步限流相关 env 到 Nest `.env.example` |
| **难度** | 🟢 低 |

---

## 8. 建议实施顺序

```
阶段 1（安全，1–2 周）
  → §2.1 密码哈希
  → §2.2 Swagger
  → §2.3 错误信息
  → §2.4 上传路径
  → §2.5 / §2.6 Token 与 CORS

阶段 2（体验与性能，2–3 周）
  → §4.2 首页弹窗 async
  → §4.1 manualChunks
  → §3.2 列表分页 + §4.4 虚拟滚动
  → §3.6 / §4.5 Admin 并行与分页
  → §3.3 JWT Redis 缓存

阶段 3（架构与 AI，按需）
  → §3.1 向量检索
  → §5.1 下线 Express
  → §5.2 / §5.3 / §5.4 大文件拆分
  → §7.2 / §7.3 CI 与测试

阶段 4（ polish）
  → §6.x 前端规范
  → §7.4 / §7.5 文档同步
```

**投入产出最高的 5 项**（若时间有限，优先做这些）：

1. §2.1 密码哈希升级
2. §4.2 首页弹窗 async + §4.1 manualChunks
3. §3.2 网盘列表分页
4. §3.1 RAG 向量检索（AI 长期瓶颈）
5. §5.1 下线 Express + §7.4 更新 README

---

## 9. 进度跟踪表

可在优化过程中勾选状态：

| ID | 标题 | 优先级 | 状态 | 负责人 | 备注 |
|----|------|--------|------|--------|------|
| 2.1 | 密码 bcrypt/argon2 | P0 | ☐ 未开始 | | |
| 2.2 | Swagger 生产限制 | P0 | ☐ 未开始 | | |
| 2.3 | 500 错误信息 | P0 | ☐ 未开始 | | |
| 2.4 | UPLOAD_PATH 统一 | P0 | ☐ 未开始 | | |
| 2.5 | JWT query token | P0 | ☐ 未开始 | | |
| 2.6 | CORS 白名单 | P0 | ☐ 未开始 | | |
| 3.1 | RAG 向量库 | P1 | ☐ 未开始 | | |
| 3.2 | 网盘列表分页 | P1 | ☐ 未开始 | | |
| 3.3 | JWT Redis 缓存 | P1 | ☐ 未开始 | | |
| 3.4 | Worker 并发 | P1 | ☐ 未开始 | | |
| 3.5 | 以图搜图并发 | P1 | ☐ 未开始 | | |
| 3.6 | Admin 并行查询 | P1 | ☐ 未开始 | | |
| 4.1 | Vite manualChunks | P1 | ☐ 未开始 | | |
| 4.2 | 首页弹窗 async | P1 | ☐ 未开始 | | |
| 4.3 | Element Plus 按需 CSS | P1 | ☐ 未开始 | | |
| 4.4 | FileList 虚拟滚动 | P1 | ☐ 未开始 | | |
| 4.5 | Admin ECharts/分页 | P1 | ☐ 未开始 | | |
| 4.6 | i18n 懒加载 | P1 | ☐ 未开始 | | |
| 4.7 | FriendPanel 按需加载 | P1 | ☐ 未开始 | | |
| 5.1 | 下线 Express | P2 | ☐ 未开始 | | |
| 5.2 | 拆分 FilesQueryService | P2 | ☐ 未开始 | | |
| 5.3 | Drive composables | P2 | ☐ 未开始 | | |
| 5.4 | 拆分 admin/index.vue | P2 | ☐ 未开始 | | |
| 5.5 | 删除 prisma-bridge | P2 | ☐ 未开始 | | |
| 5.6 | API 类型 + DriveStore | P2 | ☐ 未开始 | | |
| 6.1 | 首页 i18n | P2 | ☐ 未开始 | | |
| 6.2 | KaTeX 按需 | P2 | ☐ 未开始 | | |
| 6.3 | TS strict | P2 | ☐ 未开始 | | |
| 6.4 | 路由 debug 日志 | P2 | ☐ 未开始 | | |
| 6.5 | DevTools 生产剔除 | P2 | ☐ 未开始 | | |
| 7.1 | Compose MySQL/healthcheck | P2 | ☐ 未开始 | | |
| 7.2 | CI migrate deploy | P2 | ☐ 未开始 | | |
| 7.3 | 单测进 CI | P2 | ☐ 未开始 | | |
| 7.4 | 根 README 更新 | P2 | ☐ 未开始 | | |
| 7.5 | Nest env 限流文档 | P2 | ☐ 未开始 | | |

**状态图例**：☐ 未开始｜◐ 进行中｜☑ 已完成｜— 跳过

---

## 附录：相关命令

```bash
# 前端构建分析体积
cd intelligent_document_frontend
pnpm build-only

# 后端单测 + e2e
cd intelligent_document_backend_nest
pnpm test
pnpm test:e2e

# 登录压测（见 PERFORMANCE_NOTES.md）
cd intelligent_document_backend
k6 run scripts/load/login.k6.js
```

---

*文档随代码演进更新；完成某项后请在 §9 进度表中标记，并在对应章节补充「完成日期 / PR 链接」。*
