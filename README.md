# Debate Engine

> 带立场的本地 RAG 辩论辅助软件

把别人的论点扔给软件，软件检索本地知识库，以指定立场/意识形态生成有出处的反驳。

---

## 核心特性

- **本地知识库**：资料存本地，引用有出处，不依赖模型参数，无幻觉引用
- **显式立场**：每次反驳明确声明使用哪个意识形态/立场，可随时切换
- **多维度输出**：速辩模式 / 论证模式 / 报告模式 × 8 种回复风格自由组合
- **22 轴意识形态坐标系**：可交互 3D 立方体可视化，支持自定义中心点
- **免费优先**：默认使用 Groq / Gemini / Cerebras 免费 API，本地 Ollama 兜底

---

## 技术栈

| 层次 | 技术 |
|------|------|
| 桌面前端 | Tauri 2.x + React 18 + TypeScript |
| AI 引擎后端 | Python FastAPI (sidecar) |
| 向量数据库 | LanceDB（本地 / S3 双模式）|
| 嵌入模型 | BGE-M3（本地 ONNX，中英双语）|
| 文档解析 | Docling（结构感知 PDF，本地运行）|
| 全文检索 | SQLite FTS5 + jieba 中文分词 |
| 3D 可视化 | React Three Fiber |

---

## 项目结构

```
debate-engine/
├── app/           # Tauri + React 桌面前端
├── backend/       # Python FastAPI AI 引擎
├── knowledge_base/ # 知识库数据目录（运行时，本地管理）
└── docs/          # 架构文档
```

详见 [Software Architecture.md](Software%20Architecture.md)。

---

## 版本路线图

- **V1.0** · 核心引擎（CLI 验证 RAG 质量）
- **V1.1** · 桌面 UI（三栏布局，独立桌面应用）
- **V2.0** · 高级功能（论点图谱、多轮推演）
- **V3.0** · 思想图谱（溯源追踪、跨立场综合）

---

## 文档

- [ARCH-debate-engine.md](ARCH-debate-engine.md) — 核心架构决策（功能/数据/API）
- [ARCH-UI-reference.md](ARCH-UI-reference.md) — UI 规范与组件参考
- [Software Architecture.md](Software%20Architecture.md) — 目录结构与行数红线

---

## 开发状态

**当前阶段：前期设计 / 架构文档完成**

代码开发尚未开始，当前仓库包含完整的架构设计文档。

---

*作者：lulutiyazejin*
