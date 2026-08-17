### 2.4 版本号与打包
- **三处版本号同步 bump**：`package.json` + `Cargo.toml` + `tauri.conf.json`，勿漏。
- 补丁项不 bump；默认只打包 NSIS 安装包（Windows）。

### 2.5 编辑工具级铁律（防事故）
- **SearchReplace 后必须复读确认改动真正落地**，不凭工具返回值认定；匹配失败用探针法（原样重试）判断首次是否已写入，防重复写入。
- 锚点选唯一且短的文本；多处改动**从下往上改**（先大行号后小行号）防行号漂移。
- 提交前逐字核对 new_text 确实含目标改动，防空改动。
- 新增代码时 import/use 同步就位（serde derive、HashMap、Path、lucide 图标等）。
- 路径先搜索定位，不凭猜测拼路径。
- 方案切换后及时清死码（Rust `dead_code` / TS TS6133）。

---