import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.BIND_HOST || "0.0.0.0";

const ALLOWED_ROOT_DIRS = new Set(["shared", "composeApp", "server", "iosApp", "gradle", "docs"]);
const ALLOWED_ROOT_FILES = new Set([
  "README.md",
  "build.gradle.kts",
  "settings.gradle.kts",
  "gradle.properties",
  "metadata.json",
]);

function walkFiles(relDir, out = []) {
  const full = path.join(__dirname, relDir);
  if (!fs.existsSync(full)) return out;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "build" || entry.name === "node_modules") continue;
    const childRel = path.posix.join(relDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(childRel, out);
    } else if (/\.(kt|kts|sq|swift|xml|toml|html|md|properties)$/i.test(entry.name)) {
      out.push(childRel);
    }
  }
  return out;
}

function listProjectFiles() {
  const files = [];
  for (const f of ALLOWED_ROOT_FILES) {
    if (fs.existsSync(path.join(__dirname, f))) files.push(f);
  }
  for (const dir of ALLOWED_ROOT_DIRS) {
    walkFiles(dir, files);
  }
  return files.sort();
}

function isAllowedPath(relPath) {
  if (!relPath || relPath.includes("\0") || relPath.startsWith("/") || relPath.includes("..")) return false;
  const normalized = path.posix.normalize(relPath);
  if (ALLOWED_ROOT_FILES.has(normalized)) return true;
  const top = normalized.split("/")[0];
  if (!ALLOWED_ROOT_DIRS.has(top)) return false;
  const resolved = path.resolve(__dirname, normalized);
  return resolved.startsWith(__dirname + path.sep) && fs.existsSync(resolved) && fs.statSync(resolved).isFile();
}

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CrateSync</title>
  <meta name="description" content="Build playlists from the audio folders on your device, read their tags, match songs to YouTube, and push each playlist to your YouTube Music account." />
  <meta property="og:title" content="CrateSync" />
  <meta property="og:description" content="Build playlists from the audio folders on your device, read their tags, match songs to YouTube, and push each playlist to your YouTube Music account." />
  <style>
    :root {
      --bg: #0D0F14;
      --surface: #151922;
      --card: #1C222E;
      --border: #2B3345;
      --text: #F2F5FA;
      --muted: #98A2B3;
      --crimson: #F43F5E;
      --mint: #10B981;
      --amber: #F59E0B;
      --sky: #38BDF8;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; background: var(--bg); color: var(--text); font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .app { display: grid; grid-template-columns: 310px 1fr; height: 100vh; }
    aside { background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; }
    .brand { padding: 18px 18px 14px; border-bottom: 1px solid var(--border); }
    .brand-title { font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
    .dot { width: 10px; height: 10px; border-radius: 999px; background: var(--crimson); display: inline-block; }
    .brand-sub { font-size: 12px; color: var(--muted); margin-top: 4px; }
    .search-box { padding: 12px 14px; border-bottom: 1px solid var(--border); }
    .search-box input { width: 100%; background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 8px 10px; font-size: 13px; outline: none; }
    .search-box input:focus { border-color: var(--crimson); }
    .file-list { overflow-y: auto; padding: 8px; flex: 1; }
    .group-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); padding: 10px 10px 4px; font-weight: 600; }
    .file-item { width: 100%; text-align: left; background: transparent; border: none; color: var(--text); padding: 7px 10px; border-radius: 6px; cursor: pointer; font-size: 12.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .file-item:hover { background: rgba(255,255,255,0.05); }
    .file-item.active { background: rgba(244,63,94,0.16); color: #FDA4AF; }
    main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
    header { padding: 14px 22px; background: var(--surface); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .targets { display: flex; gap: 8px; flex-wrap: wrap; }
    .tag { font-size: 11.5px; padding: 4px 10px; border-radius: 6px; background: var(--card); border: 1px solid var(--border); color: var(--text); font-weight: 500; }
    .content { flex: 1; overflow: auto; padding: 20px 22px; display: flex; flex-direction: column; gap: 18px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 14px; }
    .card h3 { margin: 0 0 6px; font-size: 14px; }
    .card p { margin: 0; font-size: 12.5px; color: var(--muted); line-height: 1.5; }
    .cmds { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px; }
    .cmds-title { font-size: 12.5px; font-weight: 600; margin-bottom: 8px; color: var(--muted); }
    pre.cmd-block { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; color: #A7F3D0; line-height: 1.6; overflow-x: auto; }
    .viewer { flex: 1; min-height: 360px; background: #0A0C10; border: 1px solid var(--border); border-radius: 10px; display: flex; flex-direction: column; overflow: hidden; }
    .viewer-bar { padding: 10px 14px; background: var(--surface); border-bottom: 1px solid var(--border); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; color: var(--sky); display: flex; justify-content: space-between; }
    .viewer pre { margin: 0; padding: 14px; overflow: auto; flex: 1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; line-height: 1.55; color: #E2E8F0; tab-size: 4; }
    @media (max-width: 820px) {
      .app { grid-template-columns: 1fr; grid-template-rows: 260px 1fr; }
      aside { border-right: none; border-bottom: 1px solid var(--border); }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside>
      <div class="brand">
        <div class="brand-title"><span class="dot"></span> CrateSync KMP</div>
        <div class="brand-sub">Kotlin Multiplatform &amp; Compose Multiplatform Workspace</div>
      </div>
      <div class="search-box">
        <input id="filter" type="text" placeholder="Filter Kotlin / SQLDelight / Swift files..." />
      </div>
      <div id="fileList" class="file-list"></div>
    </aside>
    <main>
      <header>
        <div>
          <strong>Multi-Module KMP Repository</strong>
          <span style="color: var(--muted); font-size: 12.5px; margin-left: 8px;" id="fileCount"></span>
        </div>
        <div class="targets">
          <span class="tag">Android (Media3)</span>
          <span class="tag">iOS (SwiftUI + AVAudioEngine)</span>
          <span class="tag">Desktop (JVM)</span>
          <span class="tag">Web (Kotlin/WasmJs)</span>
          <span class="tag">Server (Ktor + Gemini)</span>
        </div>
      </header>
      <div class="content">
        <div class="grid">
          <div class="card">
            <h3>:shared</h3>
            <p>Pure-Kotlin tag parser, SHA-256 dedup, ITU-R BS.1770 ReplayGain DSP, crossfade curves, Drive 3-phase DFS, YouTube LIS push, SQLDelight schema, and 4 platform adapters.</p>
          </div>
          <div class="card">
            <h3>:composeApp</h3>
            <p>Shared Compose Multiplatform UI across all 7 workspaces (Dashboard, Device Storage, Playlists, Smart Playlists, Sync Queue, Scan Logs, Drive &amp; Transfer) + platform entrypoints.</p>
          </div>
          <div class="card">
            <h3>:server</h3>
            <p>Ktor Netty JVM proxy verifying Firebase JWTs via Google JWKS, rate limiting per account, and calling gemini-4-hydrogen for metadata grounding &amp; genre classification.</p>
          </div>
          <div class="card">
            <h3>iosApp</h3>
            <p>SwiftUI host project wrapping ComposeApp's MainViewControllerKt for iOS deployment.</p>
          </div>
        </div>
        <div class="cmds">
          <div class="cmds-title">Local Gradle Commands (JDK 17+ required outside sandbox)</div>
          <pre class="cmd-block">./gradlew :shared:allTests
./gradlew :composeApp:run
./gradlew :composeApp:assembleDebug
./gradlew :composeApp:wasmJsBrowserDevelopmentRun
./gradlew :server:run</pre>
        </div>
        <div class="viewer">
          <div class="viewer-bar">
            <span id="activePath">README.md</span>
            <span id="lineCount" style="color: var(--muted);"></span>
          </div>
          <pre id="codeContent">Loading source...</pre>
        </div>
      </div>
    </main>
  </div>
  <script>
    let allFiles = [];
    let currentFile = "README.md";

    async function loadFile(filePath) {
      currentFile = filePath;
      document.getElementById("activePath").textContent = filePath;
      renderList();
      const res = await fetch("/api/source?path=" + encodeURIComponent(filePath));
      if (!res.ok) {
        document.getElementById("codeContent").textContent = "Unable to load file.";
        return;
      }
      const text = await res.text();
      document.getElementById("codeContent").textContent = text;
      document.getElementById("lineCount").textContent = text.split("\\n").length + " lines";
    }

    function renderList() {
      const q = document.getElementById("filter").value.trim().toLowerCase();
      const filtered = q ? allFiles.filter(f => f.toLowerCase().includes(q)) : allFiles;
      const groups = new Map();
      for (const f of filtered) {
        const g = f.includes("/") ? f.split("/")[0] : "root";
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(f);
      }
      const container = document.getElementById("fileList");
      container.innerHTML = "";
      for (const [group, items] of groups) {
        const lbl = document.createElement("div");
        lbl.className = "group-label";
        lbl.textContent = group + " (" + items.length + ")";
        container.appendChild(lbl);
        for (const item of items) {
          const btn = document.createElement("button");
          btn.className = "file-item" + (item === currentFile ? " active" : "");
          btn.textContent = item.startsWith(group + "/") ? item.slice(group.length + 1) : item;
          btn.title = item;
          btn.onclick = () => loadFile(item);
          container.appendChild(btn);
        }
      }
    }

    async function init() {
      const res = await fetch("/api/files");
      const data = await res.json();
      allFiles = data.files || [];
      document.getElementById("fileCount").textContent = allFiles.length + " source files";
      renderList();
      loadFile(allFiles.includes("README.md") ? "README.md" : allFiles[0]);
    }

    document.getElementById("filter").addEventListener("input", renderList);
    init();
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/files") {
    const files = listProjectFiles();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ files }));
    return;
  }

  if (url.pathname === "/api/source") {
    const rel = url.searchParams.get("path") || "";
    if (!isAllowedPath(rel)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const content = fs.readFileSync(path.resolve(__dirname, rel), "utf8");
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(content);
    return;
  }

  if (url.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "ok", mode: "kmp-workspace-preview" }));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(INDEX_HTML);
});

server.listen(PORT, HOST, () => {
  console.log(`CrateSync KMP workspace preview listening on http://${HOST}:${PORT}`);
});
