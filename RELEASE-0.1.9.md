# Debate Engine v0.1.9 发布报告 (2026-08-24)

## 一、版本目标对照（PLAN-0.1.9.md）

| 项 | 文件/模块 | 状态 | 备注 |
|---|---|---|---|
| **D1** | years.py/parsers.py/confirm.py/knowledge.py/sqlite_store/LibraryFace/dates.ts/MetadataDialog | ✅ 完成 | 紧凑时间戳解析 + sane_year 统一 + 存量迁移钩子 |
| **D2** | ArchiveView | ✅ 完成 | stanceLabel 映射 + 头部说明 |
| **D3** | styles.css/RadarView/SVG text 全局清理 | ✅ 完成 | .viz-cap fill 修复；SVG text 无 muted/small |
| **V1** | CubeView | ✅ 完成 | drawCube 大立方移植 R=0.07 两遍中心切换 |
| **V3** | TimelineView | ✅ 完成 | beeswarm 蜂群布局自适应泳道高密度感知 |
| **E1** | sqlite_store/alignment.py/analysis.py/reextract.py/GraphPanel | ✅ 完成 | relations_at 记账双按钮增量全量 |
| **E2** | ReextractButton | ✅ 完成 | askConfirm 二次确认 |
| **L1** | FolderRoot/LibraryFace | ✅ 完成 | 文件夹两级导航删除 DocTree 清死码 |
| **L2** | LibraryFace + CSS | ✅ 完成 | ImportPanel 左栏中区五视图滑移 |
| **L3** | LibraryFace/FolderRoot/ReextractButton/analysis/import_panel/styles | ✅ 完成 | 工具条两行面包屑过滤待提取坐标角标批量点名 |
| **R1** | skill_migrator/main.py/rebuttal_engine.py/skills/styles.md | ✅ 完成 | 通用迁移器 + daily/plain 风格格式 |
| **R2** | RespondFace | ✅ 完成 | 组头 onContextMenuOverlayMenu(整组注入/改名/删除)；移除×按钮 |
| **R3** | DocExplorer | ✅ 完成 | 次立场列显示 |
| **S1** | styles.css + settings/*.tsx | ✅ 完成 | .set-row 对齐+单位 4 组 radio→SegmentedSlider |
| **版本号同步** | config.py/Cargo.toml/tauri.conf.json/installer.nsi | ✅ 同步 | 均为 0.1.9 |

---

## 二、静态验证证据

- `tsc --noEmit` → **EXIT=0**（无类型错误）
- `vite build` → **EXIT=0**（产物含 CubeView chunk）
- 后端 `py_compile` → **EXIT=0**
- `import main` → **OK**（VERSION=0.1.9）

---

## 三、运行时冒烟测试（实库 2 文档）

端点 / 行为 | 结果
---|---
/api/health | {"status":"ok","version":"0.1.9",...}
/api/analysis/coords/pending_count | {count:2} 缺失或全 0 坐标计数
/api/analysis/relations/pending_count | {count:2} relations_at IS NULL 数
/api/rebuttal/options | styles 含 `daily`, formats 含 `plain`
/api/import/archive-policy | {policy:"ask"} 配置读取正常
/api/config/proxy | {mode:"off",url:""} 配置读取正常
/api/config/params | 数值参数返回正常

技能迁移器单元验证：旧 styles.md（无 daily）启动后补齐 daily，用户自定义小节原样不动，幂等（二次运行无变更）。

---

## 四、打包产出物

### 4.1 Portable 包（沙箱内可组装）
位置：`release/DebateEngine-0.1.9-portable`  
大小：**398 MB**（1006 文件）  
结构（与 NSIS 安装器一致）：
```
DebateEngine-0.1.9-portable/
├─ Debate Engine.exe        # Tauri 窗口壳（嵌入式前端 dist）
├─ engine/                  # PyInstaller 冻结引擎
│  ├─ DebateEngine.exe      # FastAPI 服务进程
│  └─ ...
└─ knowledge_base/
   └─ skills/               # skill 模板（styles/fallacies/centers/stances）
```
使用方式：解压到任意目录，先运行 `engine/DebateEngine.exe serve` 启动引擎，再运行 `Debate Engine.exe` 打开界面。

### 4.2 NSIS Installer（需本地 NSIS）
命令：
```powershell
cd backend\packaging
makensis installer.nsi
# 输出：release\DebateEngine-0.1.9-Setup.exe
```
条件：
- 已下载 cargo/Tauri Rust 编译链 (`~/.cargo/bin/cargo`)
- 本地系统有 Python 虚拟环境且 `.venv` 存在
- NSIS 已安装（提供 makensis.exe）

由于 makensis 未出现在沙箱路径中，安装包需用户在本地执行上述命令生产。

---

## 五、已知限制

| 项目 | 原因 | 方案 |
|---|---|---|
| NSIS 安装包无法在沙箱直接生成 | makensis.exe 不存在于 PATH 及常见安装路径 | 本地运行 `makensis backend\packaging\installer.nsi` |
| Portable 包无自动化桌面快捷 | NSIS 的快捷/注册表卸载功能由安装包脚本处理 | 手动创建快捷指向 `Debate Engine.exe` |

---

## 六、核心改动要点

1. **年份健全**（D1）：后端 `sane_year()` 识别 ISO 日期、紧凑 14 位时间戳；存量钩子跳过手动字段；前端表单接受完整日期，档案卡回显归一化原文。
2. **关系边增量**（E1）：新增文档只跑“新×全库”，全量需二次确认；reextract 自动清零 `relations_at`。
3. **立方图恢复**（V1）：drawCube 从 demo 原样移植；撤销 R=0.22 误修；两遍中心切换解决点/线/框错位。
4. **脉络 beeswarm**（V3）：无年份也铺满画布；高密度泳道关闭常显标签。
5. **馆藏文件夹**（L1/L2）：根层立场 → 二层文档列表；导入面板左栏；面包屑控制导航。
6. **待提取坐标**（L3）：黄色角标实时显示缺失/全 0 数量；点击重提取复用 E2 确认流程。
7. **回应面素材组**（R2）：右键菜单替代组头“改/×”减少误触；改名走后端 PATCH。
8. **设置页规范化**（S1）：数字框右缘对齐 + 单位后缀；全部 radio → SegmentedSlider。
9. **技能迁移器**（R1）：通用机制追加 `## daily` 等缺项，不覆盖用户改动；NSIS `SetOverwrite off` 场景友好。

---

## 七、验收结论

- ✅ 代码实现：全部 15 项 PLAN-0.1.9 需求落地（L3/R1/R2/S1 移至“完成”台账）
- ✅ 静态验证：编译 0 错（TypeScript/Python）
- ✅ 运行时验证：实库冒烟通过，所有新端点返回正确数据
- ⚠️ 安装包：Portable 包可直接用；NSIS 安装包需本地运行 `makensis` 命令

**建议下一步**：用户在具备 NSIS 环境中执行 `makensis backend\packaging\installer.nsi` 生成最终 Setup.exe 用于分发。
