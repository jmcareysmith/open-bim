//! DWG support through an external converter the user installs, so no DWG library is linked into
//! this MIT-licensed app: the free ODA File Converter (proprietary freeware) or LibreDWG's
//! `dwg2dxf` / `dxf2dwg` command-line tools (GPL, run as separate programs). DWG is converted
//! to/from DXF in a temporary folder and the app's own DXF import/export does the rest.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq)]
pub enum Converter {
    Oda(PathBuf),
    LibreDwg { dwg2dxf: PathBuf, dxf2dwg: PathBuf },
}

/// ODA File Converter arguments: input folder, output folder, version, type, recurse, audit, filter.
pub fn oda_args(input_dir: &Path, output_dir: &Path, to_dwg: bool) -> Vec<String> {
    vec![
        input_dir.display().to_string(),
        output_dir.display().to_string(),
        "ACAD2018".into(),
        if to_dwg { "DWG" } else { "DXF" }.into(),
        "0".into(),
        "1".into(),
        if to_dwg { "*.DXF" } else { "*.DWG" }.into(),
    ]
}

/// LibreDWG arguments: overwrite, output file, input file.
pub fn libredwg_args(input: &Path, output: &Path) -> Vec<String> {
    vec!["-y".into(), "-o".into(), output.display().to_string(), input.display().to_string()]
}

fn on_path(name: &str) -> Option<PathBuf> {
    let exe = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    std::env::var_os("PATH").and_then(|p| std::env::split_paths(&p).map(|d| d.join(&exe)).find(|f| f.is_file()))
}

/// Where the ODA File Converter usually installs.
fn find_oda() -> Option<PathBuf> {
    if let Some(p) = on_path("ODAFileConverter") {
        return Some(p);
    }
    if cfg!(windows) {
        for root in ["C:\\Program Files\\ODA", "C:\\Program Files (x86)\\ODA"] {
            let mut found: Vec<PathBuf> = fs::read_dir(root)
                .into_iter()
                .flatten()
                .flatten()
                .map(|e| e.path().join("ODAFileConverter.exe"))
                .filter(|p| p.is_file())
                .collect();
            found.sort();
            if let Some(p) = found.pop() {
                return Some(p);
            }
        }
    }
    for p in ["/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter", "/usr/bin/ODAFileConverter", "/usr/local/bin/ODAFileConverter"] {
        if Path::new(p).is_file() {
            return Some(p.into());
        }
    }
    None
}

/// The converter to use: an explicit path (ODA executable, or LibreDWG's dwg2dxf/dxf2dwg), else
/// whatever is installed (ODA preferred).
pub fn find_converter(explicit: Option<&str>) -> Result<Converter, String> {
    if let Some(p) = explicit.map(str::trim).filter(|p| !p.is_empty()) {
        let path = PathBuf::from(p);
        if !path.is_file() {
            return Err(format!("Converter not found: {p}"));
        }
        let name = path.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        if name == "dwg2dxf" || name == "dxf2dwg" {
            let dir = path.parent().unwrap_or(Path::new("."));
            let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
            return Ok(Converter::LibreDwg { dwg2dxf: dir.join(format!("dwg2dxf{ext}")), dxf2dwg: dir.join(format!("dxf2dwg{ext}")) });
        }
        return Ok(Converter::Oda(path));
    }
    if let Some(p) = find_oda() {
        return Ok(Converter::Oda(p));
    }
    if let (Some(a), Some(b)) = (on_path("dwg2dxf"), on_path("dxf2dwg")) {
        return Ok(Converter::LibreDwg { dwg2dxf: a, dxf2dwg: b });
    }
    Err("No DWG converter found. Install the free ODA File Converter (opendesign.com) or LibreDWG, or set its path.".into())
}

struct TempDir(PathBuf);
impl TempDir {
    fn new() -> std::io::Result<Self> {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("open-bim-cad-{}-{nanos}", std::process::id()));
        fs::create_dir_all(dir.join("in"))?;
        fs::create_dir_all(dir.join("out"))?;
        Ok(Self(dir))
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn run(exe: &Path, args: &[String]) -> Result<(), String> {
    let out = Command::new(exe).args(args).output().map_err(|e| format!("Could not run {}: {e}", exe.display()))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("{} failed: {}", exe.display(), err.trim()));
    }
    Ok(())
}

/// Convert one file between DWG and DXF; returns the output file's bytes.
pub fn convert(conv: &Converter, input_name: &str, input: &[u8], to_dwg: bool) -> Result<Vec<u8>, String> {
    let tmp = TempDir::new().map_err(|e| e.to_string())?;
    let stem = Path::new(input_name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "drawing".into());
    let (in_ext, out_ext) = if to_dwg { ("dxf", "dwg") } else { ("dwg", "dxf") };
    let src = tmp.0.join("in").join(format!("{stem}.{in_ext}"));
    fs::write(&src, input).map_err(|e| e.to_string())?;
    let dst = tmp.0.join("out").join(format!("{stem}.{out_ext}"));
    match conv {
        Converter::Oda(exe) => run(exe, &oda_args(&tmp.0.join("in"), &tmp.0.join("out"), to_dwg))?,
        Converter::LibreDwg { dwg2dxf, dxf2dwg } => run(if to_dwg { dxf2dwg } else { dwg2dxf }, &libredwg_args(&src, &dst))?,
    }
    // ODA may change the extension's case.
    let found = fs::read_dir(tmp.0.join("out"))
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.extension().map(|e| e.eq_ignore_ascii_case(out_ext)).unwrap_or(false))
        .ok_or_else(|| "The converter produced no output (is the file a valid drawing?)".to_string())?;
    fs::read(found).map_err(|e| e.to_string())
}

/// Read a DWG file and return it as DXF text.
#[tauri::command]
pub fn dwg_to_dxf(path: String, converter: Option<String>) -> Result<String, String> {
    let conv = find_converter(converter.as_deref())?;
    let bytes = fs::read(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    let name = Path::new(&path).file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let dxf = convert(&conv, &name, &bytes, false)?;
    Ok(String::from_utf8_lossy(&dxf).into_owned())
}

/// Write DXF text out as a DWG file at `path`.
#[tauri::command]
pub fn dxf_to_dwg(dxf: String, path: String, converter: Option<String>) -> Result<(), String> {
    let conv = find_converter(converter.as_deref())?;
    let name = Path::new(&path).file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let dwg = convert(&conv, &name, dxf.as_bytes(), true)?;
    fs::write(&path, dwg).map_err(|e| format!("Could not write {path}: {e}"))
}

/// Which converter would be used (for the UI).
#[tauri::command]
pub fn dwg_converter(converter: Option<String>) -> Result<String, String> {
    find_converter(converter.as_deref()).map(|c| match c {
        Converter::Oda(p) => format!("ODA File Converter ({})", p.display()),
        Converter::LibreDwg { dwg2dxf, .. } => format!("LibreDWG ({})", dwg2dxf.parent().map(|d| d.display().to_string()).unwrap_or_default()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oda_arguments() {
        let a = oda_args(Path::new("in"), Path::new("out"), false);
        assert_eq!(a[2..], ["ACAD2018", "DXF", "0", "1", "*.DWG"]);
        assert_eq!(oda_args(Path::new("in"), Path::new("out"), true)[3], "DWG");
    }

    #[test]
    fn libredwg_arguments() {
        assert_eq!(libredwg_args(Path::new("a.dwg"), Path::new("b.dxf")), ["-y", "-o", "b.dxf", "a.dwg"]);
    }

    #[test]
    fn explicit_paths() {
        assert!(find_converter(Some("/definitely/not/here")).unwrap_err().contains("not found"));
        // A real file named dwg2dxf selects LibreDWG and its sibling dxf2dwg.
        let tmp = TempDir::new().unwrap();
        let exe = tmp.0.join(if cfg!(windows) { "dwg2dxf.exe" } else { "dwg2dxf" });
        fs::write(&exe, b"").unwrap();
        match find_converter(exe.to_str()).unwrap() {
            Converter::LibreDwg { dxf2dwg, .. } => assert!(dxf2dwg.ends_with(if cfg!(windows) { "dxf2dwg.exe" } else { "dxf2dwg" })),
            other => panic!("expected LibreDWG, got {other:?}"),
        }
    }

    #[test]
    fn converts_with_a_stand_in_tool() {
        // A fake "dwg2dxf" that copies input to output proves the temp-folder plumbing.
        if cfg!(windows) {
            let tmp = TempDir::new().unwrap();
            let exe = tmp.0.join("dwg2dxf.cmd");
            fs::write(&exe, "@copy /y \"%4\" \"%3\" >nul\r\n").unwrap();
            let conv = Converter::LibreDwg { dwg2dxf: exe.clone(), dxf2dwg: exe };
            let out = convert(&conv, "site.dwg", b"0\nEOF\n", false).unwrap();
            assert_eq!(out, b"0\nEOF\n");
        }
    }
}
