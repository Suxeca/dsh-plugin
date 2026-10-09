import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function renderDerivationUnitsMap(units, options = {}) {
  const { title = "Z₃ 模型理论推导单元微地图 (Science Map · Derivation Units)" } = options;

  const unitsJson = JSON.stringify(units).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <!-- KaTeX for crisp LaTeX formula rendering -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js" onload="renderMathInElement(document.body);"></script>

  <style>
    :root {
      --bg: #090d16;
      --bg-panel: #0f172a;
      --bg-card: #1e293b;
      --bg-hover: #334155;
      --border: #334155;
      --border-accent: #38bdf8;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --gold: #f59e0b;
      --rose: #f43f5e;
      --emerald: #10b981;
      --purple: #a855f7;
    }

    [data-theme="light"] {
      --bg: #f8fafc;
      --bg-panel: #ffffff;
      --bg-card: #f1f5f9;
      --bg-hover: #e2e8f0;
      --border: #cbd5e1;
      --border-accent: #0284c7;
      --text: #0f172a;
      --text-muted: #64748b;
      --accent: #0284c7;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    header {
      background: var(--bg-panel);
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      z-index: 10;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .badge {
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
    }
    h1 { font-size: 1.15rem; font-weight: 700; }
    .subtitle { font-size: 0.8rem; color: var(--text-muted); margin-left: 8px; }

    .header-controls {
      display: flex;
      gap: 8px;
    }
    .btn {
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.82rem;
      transition: all 0.2s;
    }
    .btn:hover { background: var(--bg-hover); }
    .btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }

    /* Main Split Layout */
    .container {
      flex: 1;
      display: grid;
      grid-template-columns: 340px 1fr 420px;
      overflow: hidden;
    }

    /* Left: Unit Navigation & Cognitive Steps */
    .sidebar {
      background: var(--bg-panel);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .unit-selector {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .unit-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .unit-card:hover { border-color: var(--accent); transform: translateX(2px); }
    .unit-card.active { border-color: var(--accent); background: rgba(56, 189, 248, 0.08); box-shadow: 0 0 10px rgba(56, 189, 248, 0.2); }
    .unit-id { font-size: 0.72rem; font-weight: 700; color: var(--accent); text-transform: uppercase; }
    .unit-title { font-size: 0.88rem; font-weight: 600; margin: 2px 0 4px; }
    .unit-desc { font-size: 0.75rem; color: var(--text-muted); line-height: 1.3; }

    .step-list {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .step-node {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      cursor: pointer;
      position: relative;
      transition: all 0.2s;
    }
    .step-node:hover { border-color: var(--accent); }
    .step-node.active {
      border-color: var(--gold);
      background: rgba(245, 158, 11, 0.08);
      box-shadow: 0 0 12px rgba(245, 158, 11, 0.25);
    }
    .step-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .step-idx {
      font-size: 0.7rem;
      font-weight: 700;
      color: var(--accent);
      background: rgba(56, 189, 248, 0.12);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .step-tag {
      font-size: 0.7rem;
      color: var(--text-muted);
    }
    .step-title { font-size: 0.85rem; font-weight: 600; }
    .step-summary { font-size: 0.76rem; color: var(--text-muted); margin-top: 4px; line-height: 1.4; }

    /* Middle: High-Res Handwritten Canvas Viewer */
    .canvas-view {
      position: relative;
      background: #111827;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .handwritten-img {
      max-width: 95%;
      max-height: 95%;
      object-fit: contain;
      border-radius: 8px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      border: 1px solid var(--border);
      transition: transform 0.2s ease;
      cursor: grab;
    }
    .handwritten-img:active { cursor: grabbing; }

    .canvas-bar {
      position: absolute;
      top: 14px;
      left: 14px;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(8px);
      border: 1px solid var(--border);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 0.76rem;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    /* Right: Secretary Rigorous Synthesis & Code Grounding */
    .secretary-panel {
      background: var(--bg-panel);
      border-left: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 20px;
      gap: 18px;
    }
    .panel-section {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
    }
    .panel-section h3 {
      font-size: 0.92rem;
      color: var(--accent);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 8px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .formula-card {
      background: rgba(0,0,0,0.25);
      border-left: 3px solid var(--accent);
      padding: 12px;
      border-radius: 0 6px 6px 0;
      margin: 10px 0;
      font-size: 0.9rem;
      overflow-x: auto;
    }

    .table-clean {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
      margin-top: 8px;
    }
    .table-clean th, .table-clean td {
      padding: 8px 10px;
      border: 1px solid var(--border);
      text-align: left;
    }
    .table-clean th {
      background: rgba(0,0,0,0.2);
      color: var(--text-muted);
      font-weight: 600;
    }

    .aha-box {
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.35);
      border-radius: 8px;
      padding: 12px;
      margin: 10px 0;
      font-size: 0.82rem;
      line-height: 1.5;
    }
    .aha-title {
      font-weight: 700;
      color: var(--gold);
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .code-chip {
      display: inline-block;
      font-family: monospace;
      font-size: 0.76rem;
      background: rgba(56, 189, 248, 0.1);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 2px 6px;
      border-radius: 4px;
      margin: 2px 0;
    }
  </style>
</head>
<body>

  <header>
    <div class="header-left">
      <span class="badge">Science Map</span>
      <h1>${title}</h1>
      <span class="subtitle">手稿单元收纳 · 认知推导链解构 · 秘书严谨沉淀</span>
    </div>

    <div class="header-controls">
      <button class="btn" onclick="toggleTheme()" title="切换主题 (T)">🌓 主题</button>
      <button class="btn" onclick="resetZoom()" title="复位画布 (0)">⟲ 复位画布</button>
    </div>
  </header>

  <div class="container">
    <!-- Left: Derivation Units & Cognitive Steps -->
    <div class="sidebar">
      <div class="unit-selector" id="unitSelector">
        <!-- Rendered by JS -->
      </div>
      <div class="step-list" id="stepList">
        <!-- Step items rendered by JS -->
      </div>
    </div>

    <!-- Middle: Handwritten Canvas Viewer -->
    <div class="canvas-view" id="canvasView">
      <div class="canvas-bar">
        <span>手稿来源: <strong id="canvasFileName">z3对称性检查.qnote</strong></span>
        <span>•</span>
        <span>矢量笔迹: <strong id="canvasStrokeCount">818</strong> strokes</span>
      </div>
      <img src="" id="handwrittenImg" class="handwritten-img" alt="手写推导笔记" />
    </div>

    <!-- Right: Secretary Rigorous Synthesis & Code Grounding -->
    <div class="secretary-panel" id="secretaryPanel">
      <!-- Populated by JS -->
    </div>
  </div>

  <script>
    const UNITS = ${unitsJson};
    let currentUnitId = Object.keys(UNITS)[0];
    let currentStepIdx = 0;

    // Zoom & Pan for handwritten image
    let scale = 1;
    let panX = 0;
    let panY = 0;
    let isDragging = false;
    let startX, startY;

    const img = document.getElementById('handwrittenImg');
    const canvasView = document.getElementById('canvasView');

    canvasView.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      applyTransform();
    });

    window.addEventListener('mouseup', () => { isDragging = false; });

    canvasView.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      scale = Math.min(Math.max(0.6, scale * zoomFactor), 4.0);
      applyTransform();
    });

    function applyTransform() {
      img.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${scale})\`;
    }

    function resetZoom() {
      scale = 1;
      panX = 0;
      panY = 0;
      applyTransform();
    }

    function toggleTheme() {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      document.documentElement.setAttribute('data-theme', isLight ? 'dark' : 'light');
    }

    // Initialize UI
    function init() {
      renderUnitSelector();
      selectUnit(currentUnitId);
    }

    function renderUnitSelector() {
      const el = document.getElementById('unitSelector');
      el.innerHTML = Object.entries(UNITS).map(([id, u]) => \`
        <div class="unit-card \${id === currentUnitId ? 'active' : ''}" onclick="selectUnit('\${id}')">
          <div class="unit-id">\${u.unitId}</div>
          <div class="unit-title">\${escapeHtml(u.title)}</div>
          <div class="unit-desc">\${escapeHtml(u.brief)}</div>
        </div>
      \`).join('');
    }

    function selectUnit(unitId) {
      currentUnitId = unitId;
      const u = UNITS[unitId];
      if (!u) return;

      renderUnitSelector();

      // Update canvas image
      document.getElementById('canvasFileName').innerText = u.sourceFile;
      document.getElementById('canvasStrokeCount').innerText = u.strokeCount;
      document.getElementById('handwrittenImg').src = u.imageDataUri;
      resetZoom();

      // Render steps
      renderSteps(u.steps);

      // Render secretary synthesis panel
      renderSecretaryPanel(u);

      // Trigger math rendering
      if (window.renderMathInElement) {
        setTimeout(() => renderMathInElement(document.getElementById('secretaryPanel')), 50);
      }
    }

    function renderSteps(steps) {
      const el = document.getElementById('stepList');
      el.innerHTML = steps.map((s, idx) => \`
        <div class="step-node \${idx === currentStepIdx ? 'active' : ''}" onclick="selectStep(\${idx})">
          <div class="step-header">
            <span class="step-idx">Step \${idx + 1}</span>
            <span class="step-tag">\${escapeHtml(s.tag || '')}</span>
          </div>
          <div class="step-title">\${escapeHtml(s.title)}</div>
          <div class="step-summary">\${escapeHtml(s.summary)}</div>
        </div>
      \`).join('');
    }

    function selectStep(idx) {
      currentStepIdx = idx;
      const u = UNITS[currentUnitId];
      renderSteps(u.steps);
      const s = u.steps[idx];
      if (s && s.focusNote) {
        // Highlight in panel if applicable
      }
    }

    function renderSecretaryPanel(u) {
      const el = document.getElementById('secretaryPanel');
      el.innerHTML = \`
        <div class="panel-section">
          <h3>📋 秘书严谨推演归纳 (Synthesized Results)</h3>
          \${u.synthesisHtml || ''}
        </div>

        <div class="panel-section">
          <h3>💡 顿悟与认知突破 (Aha! Moments)</h3>
          \${u.ahaMoments.map(m => \`
            <div class="aha-box">
              <div class="aha-title">★ \${escapeHtml(m.title)}</div>
              <p>\${escapeHtml(m.detail)}</p>
            </div>
          \`).join('')}
        </div>

        <div class="panel-section">
          <h3>🔗 代码库真实闭环 (Code Grounding)</h3>
          <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px;">
            该手写推导直接支撑并裁定以下代码实现：
          </p>
          \${u.codeLinks.map(c => \`
            <div style="margin-bottom:8px;">
              <span class="code-chip">\${escapeHtml(c.path)}</span>
              <p style="font-size:0.78rem; line-height:1.4; margin-top:2px;">\${escapeHtml(c.desc)}</p>
            </div>
          \`).join('')}
        </div>
      \`;
    }

    function escapeHtml(str) {
      return String(str || '').replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
      }[m]));
    }

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === '0') resetZoom();
      if (e.key === 't' || e.key === 'T') toggleTheme();
      if (e.key === '1') selectUnit('unit1');
      if (e.key === '2') selectUnit('unit2');
    });

    init();
  </script>
</body>
</html>`;
}
