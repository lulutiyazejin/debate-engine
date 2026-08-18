// 导入面板（项目12）：拖拽/选择文件与文件夹/URL → 单文件走预览确认卡，
// 多文件走批量接口 + 进度条（轮询项目3进度端点）→ 成功/跳过/失败三栏报告
import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api } from "../api";

interface Props {
  stances: { name: string; label?: string }[];
  notify: (msg: string) => void;
  onDone: () => void;
}

interface Preview {
  doc_id: string;
  title?: string;
  author?: string;
  doc_type?: string;
  doc_summary?: string;
  token_estimate?: number;
  classification?: { stance?: string; confidence?: number; reason?: string };
  duplicate?: { type: string; existing_doc_id: string } | null;
}

interface BatchItem { source: string; status: string; detail: string | null }

export default function ImportPanel({ stances, notify, onDone }: Props) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [chosenStance, setChosenStance] = useState("");
  const [onDup, setOnDup] = useState("keep-both");
  const [strategy, setStrategy] = useState("auto");
  const [batch, setBatch] = useState<{ running: boolean; total: number; done: number; items: BatchItem[] } | null>(null);
  const [dragging, setDragging] = useState(false);
  const pollRef = useRef<number | undefined>(undefined);

  // Tauri 原生拖拽（能拿到完整路径，浏览器 DnD 拿不到）
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "over") setDragging(true);
      else if (e.payload.type === "drop") {
        setDragging(false);
        importSources(e.payload.paths);
      } else setDragging(false);
    });
    return () => { un.then((f) => f()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDup, strategy]);

  useEffect(() => () => window.clearTimeout(pollRef.current), []);

  const pollProgress = async () => {
    try {
      const p = await api.get<{ running: boolean; total: number; done: number; items: BatchItem[] }>("/api/import/progress");
      setBatch(p);
      if (p.running) {
        pollRef.current = window.setTimeout(pollProgress, 1000);
      } else {
        setBusy("");
        onDone();
      }
    } catch {
      pollRef.current = window.setTimeout(pollProgress, 2000);
    }
  };

  const importSources = async (paths: string[]) => {
    if (!paths.length || busy) return;
    if (paths.length === 1) {
      await singleImport(paths[0]);
    } else {
      await batchImport(paths);
    }
  };

  const singleImport = async (source: string) => {
    setBusy("解析并分析中（大文档可能需要几分钟）…");
    setPreview(null);
    try {
      const pv = await api.post<Preview>("/api/import",
        { source, summary_strategy: strategy });
      setPreview(pv);
      setChosenStance(pv.classification?.stance || stances[0]?.name || "");
    } catch (e) {
      if (String(e).includes("文件夹")) {
        // 拖进来的是目录 → 改走批量接口（服务端递归展开）
        await batchImport([source]);
        return;
      }
      notify(`导入失败: ${e}`);
    } finally {
      setBusy("");
    }
  };

  const confirmImport = async () => {
    if (!preview) return;
    setBusy("入库中（切块/向量化/写索引）…");
    try {
      await api.post("/api/import/confirm", {
        doc_id: preview.doc_id, stance: chosenStance, on_duplicate: onDup,
      });
      notify("入库完成");
      setPreview(null);
      onDone();
    } catch (e) {
      notify(`入库失败: ${e}`);
    } finally {
      setBusy("");
    }
  };

  const batchImport = async (sources: string[]) => {
    setBusy(`批量导入 ${sources.length} 项…`);
    setBatch(null);
    try {
      await api.post("/api/import/batch",
        { sources, on_duplicate: onDup, summary_strategy: strategy });
      pollProgress();
    } catch (e) {
      notify(`批量导入失败: ${e}`);
      setBusy("");
    }
  };

  const pickFiles = async () => {
    const sel = await open({
      multiple: true, title: "选择要导入的文档",
      filters: [{ name: "文档", extensions: ["pdf", "docx", "doc", "xlsx", "xls", "txt", "md", "markdown"] }],
    });
    if (sel) importSources(Array.isArray(sel) ? sel : [sel]);
  };

  const pickFolder = async () => {
    const sel = await open({ directory: true, title: "选择文件夹（递归导入全部支持格式）" });
    if (sel) batchImport([sel as string]);
  };

  const stanceLabel = (k?: string) =>
    stances.find((s) => s.name === k)?.label || k || "未知";

  const cols = { success: [] as BatchItem[], skipped: [] as BatchItem[], failed: [] as BatchItem[] };
  for (const it of batch?.items || []) {
    if (it.status === "success") cols.success.push(it);
    else if (it.status === "skipped") cols.skipped.push(it);
    else if (it.status === "failed") cols.failed.push(it);
  }

  return (
    <div className="panel import">
      <div className={"dropzone" + (dragging ? " drag" : "")}
           onClick={pickFiles}>
        <p>把文件或文件夹拖到这里，或点击选择文件</p>
        <p className="muted small">支持 PDF / Word / Excel / TXT / Markdown / 网页 URL</p>
        <button className="link" onClick={(e) => { e.stopPropagation(); pickFolder(); }}>
          选择文件夹…
        </button>
      </div>

      <div className="controls">
        <input className="url-input" placeholder="或粘贴网页 URL 后回车导入"
               value={url} onChange={(e) => setUrl(e.target.value)}
               onKeyDown={(e) => {
                 if (e.key === "Enter" && url.trim().match(/^https?:\/\//)) {
                   singleImport(url.trim());
                   setUrl("");
                 }
               }} />
        <label>重复处置
          <select value={onDup} onChange={(e) => setOnDup(e.target.value)}>
            <option value="keep-both">两版共存</option>
            <option value="replace">替换旧版</option>
            <option value="skip">跳过</option>
          </select>
        </label>
        <label>摘要策略
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
            <option value="auto">自动</option>
            <option value="map_reduce">Map-Reduce</option>
            <option value="refine">Refine 链</option>
            <option value="full_context">全文投喂</option>
          </select>
        </label>
      </div>

      {busy && <div className="busy"><div className="spinner sm" />{busy}</div>}

      {preview && (
        <div className="confirm-card">
          <h3>{preview.title || "未命名文档"}</h3>
          <div className="muted small">
            {preview.author && `作者：${preview.author} · `}
            类型：{preview.doc_type || "?"} · 约 {preview.token_estimate ?? "?"} tokens
          </div>
          {preview.duplicate && (
            <div className="demo-warn">
              ⚠ 检测到{preview.duplicate.type === "exact" ? "完全重复"
                : preview.duplicate.type === "new_version" ? "同来源新版本"
                : "语义近似"}文档（{preview.duplicate.existing_doc_id}），
              将按「{{ "keep-both": "两版共存", replace: "替换旧版", skip: "跳过" }[onDup]}」处理
            </div>
          )}
          <p className="summary">{preview.doc_summary || "（无摘要）"}</p>
          <div className="infer">
            AI 推断立场：<b>{stanceLabel(preview.classification?.stance)}</b>
            （置信度 {((preview.classification?.confidence ?? 0) * 100).toFixed(0)}%）
            <div className="muted small">{preview.classification?.reason}</div>
          </div>
          <div className="controls">
            <label>入库立场
              <select value={chosenStance} onChange={(e) => setChosenStance(e.target.value)}>
                {stances.map((s) => <option key={s.name} value={s.name}>{s.label || s.name}</option>)}
              </select>
            </label>
            <button className="primary" onClick={confirmImport} disabled={!!busy}>确认入库</button>
            <button onClick={() => setPreview(null)}>取消</button>
          </div>
        </div>
      )}

      {batch && (
        <div className="batch-report">
          <div className="progress">
            <div className="bar" style={{ width: `${batch.total ? (batch.done / batch.total) * 100 : 0}%` }} />
            <span>{batch.done}/{batch.total}{batch.running ? "（进行中）" : "（已完成）"}</span>
          </div>
          <div className="report-cols">
            <div className="report-col ok">
              <h4>成功 {cols.success.length}</h4>
              {cols.success.map((i, k) => <div key={k} className="small">{i.source}</div>)}
            </div>
            <div className="report-col warn">
              <h4>跳过 {cols.skipped.length}</h4>
              {cols.skipped.map((i, k) => <div key={k} className="small">{i.source}<span className="muted">（{i.detail}）</span></div>)}
            </div>
            <div className="report-col bad">
              <h4>失败 {cols.failed.length}</h4>
              {cols.failed.map((i, k) => <div key={k} className="small">{i.source}<span className="muted">（{i.detail}）</span></div>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
