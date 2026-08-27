// 设置面板主骨架（0.1.5 B1 拆分）：左导航（J8 滑块，点击+scrollspy 双驱动）+
// 一滚到底分区卡片。各分区主体在 settings/sections/*.tsx；
// 共享数据（服务商/任务/自定义）在此拉取下发，其余分区自取（tick 脉冲刷新）。
import { useCallback, useEffect, useLayoutEffect, useRef, useState,
         type UIEvent as ReactUIEvent } from "react";
import { api } from "../api";
import TasksSection, { type TaskRow } from "./settings/sections/TasksSection";
import ComponentsSection from "./settings/ComponentsSection";
import ProvidersSection, { type Provider, type CustomProv }
  from "./settings/sections/ProvidersSection";
import LocalModelSection from "./settings/sections/LocalModelSection";
import NetworkSection from "./settings/sections/NetworkSection";
import ParamsSection from "./settings/sections/ParamsSection";
import KbSection from "./settings/sections/KbSection";
import StanceSection from "./settings/sections/StanceSection";
import DiagSection from "./settings/sections/DiagSection";
import UiSection from "./settings/sections/UiSection";
import FontSection from "./settings/sections/FontSection";

const SECTIONS = [
  { key: "providers", label: "模型服务商" },
  { key: "localmodel", label: "本地模型" },
  { key: "components", label: "组件中心" },
  { key: "network", label: "网络与代理" },
  { key: "tasks", label: "任务分工" },
  { key: "params", label: "生成与检索" },
  { key: "kb", label: "知识库" },
  { key: "stancemgr", label: "立场管理" },
  { key: "skills", label: "知识文件" },
  { key: "font", label: "字体管理" },   // 0.1.7 项 11
  { key: "diag", label: "诊断与日志" },
  { key: "ui", label: "界面" },
  { key: "about", label: "软件信息" },
] as const;

interface Props {
  notify: (msg: string) => void;
}

export default function SettingsPanel({ notify }: Props) {
  const [section, setSection] = useState<string>("providers");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [customs, setCustoms] = useState<CustomProv[]>([]);
  const [version, setVersion] = useState("");
  const [paths, setPaths] = useState<{ settings_path: string; data_root: string;
    components_dir?: string; models_dir?: string } | null>(null);
  const [tick, setTick] = useState(0);          // 分区自取数据的刷新脉冲
  const navRef = useRef<HTMLDivElement>(null);

  // 0.1.8 S2：DiagSection 数据源
  const [embedderInfo, setEmbedderInfo] = useState<{
    impl: string; model: string; is_fallback: boolean
  } | null>(null);
  const [componentsList, setComponentsList] = useState<{
    name: string; state: string
  }[]>([]);

  const refresh = useCallback(() => {
    api.get<{ providers: Provider[] }>("/api/config/providers")
      .then((r) => setProviders(r.providers)).catch(() => {});
    api.get<{ tasks: TaskRow[] }>("/api/config/tasks")
      .then((r) => setTasks(r.tasks)).catch(() => {});
    api.get<{ providers: CustomProv[] }>("/api/config/custom-providers")
      .then((r) => setCustoms(r.providers)).catch(() => {});
    api.get<{ version: string }>("/api/health")
      .then((r) => setVersion(r.version)).catch(() => {});
    api.get<{ settings_path: string; data_root: string;
              components_dir?: string; models_dir?: string }>("/api/config/paths")
      .then(setPaths).catch(() => {});
    // S2 降级状态一览
    try { api.get("/api/components")
      .then((r: any) => {
        setEmbedderInfo({ impl: r.embedder.impl, model: r.embedder.model,
                          is_fallback: r.embedder.is_fallback });
        setComponentsList(r.components.map((c: any) => ({ name: c.name, state: c.state })));
      }).catch(() => {}); } catch {}
    setTick((t) => t + 1);
  }, []);
  useEffect(refresh, [refresh]);

  // 0.1.4 批 5（决策 12）：一滚到底——左导航变锚点目录，scrollspy 高亮当前分区
  const onSpy = (e: ReactUIEvent<HTMLDivElement>) => {
    const hostTop = e.currentTarget.getBoundingClientRect().top;
    let cur: string = SECTIONS[0].key;
    for (const s of SECTIONS) {
      const el = document.getElementById(`sec-${s.key}`);
      if (el && el.getBoundingClientRect().top - hostTop <= 90) cur = s.key;
    }
    setSection(cur);
  };

  // 0.1.5 J8：导航滑块位置=CSS 变量驱动 translateY，120ms ease-out 固定时长
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const btn = nav.querySelector<HTMLButtonElement>(
      `button[data-nav="${CSS.escape(section)}"]`);
    if (!btn) { nav.style.setProperty("--nav-o", "0"); return; }
    nav.style.setProperty("--nav-y", `${btn.offsetTop}px`);
    nav.style.setProperty("--nav-h", `${btn.offsetHeight}px`);
    nav.style.setProperty("--nav-o", "1");
  }, [section]);

  return (
    <div className="settings2">
      <nav className="settings-nav" ref={navRef}>
        <span className="nav-thumb" aria-hidden />
        {SECTIONS.map((s) => (
          <button key={s.key} data-nav={s.key}
                  className={section === s.key ? "nav-on" : ""}
                  onClick={() => { setSection(s.key);
                    document.getElementById(`sec-${s.key}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
            {s.label}</button>
        ))}
      </nav>
      <div className="settings-body" onScroll={onSpy}>
        <div className="panel settings" id="sec-providers">
          <ProvidersSection providers={providers} tasks={tasks} customs={customs}
                            notify={notify} onChanged={refresh} />
        </div>

        <div className="panel settings" id="sec-localmodel">
          <LocalModelSection notify={notify} onChanged={refresh} tick={tick} />
        </div>

        <div className="panel settings" id="sec-components">
          <ComponentsSection notify={notify} />
        </div>

        <div className="panel settings" id="sec-network">
          <NetworkSection notify={notify} tick={tick} />
        </div>

        <div className="panel settings" id="sec-tasks">
          <TasksSection tasks={tasks} providers={providers} customs={customs}
                        notify={notify} onSaved={refresh} />
        </div>

        <div className="panel settings" id="sec-params">
          <ParamsSection notify={notify} tick={tick} />
        </div>

        <div className="panel settings" id="sec-kb">
          <KbSection notify={notify} tick={tick} />
        </div>

        <div className="panel settings" id="sec-stancemgr">
          <StanceSection notify={notify} onChanged={refresh} tick={tick} />
        </div>

        <div className="panel settings" id="sec-skills">
          <h3>知识文件</h3>
          <p className="muted small">
            反驳风格（styles.md）、谬误表（fallacies.md）、坐标中心点（centers.md）、
            立场 Skill（stances/*.md）都是知识库 skills 目录下的普通 Markdown，
            用任何编辑器修改保存后，下次生成即生效。
          </p>
          {/* 0.1.8 Q7 顺手：一键直达 skills 目录 */}
          <button onClick={() => api.post("/api/files/reveal?kind=skills", {})
            .catch((e) => notify(`打开失败: ${e}`))}>打开 skills 目录</button>
        </div>

        {/* 0.1.7 项 11：字体管理 */}
        <div className="panel settings" id="sec-font">
          <FontSection notify={notify} tick={tick} />
        </div>

        <div className="panel settings" id="sec-diag">
          <DiagSection providers={providers} tasks={tasks}
                       embedder={embedderInfo} components={componentsList} />
        </div>

        <div className="panel settings" id="sec-ui">
          <UiSection notify={notify} />
        </div>

        <div className="panel settings" id="sec-about">
          <h3>软件信息</h3>
          <div className="param-row"><span>名称</span><span>Debate Engine（辩论引擎）</span></div>
          <div className="param-row"><span>版本</span><code>{version || "读取中…"}</code></div>
          {/* 0.1.6 项 7：真实路径可定位可备份（升级丢设置排障入口） */}
          <div className="param-row"><span>设置文件</span>
            <code className="small">{paths?.settings_path || "读取中…"}</code></div>
          <div className="param-row"><span>数据根</span>
            <code className="small">{paths?.data_root || "读取中…"}</code></div>
          {/* 0.1.6 项 11：组件/模型独立文件夹（升级不覆盖） */}
          <div className="param-row"><span>组件目录</span>
            <code className="small">{paths?.components_dir || "读取中…"}</code></div>
          <div className="param-row"><span>模型目录</span>
            <code className="small">{paths?.models_dir || "读取中…"}</code></div>
          <div className="param-row"><span>数据目录</span><span className="muted small">文档、向量、日志、立场文件都在数据根下；设置随数据根迁移继承，升级不丢。</span></div>
          <p className="muted small">
            知识库为个人研究用途本地存储；分享包导出时强制剥离日志与 API Key。
            问题排查请附 knowledge_base/logs 下当日日志。
          </p>
        </div>
      </div>
    </div>
  );
}
