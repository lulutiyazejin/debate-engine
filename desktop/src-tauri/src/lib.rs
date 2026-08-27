// Debate Engine 桌面壳（项目11）：
// - 启动时以隐藏子进程拉起 Python 引擎（CREATE_NO_WINDOW，全程零 cmd 窗口）
// - 端口握手：引擎把实际端口写 knowledge_base/.engine_port，前端轮询 engine_port 命令
// - 退出双保险：先 HTTP POST /api/shutdown 优雅关停，超时后强杀子进程
// - 单实例互斥：二次启动只聚焦已开窗口，不再拉起第二个引擎
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::Manager;

struct Engine {
    child: Mutex<Option<Child>>,
    kb_dir: PathBuf,
}

/// 引擎命令与工作目录：开发态用 venv Python 跑 cli.py serve；
/// 发布态直接用 PyInstaller 打包的 DebateEngine.exe 启动。
fn engine_launch() -> (PathBuf, Vec<String>, PathBuf, PathBuf) {
    if cfg!(debug_assertions) {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..");
        let backend = root.join("backend");
        (
            backend.join(".venv").join("Scripts").join("python.exe"),
            vec!["cli.py".into(), "serve".into()],
            backend.clone(),
            root.join("knowledge_base"),
        )
    } else {
        let exe_dir = std::env::current_exe()
            .expect("current_exe")
            .parent()
            .expect("exe dir")
            .to_path_buf();
        let engine_dir = exe_dir.join("engine");
        // 发布态：直接使用 PyInstaller 打包的 DebateEngine.exe（已经包含所有依赖）
        (
            engine_dir.join("DebateEngine.exe"),
            vec!["serve".into()],
            engine_dir,
            exe_dir.join("knowledge_base"),
        )
    }
}

fn spawn_engine(engine: &Engine) -> Result<(), String> {
    let (program, args, cwd, kb) = engine_launch();
    if !program.exists() {
        return Err(format!("引擎程序不存在: {}", program.display()));
    }
    // 清掉上次残留的握手文件，避免读到旧端口
    let _ = std::fs::create_dir_all(&kb);
    let _ = std::fs::remove_file(kb.join(".engine_port"));

    let mut cmd = Command::new(&program);
    cmd.args(&args)
        .current_dir(&cwd)
        .env("KB_PATH", &kb)
        // 父 PID 交给引擎看门狗：壳崩溃时引擎自杀，避免孤儿进程
        .env("DEBATE_PARENT_PID", std::process::id().to_string());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let child = cmd.spawn().map_err(|e| format!("引擎启动失败: {e}"))?;
    *engine.child.lock().unwrap() = Some(child);
    Ok(())
}

fn read_port(kb: &PathBuf) -> u16 {
    std::fs::read_to_string(kb.join(".engine_port"))
        .ok()
        .and_then(|s| s.lines().next().and_then(|l| l.trim().parse().ok()))
        .unwrap_or(0)
}

/// 原始 HTTP POST（127.0.0.1 内环，省掉 reqwest 依赖）
fn http_post_shutdown(port: u16) {
    let addr = format!("127.0.0.1:{port}");
    if let Ok(mut s) = TcpStream::connect_timeout(
        &addr.parse().unwrap(),
        Duration::from_millis(800),
    ) {
        let _ = s.set_read_timeout(Some(Duration::from_millis(800)));
        let _ = s.write_all(
            b"POST /api/shutdown HTTP/1.1\r\nHost: 127.0.0.1\r\n\
              Content-Length: 0\r\nConnection: close\r\n\r\n",
        );
        let mut buf = [0u8; 256];
        let _ = s.read(&mut buf);
    }
}

/// 优雅关停：POST /api/shutdown → 最多等 3 秒 → 仍存活则强杀
fn stop_engine(engine: &Engine) {
    let port = read_port(&engine.kb_dir);
    if port > 0 {
        http_post_shutdown(port);
    }
    if let Some(mut child) = engine.child.lock().unwrap().take() {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(100));
                }
                _ => {
                    let _ = child.kill();
                    break;
                }
            }
        }
    }
    let _ = std::fs::remove_file(engine.kb_dir.join(".engine_port"));
}

/// 前端启动轮询：>0 表示引擎已写握手文件（就绪与否由前端再打 /api/health）
#[tauri::command]
fn engine_port(state: tauri::State<'_, Engine>) -> u16 {
    read_port(&state.kb_dir)
}

/// 引擎子进程是否仍存活（供前端异常提示）
#[tauri::command]
fn engine_alive(state: tauri::State<'_, Engine>) -> bool {
    match state.child.lock().unwrap().as_mut() {
        Some(c) => matches!(c.try_wait(), Ok(None)),
        None => false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (_, _, _, kb) = engine_launch();
    let engine = Engine {
        child: Mutex::new(None),
        kb_dir: kb,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(engine)
        .setup(|app| {
            let state: tauri::State<Engine> = app.state();
            if let Err(e) = spawn_engine(&state) {
                eprintln!("{e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![engine_port, engine_alive])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let state: tauri::State<Engine> = app.state();
                stop_engine(&state);
            }
        });
}
