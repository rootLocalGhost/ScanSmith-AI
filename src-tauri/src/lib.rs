use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use docx_rs::*;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use tauri::Emitter;

const EMBEDDED_CV_SCRIPT: &str = include_str!("../scansmith_cv.py");

#[derive(Debug, Serialize, Deserialize)]
struct CVResult {
    success: bool,
    #[serde(default)]
    files: Vec<String>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Clone, Serialize)]
struct Progress {
    percent: f32,
    message: String,
}

fn ensure_cv_script_available() -> Result<std::path::PathBuf, String> {
    let temp_script_path = std::env::temp_dir().join("scansmith_ai_cv_engine.py");
    std::fs::write(&temp_script_path, EMBEDDED_CV_SCRIPT).map_err(|e| {
        format!(
            "Failed to write embedded OpenCV script to {:?}: {}",
            temp_script_path, e
        )
    })?;
    Ok(temp_script_path)
}

fn get_enriched_path() -> String {
    let current_path = std::env::var("PATH").unwrap_or_default();
    let path_sep = if cfg!(target_os = "windows") { ";" } else { ":" };

    let mut extra_paths: Vec<String> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
        let program_files = std::env::var("ProgramFiles").unwrap_or_default();
        let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();

        let win_candidates = [
            format!(r"{}\Programs\Python\Python313", local_app_data),
            format!(r"{}\Programs\Python\Python312", local_app_data),
            format!(r"{}\Programs\Python\Python311", local_app_data),
            format!(r"{}\Programs\Python\Python310", local_app_data),
            format!(r"{}\Programs\Python\Python313\Scripts", local_app_data),
            format!(r"{}\Programs\Python\Python312\Scripts", local_app_data),
            format!(r"{}\Programs\Python\Python311\Scripts", local_app_data),
            format!(r"{}\Programs\Python\Python310\Scripts", local_app_data),
            format!(r"{}\anaconda3", user_profile),
            format!(r"{}\miniconda3", user_profile),
            format!(r"{}\anaconda3\Scripts", user_profile),
            format!(r"{}\miniconda3\Scripts", user_profile),
            format!(r"{}\Tesseract-OCR", program_files),
            format!(r"{}\Tesseract-OCR", program_files_x86),
            r"C:\Python313".to_string(),
            r"C:\Python312".to_string(),
            r"C:\Python311".to_string(),
            r"C:\Python310".to_string(),
            r"C:\Program Files\Tesseract-OCR".to_string(),
            r"C:\Program Files (x86)\Tesseract-OCR".to_string(),
        ];

        for p in win_candidates {
            if !p.is_empty() && std::path::Path::new(&p).exists() {
                extra_paths.push(p);
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let unix_candidates = [
            format!("{}/.local/share/mise/shims", home),
            format!("{}/.local/bin", home),
            format!("{}/.cargo/bin", home),
            format!("{}/.pyenv/shims", home),
            format!("{}/miniconda3/bin", home),
            format!("{}/anaconda3/bin", home),
            "/usr/local/bin".to_string(),
            "/usr/bin".to_string(),
            "/bin".to_string(),
            "/opt/homebrew/bin".to_string(),
        ];

        for p in unix_candidates {
            if !p.is_empty() && std::path::Path::new(&p).exists() {
                extra_paths.push(p);
            }
        }
    }

    if !current_path.is_empty() {
        extra_paths.push(current_path);
    }

    extra_paths.join(path_sep)
}

fn resolve_python_binary(env_path: &str) -> String {
    let mut explicit_candidates: Vec<String> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let user_profile = std::env::var("USERPROFILE").unwrap_or_default();

        explicit_candidates.extend([
            "py".to_string(),
            "python".to_string(),
            "python3".to_string(),
            format!(r"{}\Programs\Python\Python313\python.exe", local_app_data),
            format!(r"{}\Programs\Python\Python312\python.exe", local_app_data),
            format!(r"{}\Programs\Python\Python311\python.exe", local_app_data),
            format!(r"{}\Programs\Python\Python310\python.exe", local_app_data),
            format!(r"{}\anaconda3\python.exe", user_profile),
            format!(r"{}\miniconda3\python.exe", user_profile),
            r"C:\Python313\python.exe".to_string(),
            r"C:\Python312\python.exe".to_string(),
            r"C:\Python311\python.exe".to_string(),
            r"C:\Python310\python.exe".to_string(),
        ]);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        explicit_candidates.extend([
            format!("{}/.local/share/mise/shims/python3", home),
            format!("{}/.local/share/mise/shims/python", home),
            format!("{}/.local/bin/python3", home),
            format!("{}/.local/bin/python", home),
            "/usr/bin/python3".to_string(),
            "/usr/bin/python".to_string(),
            "python3".to_string(),
            "python".to_string(),
            "py".to_string(),
        ]);
    }

    // Helper to run python detection command without popup windows
    let run_cmd = |bin: &str, args: &[&str]| -> Option<std::process::Output> {
        let mut cmd = Command::new(bin);
        cmd.env("PATH", env_path);
        cmd.args(args);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        cmd.output().ok()
    };

    // Priority 1: Check which candidate can actually import cv2 and numpy!
    for candidate in &explicit_candidates {
        if let Some(output) = run_cmd(candidate, &["-c", "import cv2, numpy; print('OPENCV_OK')"]) {
            if output.status.success() && String::from_utf8_lossy(&output.stdout).contains("OPENCV_OK") {
                return candidate.clone();
            }
        }
    }

    // Priority 2: Any python executable that runs --version
    for candidate in &explicit_candidates {
        if let Some(output) = run_cmd(candidate, &["--version"]) {
            if output.status.success() {
                return candidate.clone();
            }
        }
    }

    if cfg!(target_os = "windows") {
        "python".to_string()
    } else {
        "python3".to_string()
    }
}

// Bypasses Tauri's frontend scopes and forces the OS to open the file directly
#[tauri::command]
fn open_document(path: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        let mut cmd = Command::new("xdg-open");
        cmd.arg(&path)
            .env("_JAVA_OPTIONS", "--enable-native-access=ALL-UNNAMED")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .process_group(0);
        cmd.spawn().map_err(|e| format!("Failed to launch viewer: {}", e))?;
    }
    
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "", &path])
            .creation_flags(0x08000000); // CREATE_NO_WINDOW
        cmd.spawn().map_err(|e| format!("Failed to launch viewer: {}", e))?;
    }
    
    #[cfg(target_os = "macos")]
    Command::new("open").arg(&path).spawn().map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
async fn preprocess_images(
    window: tauri::Window,
    image_paths: Vec<String>,
    settings: serde_json::Value,
) -> Result<Vec<String>, String> {
    if image_paths.is_empty() {
        return Err("No images selected for preprocessing".into());
    }

    // In production and dev, extract the self-contained embedded python script to temp directory
    let script_path = ensure_cv_script_available()?;

    let env_path = get_enriched_path();
    let python_bin = resolve_python_binary(&env_path);

    // Create temp directory next to original images
    let first_img = Path::new(&image_paths[0]);
    let out_dir = first_img.parent().unwrap().join("scansmith_temp");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    let split = if settings["split"].as_bool().unwrap_or(true) { "1" } else { "0" };
    let orient = if settings["orient"].as_bool().unwrap_or(true) { "1" } else { "0" };
    let deskew = if settings["deskew"].as_bool().unwrap_or(true) { "1" } else { "0" };
    let margins = if settings["margins"].as_bool().unwrap_or(true) { "1" } else { "0" };
    let shadows = if settings["shadows"].as_bool().unwrap_or(true) { "1" } else { "0" };
    let denoise = if settings["denoise"].as_bool().unwrap_or(false) { "1" } else { "0" };
    let mode = settings["mode"].as_str().unwrap_or("color");

    let mut tasks = Vec::new();
    let total = image_paths.len() as f32;
    let completed = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));

    for (idx, path) in image_paths.into_iter().enumerate() {
        let script = script_path.clone();
        let py_bin = python_bin.clone();
        let env_p = env_path.clone();
        let out = out_dir.clone();
        let window_clone = window.clone();
        let counter_clone = completed.clone();
        let (s, o, d, m, sh, dn, md) = (
            split.to_string(),
            orient.to_string(),
            deskew.to_string(),
            margins.to_string(),
            shadows.to_string(),
            denoise.to_string(),
            mode.to_string(),
        );

        tasks.push(tokio::task::spawn_blocking(move || {
            let mut cmd = Command::new(&py_bin);
            cmd.env("PATH", &env_p)
                .args([
                    script.to_str().unwrap(),
                    "--input",
                    &path,
                    "--outdir",
                    out.to_str().unwrap(),
                    "--idx",
                    &idx.to_string(),
                    "--split",
                    &s,
                    "--orient",
                    &o,
                    "--deskew",
                    &d,
                    "--margins",
                    &m,
                    "--shadows",
                    &sh,
                    "--denoise",
                    &dn,
                    "--mode",
                    &md,
                ]);

            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }

            let output = cmd.output()
                .map_err(|e| format!("Failed to launch Python ({}) interpreter: {}", py_bin, e))?;

            let stdout_str = String::from_utf8_lossy(&output.stdout);
            let stderr_str = String::from_utf8_lossy(&output.stderr);

            if stdout_str.trim().is_empty() {
                return Err(format!(
                    "OpenCV script returned empty output (exit code {:?}).\nStderr:\n{}\nIs OpenCV installed?",
                    output.status.code(),
                    stderr_str.trim()
                ));
            }

            let result: CVResult = match serde_json::from_str(stdout_str.trim()) {
                Ok(r) => r,
                Err(e) => {
                    return Err(format!(
                        "Failed to parse OpenCV JSON output: {}\nStdout:\n{}\nStderr:\n{}",
                        e,
                        stdout_str.trim(),
                        stderr_str.trim()
                    ));
                }
            };

            if !result.success {
                let err_msg = result.error.unwrap_or_else(|| "Unknown OpenCV processing error".into());
                return Err(format!("OpenCV Processing Error: {}", err_msg));
            }

            let count = counter_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            let _ = window_clone.emit(
                "process-progress",
                Progress {
                    percent: (count as f32 / total) * 100.0,
                    message: format!("Processed {}/{} pages via OpenCV...", count, total as i32),
                },
            );

            Ok(result.files)
        }));
    }

    let mut final_paths = Vec::new();
    for task in tasks {
        match task.await.unwrap() {
            Ok(files) => final_paths.extend(files),
            Err(e) => return Err(e),
        }
    }

    let _ = window.emit(
        "process-progress",
        Progress {
            percent: 100.0,
            message: "OpenCV Processing Complete!".into(),
        },
    );
    Ok(final_paths)
}

fn build_gemini_client() -> Result<reqwest::Client, String> {
    use std::net::ToSocketAddrs;

    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED));

    // Force IPv4 addresses to avoid broken IPv6 routes on host
    if let Ok(addrs) = ("generativelanguage.googleapis.com", 443).to_socket_addrs() {
        for addr in addrs {
            if addr.is_ipv4() {
                builder = builder.resolve("generativelanguage.googleapis.com", addr);
            }
        }
    }

    builder.build().map_err(|e| format!("HTTP Client initialization failed: {}", e))
}

fn prepare_image_for_ai(path: &str) -> Result<(String, Vec<u8>), String> {
    let img = match image::open(path) {
        Ok(i) => i,
        Err(_) => {
            let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
            let mime = if path.to_lowercase().ends_with(".png") {
                "image/png"
            } else {
                "image/jpeg"
            };
            return Ok((mime.to_string(), bytes));
        }
    };

    let (w, h) = (img.width(), img.height());
    let max_dim = 1800;
    let resized = if w > max_dim || h > max_dim {
        img.resize(max_dim, max_dim, image::imageops::FilterType::Triangle)
    } else {
        img
    };

    let mut buffer = std::io::Cursor::new(Vec::new());
    if resized.write_to(&mut buffer, image::ImageFormat::Jpeg).is_err() {
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        return Ok(("image/png".to_string(), bytes));
    }

    Ok(("image/jpeg".to_string(), buffer.into_inner()))
}

#[tauri::command]
async fn generate_docx(
    window: tauri::Window,
    api_key: String,
    cleaned_paths: Vec<String>,
    original_img_path: String,
    doc_type: String,
    custom_prompt: String,
    model: String,
    output_filename: String,
) -> Result<String, String> {
    if cleaned_paths.is_empty() {
        return Err("No pages provided for document generation".into());
    }

    let total_pages = cleaned_paths.len();

    let _ = window.emit(
        "process-progress",
        Progress {
            percent: 5.0,
            message: format!("Optimizing {} scan pages in parallel across CPU cores...", total_pages),
        },
    );

    let original_dir = Path::new(&original_img_path).parent().unwrap().to_str().unwrap();
    let final_filename = if output_filename.to_lowercase().ends_with(".docx") {
        output_filename
    } else {
        format!("{}.docx", output_filename)
    };
    let output_docx_path = format!("{}/{}", original_dir, final_filename);

    let config = serde_json::json!({
        "response_mime_type": "application/json", 
        "temperature": 0.1,
        "response_schema": {
            "type": "OBJECT", 
            "properties": { 
                "title": { "type": "STRING" }, 
                "blocks": { 
                    "type": "ARRAY", 
                    "items": { 
                        "type": "OBJECT", 
                        "properties": { 
                            "block_type": { "type": "STRING", "enum": ["h1", "h2", "paragraph", "bullet", "numbered"] }, 
                            "text": { "type": "STRING" } 
                        }, 
                        "required": ["block_type", "text"] 
                    } 
                } 
            }, 
            "required": ["title", "blocks"]
        }
    });

    // Multicore parallel resize and JPEG compression with Rayon
    let prepared_images: Result<Vec<(String, Vec<u8>)>, String> = cleaned_paths
        .par_iter()
        .map(|path| prepare_image_for_ai(path))
        .collect();

    let prepared_images = prepared_images?;

    let client = Arc::new(build_gemini_client()?);
    let api_key = Arc::new(api_key);
    let model = Arc::new(model);
    let custom_prompt = Arc::new(custom_prompt);
    let config = Arc::new(config);
    let completed_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    // Concurrency limit: 2 parallel requests to balance maximum speed with API quotas
    let semaphore = Arc::new(tokio::sync::Semaphore::new(2));
    let mut join_handles = Vec::new();

    for (idx, (mime_type, img_bytes)) in prepared_images.into_iter().enumerate() {
        let sem = semaphore.clone();
        let client_clone = client.clone();
        let key_clone = api_key.clone();
        let model_clone = model.clone();
        let prompt_clone = custom_prompt.clone();
        let config_clone = config.clone();
        let window_clone = window.clone();
        let counter = completed_count.clone();

        join_handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.map_err(|e| e.to_string())?;
            let page_num = idx + 1;

            let parts = vec![
                serde_json::json!({
                    "text": format!("Extract all text, math equations, and tables from page {} as structured JSON. Preserve formatting hierarchy. Blocks: 'h1','h2','paragraph','bullet','numbered'. Prompt: {}", page_num, prompt_clone)
                }),
                serde_json::json!({
                    "inline_data": {
                        "mime_type": mime_type,
                        "data": BASE64.encode(&img_bytes)
                    }
                })
            ];

            let mut page_json: Option<serde_json::Value> = None;
            let mut last_error = String::new();

            for attempt in 1..=3 {
                if attempt > 1 {
                    tokio::time::sleep(std::time::Duration::from_millis(1500 * attempt as u64)).await;
                }

                let req_result = client_clone
                    .post(format!("https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}", model_clone, key_clone))
                    .json(&serde_json::json!({ "contents": [{ "parts": &parts }], "generationConfig": &*config_clone }))
                    .send()
                    .await;

                let res = match req_result {
                    Ok(r) => r,
                    Err(e) => {
                        last_error = format!("Network connection failed on page {}: {}", page_num, e);
                        continue;
                    }
                };

                let status = res.status();
                let text = match res.text().await {
                    Ok(t) => t,
                    Err(e) => {
                        last_error = format!("Failed to read response on page {}: {}", page_num, e);
                        continue;
                    }
                };

                if !status.is_success() {
                    if let Ok(json_err) = serde_json::from_str::<serde_json::Value>(&text) {
                        if let Some(err_obj) = json_err.get("error") {
                            let msg = err_obj.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown API Error");
                            let status_code = err_obj.get("status").and_then(|s| s.as_str()).unwrap_or("");
                            last_error = format!("Google Gemini API Error ({} - {}): {}", status.as_u16(), status_code, msg);
                            if status == reqwest::StatusCode::SERVICE_UNAVAILABLE || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                                continue;
                            } else {
                                return Err(last_error);
                            }
                        }
                    }
                    last_error = format!("Google Gemini API Error (HTTP {}): {}", status.as_u16(), text);
                    continue;
                }

                match serde_json::from_str::<serde_json::Value>(&text) {
                    Ok(json_parsed) => {
                        page_json = Some(json_parsed);
                        break;
                    }
                    Err(e) => {
                        last_error = format!("Failed to parse Gemini response JSON on page {}: {}\nRaw: {}", page_num, e, text);
                    }
                }
            }

            let json = match page_json {
                Some(j) => j,
                None => {
                    return Err(format!(
                        "{}\n(Tip: If this model is unavailable, try switching to 'gemini-3.5-flash' or 'gemini-3.5-flash-lite' from the dropdown)",
                        last_error
                    ));
                }
            };

            let done = counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            let progress_pct = 10.0 + ((done as f32 / total_pages as f32) * 75.0);
            let _ = window_clone.emit(
                "process-progress",
                Progress {
                    percent: progress_pct,
                    message: format!("Transcribed {}/{} pages with {}...", done, total_pages, model_clone),
                },
            );

            Ok((idx, json))
        }));
    }

    let mut results = Vec::new();
    for handle in join_handles {
        let res = handle.await.map_err(|e| format!("Task execution error: {}", e))??;
        results.push(res);
    }

    // Sort by original page index to ensure exact document order
    results.sort_by_key(|(idx, _)| *idx);

    let mut all_blocks: Vec<serde_json::Value> = Vec::new();
    let mut doc_title: Option<String> = None;

    for (_, json) in results {
        let raw_text = json["candidates"][0]["content"]["parts"][0]["text"].as_str().unwrap_or("{}");
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(raw_text) {
            if doc_title.is_none() {
                if let Some(title_val) = parsed.get("title").and_then(|t| t.as_str()) {
                    if !title_val.trim().is_empty() {
                        doc_title = Some(title_val.to_string());
                    }
                }
            }
            if let Some(blocks) = parsed.get("blocks").and_then(|b| b.as_array()) {
                all_blocks.extend(blocks.clone());
            }
        }
    }

    let _ = window.emit(
        "process-progress",
        Progress {
            percent: 90.0,
            message: "Building native DOCX Document...".into(),
        },
    );

    let mut docx = Docx::new();

    if doc_type.to_lowercase().contains("question paper") || doc_type.to_lowercase().contains("exam") {
        docx = docx
            .page_size(15840, 12240)
            .page_margin(PageMargin::new().top(720).bottom(720).left(720).right(720));
    }

    if let Some(title) = doc_title {
        docx = docx.add_paragraph(
            Paragraph::new().add_run(Run::new().add_text(&title).bold().size(32))
        );
    }

    for block in all_blocks {
        let text = block["text"].as_str().unwrap_or("");
        let block_type = block["block_type"].as_str().unwrap_or("paragraph");

        let run = Run::new()
            .add_text(text)
            .size(22)
            .fonts(RunFonts::new().ascii("Tiro Bangla").cs("Tiro Bangla").hi_ansi("Tiro Bangla"));

        match block_type {
            "h1" => { docx = docx.add_paragraph(Paragraph::new().add_run(run.bold().size(28))); }
            "h2" => { docx = docx.add_paragraph(Paragraph::new().add_run(run.bold().size(24))); }
            "bullet" => { 
                docx = docx.add_paragraph(
                    Paragraph::new()
                        .add_run(Run::new().add_text("• ").fonts(RunFonts::new().ascii("Tiro Bangla")))
                        .add_run(run)
                ); 
            }
            _ => { docx = docx.add_paragraph(Paragraph::new().add_run(run)); }
        }
    }

    docx.build().pack(File::create(&output_docx_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;

    let _ = window.emit(
        "process-progress",
        Progress {
            percent: 100.0,
            message: "Success! DOCX is ready.".into(),
        },
    );

    Ok(output_docx_path)
}

#[tauri::command]
fn rotate_page(path: String, angle: i32) -> Result<String, String> {
    let img = image::open(&path).map_err(|e| format!("Failed to open image for rotation: {}", e))?;
    let rotated = match angle {
        90 => img.rotate90(),
        180 => img.rotate180(),
        270 | -90 => img.rotate270(),
        _ => img,
    };
    rotated.save(&path).map_err(|e| format!("Failed to save rotated image: {}", e))?;
    Ok(path)
}

#[tauri::command]
fn app_window_minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn app_window_toggle_maximize(window: tauri::Window) -> Result<bool, String> {
    let is_max = window.is_maximized().map_err(|e| e.to_string())?;
    if is_max {
        window.unmaximize().map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        window.maximize().map_err(|e| e.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
fn app_window_close(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn app_window_is_maximized(window: tauri::Window) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            preprocess_images,
            generate_docx,
            open_document,
            rotate_page,
            app_window_minimize,
            app_window_toggle_maximize,
            app_window_close,
            app_window_is_maximized
        ])
        .run(tauri::generate_context!())
        .expect("error while running app");
}