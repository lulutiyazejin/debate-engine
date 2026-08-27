// 设置·知识库分区（0.1.5 B1 拆分自 SettingsPanel）：
// 统计 + 分享/备份（导出/导入）+ 数据目录迁移 + 归档策略（A2）。
import { useEffect, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../../../api";
import { askConfirm } from "../../../components/AppDialog";
import SegmentedSlider from "../../../components/SegmentedSlider";
import DataDirSection from "../DataDirSection";

interface Props {
  notify: (msg: string) => void;
  tick: number;
}

const ARCHIVE_POLICIES = [
  { k: "ask", label: "每次问" },
  { k: "copy", label: "复制进档" },
  { k: "move", label: "迁移进档" },
  { k: "none", label: "不归档" },
];

export default function KbSection({ notify, tick }: Props) {
  const [stats, setStats] = useState<Record<string, number>>({});
  const [kbBusy, setKbBusy] = useState(false);
  const [policy, setPolicy] = useState("ask");   // 0.1.5 A2

  useEffect(() => {
    api.get<{ stats: Record<string, number> }>("/api/knowledge/docs")
      .then((r) => setStats(r.stats)).catch(() => {});
    api.get<{ policy: string }>("/api/import/archive-policy")
      .then((r) => setPolicy(r.policy)).catch(() => {});
  }, [tick]);

  // A2：与确认屏「记住选择」共键（settings archive_policy），热生效
  const savePolicy = async (p: string) => {
    setPolicy(p);
    try {
      await api.patch("/api/import/archive-policy", { policy: p });
      notify("归档策略已保存（确认屏预选随之更新）");
    } catch (e) { notify(`保存失败: ${e}`); }
  };

  const exportKb = async () => {
    const path = await saveDialog({
      title: "导出知识库分享包", defaultPath: "debate-kb.debkb",
      filters: [{ name: "知识库包", extensions: ["debkb"] }],
    });
    if (!path) return;
    setKbBusy(true);
    try {
      const r = await api.post<{ documents: number; size_bytes: number }>(
        "/api/kb/export", { path, include_vectors: true });
      notify(`导出完成：${r.documents} 文档，${(r.size_bytes / 1048576).toFixed(1)} MB`);
    } catch (e) { notify(`导出失败: ${e}`); } finally { setKbBusy(false); }
  };

  const importKb = async () => {
    const path = await openDialog({
      title: "选择知识库分享包",
      filters: [{ name: "知识库包", extensions: ["debkb"] }],
    });
    if (!path) return;
    setKbBusy(true);
    try {
      const m = await api.post<{ documents: number; embedding_model: string }>(
        "/api/kb/verify", { path });
      if (!(await askConfirm({ title: "合并入库？",
          body: `包内含 ${m.documents} 篇文档（嵌入模型 ${m.embedding_model}）。\n重复文档将跳过。` }))) return;
      const r = await api.post<{ imported: number; skipped: number; reembedded: number }>(
        "/api/kb/import", { path, on_duplicate: "skip" });
      notify(`合并完成：新入 ${r.imported}，跳过 ${r.skipped}，重嵌入 ${r.reembedded}`);
    } catch (e) { notify(`导入失败: ${e}`); } finally { setKbBusy(false); }
  };

  return (
    <>
      <h3>知识库统计</h3>
      <div className="stat-head">
        <div className="stat"><b>{stats.documents ?? 0}</b><span>文档</span></div>
        <div className="stat"><b>{stats.chunks ?? 0}</b><span>切块</span></div>
        <div className="stat"><b>{stats.arg_units ?? 0}</b><span>论证单元</span></div>
      </div>
      <h3>分享与备份</h3>
      <p className="muted small">
        导出包含：文档元数据、全部分块文本、向量、知识文件；
        <b>强制剥离日志、API Key、素材篮与回应历史</b>。备份可导出到网盘同步文件夹。
      </p>
      <div className="controls">
        <button className="primary" disabled={kbBusy} onClick={exportKb}>导出全库…</button>
        <button disabled={kbBusy} onClick={importKb}>导入分享包…</button>
        {kbBusy && <span className="muted small">处理中…</span>}
      </div>
      <h3>原件归档策略</h3>
      <p className="muted small">导入确认时原件如何进档案库（archive 目录，人可读 md+原件）；与确认屏「记住选择」同源。</p>
      <div className="controls">
        <SegmentedSlider value={policy} onChange={savePolicy}
          options={ARCHIVE_POLICIES.map((p) => ({ key: p.k, label: p.label }))} />
      </div>
      <DataDirSection notify={notify} />
    </>
  );
}
