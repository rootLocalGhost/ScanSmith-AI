use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use docx_rs::*;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::Path;
use std::process::Command;
use tauri::Emitter;

#[derive(Debug, Serialize, Deserialize)]
struct CVResult {
    success: bool,
    files: Vec<String>,
}

#[derive(Clone, Serialize)]
struct Progress {
    percent: f32,
    message: String,
}

// Bypasses Tauri's frontend scopes and forces the OS to open the file directly
#[tauri::command]
fn open_document(path: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    Command::new("xdg-open").arg(&path).spawn().map_err(|e| e.to_string())?;
    
    #[cfg(target_os = "windows")]
    Command::new("cmd").args(["/C", "start", "", &path]).spawn().map_err(|e| e.to_string())?;
    
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
        return Err("No images".into());
    }

    // Keep the script reference pointing to the source folder
    let current_dir = std::env::current_dir().unwrap();
    let script_path = current_dir.join("aura_cv.py");

    // FIX: Create the temp directory next to the ORIGINAL images (outside of src-tauri)
    // This stops the Tauri watcher from triggering an infinite reload loop!
    let first_img = Path::new(&image_paths[0]);
    let out_dir = first_img.parent().unwrap().join("aura_temp");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    let split = if settings["split"].as_bool().unwrap_or(true) { "1" } else { "0" };
    let orient = if settings["orient"].as_bool().unwrap_or(true) { "1" } else { "0" };
    let deskew = if settings["deskew"].as_bool().unwrap_or(true) { "1" } else { "0" };
    let margins = if settings["margins"].as_bool().unwrap_or(true) { "1" } else { "0" };

    let mut tasks = Vec::new();
    let total = image_paths.len() as f32;
    let completed = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));

    for (idx, path) in image_paths.into_iter().enumerate() {
        let script = script_path.clone();
        let out = out_dir.clone();
        let window_clone = window.clone();
        let counter_clone = completed.clone();
        let (s, o, d, m) = (
            split.to_string(),
            orient.to_string(),
            deskew.to_string(),
            margins.to_string(),
        );

        tasks.push(tokio::task::spawn_blocking(move || {
            let output = Command::new("python")
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
                ])
                .output()
                .map_err(|e| e.to_string())?;

            let count = counter_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            let _ = window_clone.emit(
                "process-progress",
                Progress {
                    percent: (count as f32 / total) * 100.0,
                    message: format!("Processed {}/{} pages via OpenCV...", count, total as i32),
                },
            );

            let result: CVResult = serde_json::from_slice(&output.stdout)
                .map_err(|e| format!("CV Script Error (Is Python/OpenCV installed?): {}", e))?;
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

#[tauri::command]
async fn generate_docx(
    window: tauri::Window,
    api_key: String,
    cleaned_paths: Vec<String>,
    original_img_path: String, // Tracks the source folder instead of aura_temp
    doc_type: String,
    custom_prompt: String,
    model: String,
    output_filename: String,
) -> Result<String, String> {
    let _ = window.emit(
        "process-progress",
        Progress {
            percent: 10.0,
            message: format!("Sending optimized scans to {}...", model),
        },
    );

    // Determines the output directory based on where you uploaded the first image from
    let original_dir = Path::new(&original_img_path).parent().unwrap().to_str().unwrap();
    
    let final_filename = if output_filename.to_lowercase().ends_with(".docx") {
        output_filename
    } else {
        format!("{}.docx", output_filename)
    };
    let output_docx_path = format!("{}/{}", original_dir, final_filename);

    let mut parts = vec![serde_json::json!({ 
        "text": format!("Extract all text/math from {} pages as JSON. Blocks: 'h1','h2','paragraph','bullet','numbered'. Prompt: {}", cleaned_paths.len(), custom_prompt) 
    })];

    for (idx, img_path) in cleaned_paths.iter().enumerate() {
        let img_bytes = std::fs::read(img_path).map_err(|e| e.to_string())?;
        parts.push(serde_json::json!({ "text": format!("--- PAGE {} ---", idx + 1) }));
        parts.push(serde_json::json!({
            "inline_data": { "mime_type": "image/png", "data": BASE64.encode(&img_bytes) }
        }));
    }

    let _ = window.emit(
        "process-progress",
        Progress {
            percent: 50.0,
            message: "AI is performing layout analysis and OCR...".into(),
        },
    );

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

    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(120)).build().unwrap();
    let res = client
        .post(format!("https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}", model, api_key))
        .json(&serde_json::json!({ "contents": [{ "parts": parts }], "generationConfig": config }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if let Some(err) = json.get("error") {
        return Err(format!("API Error: {}", err));
    }

    let _ = window.emit(
        "process-progress",
        Progress {
            percent: 85.0,
            message: "Building native DOCX Document...".into(),
        },
    );

    let mut docx = Docx::new();
    
    // Formatting logic based on the dropdown selector
    if doc_type.to_lowercase().contains("question paper") || doc_type.to_lowercase().contains("exam") {
        docx = docx
            .page_size(15840, 12240)
            .page_margin(PageMargin::new().top(720).bottom(720).left(720).right(720));
    }

    let parsed: serde_json::Value = serde_json::from_str(
        json["candidates"][0]["content"]["parts"][0]["text"].as_str().unwrap()
    ).map_err(|e| format!("Failed to parse Gemini JSON: {}", e))?;

    if let Some(title) = parsed.get("title") {
        docx = docx.add_paragraph(
            Paragraph::new().add_run(Run::new().add_text(title.as_str().unwrap()).bold().size(32))
        );
    }
    
    if let Some(blocks) = parsed.get("blocks").and_then(|b| b.as_array()) {
        for block in blocks {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            preprocess_images,
            generate_docx,
            open_document // Registered the OS-level bypass
        ])
        .run(tauri::generate_context!())
        .expect("error while running app");
}