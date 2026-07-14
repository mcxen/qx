use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, State};

const TERMINAL_BUFFER_LIMIT: usize = 2 * 1024 * 1024;
const TERMINAL_SESSION_LIMIT: usize = 24;
static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Default)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
}

struct TerminalSession {
    info: TerminalSessionInfo,
    output: VecDeque<u8>,
    writer: Option<Arc<Mutex<Box<dyn Write + Send>>>>,
    master: Option<Box<dyn MasterPty + Send>>,
    child: Option<Box<dyn Child + Send + Sync>>,
}

#[derive(Clone, Serialize)]
pub struct TerminalSessionInfo {
    id: String,
    title: String,
    cwd: String,
    shell: String,
    running: bool,
    created_at: u64,
}

#[derive(Clone, Serialize)]
struct TerminalOutputEvent {
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct TerminalExitEvent {
    session_id: String,
}

#[derive(Serialize)]
pub struct TerminalSnapshot {
    session: TerminalSessionInfo,
    data: String,
}

fn default_shell() -> PathBuf {
    if let Some(shell) = std::env::var_os("SHELL").filter(|value| !value.is_empty()) {
        return PathBuf::from(shell);
    }
    #[cfg(target_os = "windows")]
    {
        PathBuf::from("powershell.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        PathBuf::from("/bin/zsh")
    }
}

fn default_cwd() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_existing_dir(cwd: Option<String>) -> Result<PathBuf, String> {
    let path = cwd
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_cwd);
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Terminal directory is unavailable: {error}"))?;
    if !canonical.is_dir() {
        return Err("Terminal working directory must be a folder".to_string());
    }
    Ok(canonical)
}

fn resolve_shell(shell: Option<String>) -> Result<PathBuf, String> {
    let path = shell
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_shell);
    if path.components().count() > 1 && (!path.exists() || !path.is_file()) {
        return Err("Configured shell executable does not exist".to_string());
    }
    Ok(path)
}

fn append_output(buffer: &mut VecDeque<u8>, bytes: &[u8]) {
    buffer.extend(bytes);
    if buffer.len() > TERMINAL_BUFFER_LIMIT {
        let excess = buffer.len() - TERMINAL_BUFFER_LIMIT;
        buffer.drain(..excess);
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl TerminalManager {
    fn create(
        &self,
        app: AppHandle,
        cwd: Option<String>,
        shell: Option<String>,
        rows: u16,
        cols: u16,
    ) -> Result<TerminalSessionInfo, String> {
        let cwd = resolve_existing_dir(cwd)?;
        let shell = resolve_shell(shell)?;
        if self
            .sessions
            .lock()
            .map_err(|_| "Terminal session state is unavailable".to_string())?
            .len()
            >= TERMINAL_SESSION_LIMIT
        {
            return Err(format!(
                "At most {TERMINAL_SESSION_LIMIT} terminal sessions can run at once"
            ));
        }
        let pty = native_pty_system();
        let pair = pty
            .openpty(PtySize {
                rows: rows.max(2),
                cols: cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("Unable to create terminal: {error}"))?;

        let mut command = CommandBuilder::new(&shell);
        command.cwd(&cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        #[cfg(not(target_os = "windows"))]
        if matches!(
            shell.file_name().and_then(|value| value.to_str()),
            Some("zsh" | "bash" | "fish")
        ) {
            command.arg("-l");
        }

        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("Unable to start shell: {error}"))?;
        drop(pair.slave);
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("Unable to read terminal: {error}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| format!("Unable to write terminal: {error}"))?;

        let sequence = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed);
        let id = format!("tty-{}-{sequence}", now_millis());
        let info = TerminalSessionInfo {
            id: id.clone(),
            title: format!("Terminal {sequence}"),
            cwd: cwd.to_string_lossy().into_owned(),
            shell: shell.to_string_lossy().into_owned(),
            running: true,
            created_at: now_millis(),
        };
        self.sessions
            .lock()
            .map_err(|_| "Terminal session state is unavailable".to_string())?
            .insert(
                id.clone(),
                TerminalSession {
                    info: info.clone(),
                    output: VecDeque::new(),
                    writer: Some(Arc::new(Mutex::new(writer))),
                    master: Some(pair.master),
                    child: Some(child),
                },
            );

        let sessions = Arc::clone(&self.sessions);
        std::thread::Builder::new()
            .name(format!("qx-terminal-{sequence}"))
            .spawn(move || {
                let mut chunk = [0_u8; 16 * 1024];
                loop {
                    match reader.read(&mut chunk) {
                        Ok(0) | Err(_) => break,
                        Ok(count) => {
                            let bytes = &chunk[..count];
                            if let Ok(mut all) = sessions.lock() {
                                if let Some(session) = all.get_mut(&id) {
                                    append_output(&mut session.output, bytes);
                                } else {
                                    break;
                                }
                            }
                            let _ = app.emit(
                                "qx-terminal-output",
                                TerminalOutputEvent {
                                    session_id: id.clone(),
                                    data: BASE64.encode(bytes),
                                },
                            );
                        }
                    }
                }
                if let Ok(mut all) = sessions.lock() {
                    if let Some(session) = all.get_mut(&id) {
                        session.info.running = false;
                        session.writer = None;
                        session.master = None;
                        session.child = None;
                    }
                }
                let _ = app.emit("qx-terminal-exit", TerminalExitEvent { session_id: id });
            })
            .map_err(|error| format!("Unable to monitor terminal: {error}"))?;

        Ok(info)
    }
}

#[tauri::command]
pub async fn terminal_create_session(
    app: AppHandle,
    state: State<'_, TerminalManager>,
    cwd: Option<String>,
    shell: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
) -> Result<TerminalSessionInfo, String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager.create(app, cwd, shell, rows.unwrap_or(24), cols.unwrap_or(80))
    })
    .await
    .map_err(|error| format!("Unable to start terminal task: {error}"))?
}

#[tauri::command]
pub fn terminal_list_sessions(
    state: State<'_, TerminalManager>,
) -> Result<Vec<TerminalSessionInfo>, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal session state is unavailable".to_string())?
        .values()
        .map(|session| session.info.clone())
        .collect::<Vec<_>>();
    sessions.sort_by_key(|session| session.created_at);
    Ok(sessions)
}

#[tauri::command]
pub fn terminal_snapshot(
    state: State<'_, TerminalManager>,
    session_id: String,
) -> Result<TerminalSnapshot, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal session state is unavailable".to_string())?;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "Terminal session not found".to_string())?;
    Ok(TerminalSnapshot {
        session: session.info.clone(),
        data: BASE64.encode(session.output.iter().copied().collect::<Vec<_>>()),
    })
}

#[tauri::command]
pub fn terminal_write(
    state: State<'_, TerminalManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let bytes = BASE64
        .decode(data)
        .map_err(|error| format!("Invalid terminal input: {error}"))?;
    let writer = state
        .sessions
        .lock()
        .map_err(|_| "Terminal session state is unavailable".to_string())?
        .get(&session_id)
        .ok_or_else(|| "Terminal session not found".to_string())?
        .writer
        .as_ref()
        .cloned()
        .ok_or_else(|| "Terminal session has exited".to_string())?;
    let mut writer = writer
        .lock()
        .map_err(|_| "Terminal input stream is unavailable".to_string())?;
    writer
        .write_all(&bytes)
        .and_then(|_| writer.flush())
        .map_err(|error| format!("Unable to write terminal input: {error}"))
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, TerminalManager>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal session state is unavailable".to_string())?;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "Terminal session not found".to_string())?;
    let master = session
        .master
        .as_ref()
        .ok_or_else(|| "Terminal session has exited".to_string())?;
    master
        .resize(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Unable to resize terminal: {error}"))
}

#[tauri::command]
pub fn terminal_close_session(
    state: State<'_, TerminalManager>,
    session_id: String,
) -> Result<(), String> {
    let mut session = state
        .sessions
        .lock()
        .map_err(|_| "Terminal session state is unavailable".to_string())?
        .remove(&session_id)
        .ok_or_else(|| "Terminal session not found".to_string())?;
    if let Some(mut child) = session.child.take() {
        child
            .kill()
            .map_err(|error| format!("Unable to stop terminal: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn terminal_clear_buffer(
    state: State<'_, TerminalManager>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal session state is unavailable".to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "Terminal session not found".to_string())?;
    session.output.clear();
    Ok(())
}
