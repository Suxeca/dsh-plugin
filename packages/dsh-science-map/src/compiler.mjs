import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

export function compileScienceMapToHtml(spec, options = {}) {
  const { assetsRoot = process.cwd() } = options;

  // 1. Compute geometry for nodes
  const COL_WIDTH = 250;
  const COL_GAP = 85;
  const ROW_HEIGHT = 76;
  const ROW_GAP = 65;
  const ORIGIN_X = 60;
  const ORIGIN_Y = 100;

  const nodeMap = new Map();
  let maxCol = 0;
  let maxRow = 0;

  for (const node of spec.nodes) {
    if (node.col > maxCol) maxCol = node.col;
    if (node.row > maxRow) maxRow = node.row;

    const width = node.width || COL_WIDTH;
    const height = node.height || ROW_HEIGHT;
    const x = ORIGIN_X + node.col * (COL_WIDTH + COL_GAP);
    const y = ORIGIN_Y + node.row * (ROW_HEIGHT + ROW_GAP);

    nodeMap.set(node.id, {
      ...node,
      computedWidth: width,
      computedHeight: height,
      x,
      y,
      centerX: x + width / 2,
      centerY: y + height / 2,
      leftPort: [x, y + height / 2],
      rightPort: [x + width, y + height / 2],
      topPort: [x + width / 2, y],
      bottomPort: [x + width / 2, y + height],
    });
  }

  const svgWidth = ORIGIN_X * 2 + (maxCol + 1) * (COL_WIDTH + COL_GAP);
  const svgHeight = ORIGIN_Y * 2 + (maxRow + 1) * (ROW_HEIGHT + ROW_GAP) + 40;

  // 2. Preload and embed figures as Base64 data URIs for 100% offline portability
  for (const node of spec.nodes) {
    if (node.figure && node.figure.asset_path) {
      const candidatePaths = [
        join(assetsRoot, node.figure.asset_path),
        resolve(node.figure.asset_path),
        join('/home/suxeca/Workspace/Z3model', node.figure.asset_path),
      ];

      for (const p of candidatePaths) {
        if (existsSync(p)) {
          try {
            const buf = readFileSync(p);
            const ext = p.endsWith('.png') ? 'png' : p.endsWith('.svg') ? 'svg+xml' : 'jpeg';
            node.figure.dataUri = `data:image/${ext};base64,${buf.toString('base64')}`;
            break;
          } catch (e) {
            console.error(`Failed to read image at ${p}:`, e);
          }
        }
      }
    }
  }

  // 3. Render Boundaries SVG
  let boundariesSvg = '';
  if (spec.boundaries && Array.isArray(spec.boundaries)) {
    for (const boundary of spec.boundaries) {
      const bNodes = boundary.nodes.map(id => nodeMap.get(id)).filter(Boolean);
      if (bNodes.length === 0) continue;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const bn of bNodes) {
        if (bn.x < minX) minX = bn.x;
        if (bn.y < minY) minY = bn.y;
        if (bn.x + bn.computedWidth > maxX) maxX = bn.x + bn.computedWidth;
        if (bn.y + bn.computedHeight > maxY) maxY = bn.y + bn.computedHeight;
      }

      const pad = 24;
      const bx = minX - pad;
      const by = minY - pad - 12;
      const bw = (maxX - minX) + pad * 2;
      const bh = (maxY - minY) + pad * 2 + 12;

      const strokeClass = boundary.variant === 'emphasis'
        ? 'boundary-emphasis'
        : boundary.variant === 'security'
        ? 'boundary-security'
        : 'boundary-default';

      boundariesSvg += `
        <g class="boundary-group" id="boundary-${boundary.id}">
          <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="14" class="boundary-box ${strokeClass}" />
          <text x="${bx + 14}" y="${by + 16}" class="boundary-label">${escapeHtml(boundary.label)}</text>
        </g>
      `;
    }
  }

  // 4. Render Edges SVG
  let edgesSvg = '';
  for (const edge of spec.edges) {
    const src = nodeMap.get(edge.from);
    const tgt = nodeMap.get(edge.to);
    if (!src || !tgt) continue;

    let x1, y1, x2, y2;
    let pathD = '';

    if (tgt.col > src.col) {
      // Forward rightwards connection
      [x1, y1] = src.rightPort;
      [x2, y2] = tgt.leftPort;
      const midX = (x1 + x2) / 2;
      pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    } else if (tgt.col === src.col) {
      // Same column vertical connection
      if (tgt.row > src.row) {
        [x1, y1] = src.bottomPort;
        [x2, y2] = tgt.topPort;
      } else {
        [x1, y1] = src.topPort;
        [x2, y2] = tgt.bottomPort;
      }
      pathD = `M ${x1} ${y1} L ${x2} ${y2}`;
    } else {
      // Backward or complex connection
      [x1, y1] = src.leftPort;
      [x2, y2] = tgt.rightPort;
      const midX = (x1 + x2) / 2;
      pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    }

    const isMain = edge.is_main_flow ? 'edge-main' : 'edge-normal';
    const variantClass = `edge-${edge.variant || 'default'} role-${edge.role || 'normal'}`;
    const markerId = edge.is_main_flow
      ? 'arrow-main'
      : edge.variant === 'emphasis'
      ? 'arrow-emphasis'
      : edge.variant === 'security'
      ? 'arrow-security'
      : edge.variant === 'dashed'
      ? 'arrow-dashed'
      : 'arrow-default';

    const labelX = (x1 + x2) / 2;
    const labelY = (y1 + y2) / 2 - 6;

    edgesSvg += `
      <g class="edge-group ${isMain} ${variantClass}" id="edge-${edge.id}" data-from="${edge.from}" data-to="${edge.to}">
        <path d="${pathD}" class="edge-path ${isMain}" marker-end="url(#${markerId})" />
        ${edge.label ? `
          <g class="edge-label-container" transform="translate(${labelX}, ${labelY})">
            <rect x="-4" y="-10" width="${edge.label.length * 11 + 8}" height="16" rx="4" class="edge-label-bg" />
            <text x="${edge.label.length * 5.5}" y="2" text-anchor="middle" class="edge-label-text">${escapeHtml(edge.label)}</text>
          </g>
        ` : ''}
      </g>
    `;
  }

  // 5. Render Nodes SVG
  let nodesSvg = '';
  for (const node of spec.nodes) {
    const comp = nodeMap.get(node.id);
    const categoryClass = `cat-${node.category}`;
    const mainLineClass = node.is_main_line ? 'node-main-line' : 'node-branch';

    // Badge label
    const categoryNames = {
      theoretical_axiom: 'Theory',
      model_mapping: 'Duality',
      code_operator: 'Code / Operator',
      hpc_campaign: 'HPC Campaign',
      observable: 'Observable',
      refuted_hypothesis: 'Cemetery (Refuted)',
    };
    const badgeText = node.tag || categoryNames[node.category] || node.category;

    // Has figure / discrepancy badge icons
    const hasFigure = node.figure ? `<circle cx="${comp.x + comp.computedWidth - 14}" cy="${comp.y + 14}" r="5" class="indicator-figure" title="Has Scientific Figure" />` : '';
    const hasDiscrepancy = node.evidence?.execution_audit?.discrepancy?.has_deviation
      ? `<circle cx="${comp.x + comp.computedWidth - 28}" cy="${comp.y + 14}" r="5" class="indicator-discrepancy" title="Execution Deviation Audited" />`
      : '';

    nodesSvg += `
      <g class="node-group ${categoryClass} ${mainLineClass}" id="node-${node.id}" data-id="${node.id}" onclick="selectNode('${node.id}')">
        <rect x="${comp.x}" y="${comp.y}" width="${comp.computedWidth}" height="${comp.computedHeight}" rx="10" class="node-rect ${categoryClass} ${mainLineClass}" />
        <text x="${comp.x + 14}" y="${comp.y + 20}" class="node-badge ${categoryClass}">${escapeHtml(badgeText)}</text>
        ${hasFigure}
        ${hasDiscrepancy}
        <text x="${comp.x + 14}" y="${comp.y + 40}" class="node-title">${escapeHtml(node.label)}</text>
        <text x="${comp.x + 14}" y="${comp.y + 57}" class="node-sublabel">${escapeHtml(node.sublabel || '')}</text>
      </g>
    `;
  }

  // 6. Assemble Full HTML
  const specJsonStr = JSON.stringify(spec).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="${spec.meta.locale || 'zh-CN'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(spec.meta.title)}</title>
  <style>
    :root {
      --bg: #090d16;
      --bg-panel: #101726;
      --bg-card: #162035;
      --border: #22324e;
      --text: #e2e8f0;
      --text-muted: #8e9fb5;
      --accent: #38bdf8;
      --accent-glow: rgba(56, 189, 248, 0.35);
      --gold: #f59e0b;
      --rose: #f43f5e;
      --emerald: #10b981;
      --purple: #a855f7;
      --indigo: #6366f1;
      --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }

    [data-theme="light"] {
      --bg: #f8fafc;
      --bg-panel: #ffffff;
      --bg-card: #f1f5f9;
      --border: #cbd5e1;
      --text: #0f172a;
      --text-muted: #64748b;
      --accent: #0284c7;
      --accent-glow: rgba(2, 132, 199, 0.2);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-family);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      height: 100vh;
    }

    /* Top Navigation Header */
    header {
      background: var(--bg-panel);
      border-bottom: 1px solid var(--border);
      padding: 10px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      z-index: 100;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .header-left {
      display: flex;
      align-items: baseline;
      gap: 12px;
    }
    .title {
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--text);
      letter-spacing: -0.01em;
    }
    .subtitle {
      font-size: 0.82rem;
      color: var(--text-muted);
    }
    .badge-science {
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.4);
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .header-controls {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .view-selector {
      display: flex;
      background: var(--bg-card);
      border-radius: 8px;
      border: 1px solid var(--border);
      overflow: hidden;
    }
    .view-tab {
      padding: 6px 14px;
      font-size: 0.8rem;
      cursor: pointer;
      border: none;
      background: transparent;
      color: var(--text-muted);
      transition: all 0.2s;
    }
    .view-tab.active {
      background: var(--accent);
      color: #fff;
      font-weight: 600;
    }
    .search-box {
      position: relative;
    }
    .search-input {
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 12px 6px 28px;
      border-radius: 6px;
      font-size: 0.8rem;
      width: 160px;
      outline: none;
      transition: width 0.2s;
    }
    .search-input:focus { width: 220px; border-color: var(--accent); }
    .search-icon {
      position: absolute;
      left: 8px;
      top: 7px;
      color: var(--text-muted);
      font-size: 0.8rem;
    }
    .btn-icon {
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.82rem;
      transition: background 0.2s;
    }
    .btn-icon:hover { background: var(--border); }

    /* Main Workspace */
    .workspace {
      flex: 1;
      position: relative;
      overflow: hidden;
      display: flex;
    }
    .canvas-container {
      flex: 1;
      height: 100%;
      cursor: grab;
      position: relative;
    }
    .canvas-container:active { cursor: grabbing; }

    /* SVG Styling */
    svg {
      width: 100%;
      height: 100%;
    }

    /* Boundaries */
    .boundary-box {
      fill: rgba(30, 41, 59, 0.3);
      stroke-dasharray: 6 6;
      stroke-width: 1.5;
    }
    .boundary-default { stroke: #475569; }
    .boundary-emphasis { stroke: #38bdf8; fill: rgba(56, 189, 248, 0.04); }
    .boundary-security { stroke: #f43f5e; fill: rgba(244, 63, 94, 0.04); }
    .boundary-label {
      font-size: 11px;
      font-weight: 600;
      fill: var(--text-muted);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    /* Edges */
    .edge-path {
      fill: none;
      stroke: #475569;
      stroke-width: 1.8;
      transition: stroke 0.3s, stroke-width 0.3s;
    }
    .edge-path.edge-main {
      stroke: var(--accent);
      stroke-width: 2.8;
      filter: drop-shadow(0 0 5px var(--accent-glow));
    }
    .edge-emphasis .edge-path { stroke: var(--accent); }
    .edge-security .edge-path { stroke: var(--rose); stroke-dasharray: 5 4; }
    .edge-dashed .edge-path { stroke-dasharray: 4 4; }
    .edge-label-bg {
      fill: var(--bg);
      opacity: 0.85;
    }
    .edge-label-text {
      font-size: 10.5px;
      fill: var(--text-muted);
      font-weight: 500;
    }

    /* Nodes */
    .node-group {
      cursor: pointer;
      transition: transform 0.2s;
    }
    .node-group:hover {
      transform: translateY(-2px);
    }
    .node-rect {
      fill: var(--bg-card);
      stroke: var(--border);
      stroke-width: 1.5;
      transition: stroke 0.3s, fill 0.3s, filter 0.3s;
    }
    .node-main-line .node-rect {
      stroke: var(--accent);
      stroke-width: 2;
      filter: drop-shadow(0 4px 10px rgba(56, 189, 248, 0.15));
    }
    .node-group.selected .node-rect {
      stroke: #fbbf24 !important;
      stroke-width: 2.5;
      filter: drop-shadow(0 0 12px rgba(251, 191, 36, 0.4));
    }

    .cat-theoretical_axiom .node-badge { fill: #818cf8; }
    .cat-model_mapping .node-badge { fill: #c084fc; }
    .cat-code_operator .node-badge { fill: #34d399; }
    .cat-hpc_campaign .node-badge { fill: #fbbf24; }
    .cat-observable .node-badge { fill: #38bdf8; }
    .cat-refuted_hypothesis .node-badge { fill: #fb7185; }
    .cat-refuted_hypothesis .node-rect { stroke: rgba(244, 63, 94, 0.4); stroke-dasharray: 4 4; fill: rgba(244, 63, 94, 0.05); }

    .node-badge {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
    }
    .node-title {
      font-size: 12.5px;
      font-weight: 600;
      fill: var(--text);
    }
    .node-sublabel {
      font-size: 10px;
      fill: var(--text-muted);
    }

    .indicator-figure {
      fill: #38bdf8;
      stroke: var(--bg-card);
      stroke-width: 1.5;
    }
    .indicator-discrepancy {
      fill: #f59e0b;
      stroke: var(--bg-card);
      stroke-width: 1.5;
    }

    /* Slide-out Scientific Drawer */
    .drawer {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      width: 480px;
      background: var(--bg-panel);
      border-left: 1px solid var(--border);
      box-shadow: -8px 0 24px rgba(0,0,0,0.3);
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
      z-index: 200;
    }
    .drawer.open { transform: translateX(0); }

    .drawer-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .drawer-title-box h3 {
      font-size: 1.1rem;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .drawer-title-box p {
      font-size: 0.82rem;
      color: var(--text-muted);
    }
    .btn-close {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 1.2rem;
      cursor: pointer;
      padding: 4px;
    }
    .btn-close:hover { color: var(--text); }

    .drawer-tabs {
      display: flex;
      background: var(--bg-card);
      border-bottom: 1px solid var(--border);
    }
    .dtab {
      flex: 1;
      text-align: center;
      padding: 10px 0;
      font-size: 0.8rem;
      color: var(--text-muted);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }
    .dtab.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
      font-weight: 600;
    }

    .drawer-body {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
    }

    .section-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 14px;
    }
    .section-card h4 {
      font-size: 0.85rem;
      color: var(--accent);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .formula-box {
      background: rgba(0,0,0,0.25);
      border-left: 3px solid var(--accent);
      padding: 10px 12px;
      font-family: "Fira Code", monospace, serif;
      font-size: 0.85rem;
      color: #93c5fd;
      overflow-x: auto;
      margin: 8px 0;
    }

    /* Discrepancy High-Alert Card */
    .discrepancy-card {
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.4);
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 14px;
    }
    .discrepancy-card h4 {
      color: #fbbf24;
      font-size: 0.85rem;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .param-compare {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin: 8px 0;
      font-size: 0.78rem;
    }
    .param-box {
      background: var(--bg-panel);
      padding: 8px;
      border-radius: 6px;
      border: 1px solid var(--border);
    }
    .param-box strong { display: block; margin-bottom: 4px; color: var(--text-muted); }

    /* Figure Drawer */
    .figure-container {
      margin-top: 10px;
      text-align: center;
    }
    .figure-container img {
      max-width: 100%;
      border-radius: 6px;
      border: 1px solid var(--border);
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    .figure-caption {
      font-size: 0.78rem;
      color: var(--text-muted);
      margin-top: 6px;
      text-align: left;
    }

    /* Bottom Conclusions Banner */
    .bottom-bar {
      background: var(--bg-panel);
      border-top: 1px solid var(--border);
      padding: 10px 24px;
      display: flex;
      align-items: center;
      gap: 20px;
      font-size: 0.8rem;
    }
    .conclusion-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .dot.cyan { background: #38bdf8; }
    .dot.emerald { background: #10b981; }
    .dot.rose { background: #f43f5e; }

    /* Dim / Focus State for Views */
    .dimmed { opacity: 0.12 !important; transition: opacity 0.3s; }
  </style>
</head>
<body>

  <header>
    <div class="header-left">
      <span class="badge-science">Science Map</span>
      <h1 class="title">${escapeHtml(spec.meta.title)}</h1>
      <span class="subtitle">${escapeHtml(spec.meta.subtitle || '')}</span>
    </div>

    <div class="header-controls">
      <div class="view-selector">
        ${(spec.meta.views || []).map((v, i) => `
          <button class="view-tab ${i === 0 ? 'active' : ''}" onclick="selectView('${v.id}')">${escapeHtml(v.label)}</button>
        `).join('')}
      </div>

      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="text" id="searchInput" class="search-input" placeholder="按 / 搜索节点..." oninput="handleSearch(this.value)">
      </div>

      <button class="btn-icon" onclick="resetZoom()" title="复位视图 (0)">0</button>
      <button class="btn-icon" onclick="toggleTheme()" title="切换主题 (T)">T</button>
      <button class="btn-icon" onclick="toggleFullscreen()" title="全屏 (F)">F</button>
    </div>
  </header>

  <div class="workspace">
    <div class="canvas-container" id="canvasContainer">
      <svg id="mainSvg" viewBox="0 0 ${svgWidth} ${svgHeight}">
        <defs>
          <marker id="arrow-default" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M 0 1 L 7 4 L 0 7 Z" fill="#64748b" />
          </marker>
          <marker id="arrow-emphasis" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
            <path d="M 0 1 L 8 4.5 L 0 8 Z" fill="#38bdf8" />
          </marker>
          <marker id="arrow-main" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
            <path d="M 0 1 L 9 5 L 0 9 Z" fill="#38bdf8" />
          </marker>
          <marker id="arrow-security" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M 0 1 L 7 4 L 0 7 Z" fill="#f43f5e" />
          </marker>
          <marker id="arrow-dashed" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M 0 1 L 7 4 L 0 7 Z" fill="#94a3b8" />
          </marker>
        </defs>

        <g id="transformGroup">
          ${boundariesSvg}
          ${edgesSvg}
          ${nodesSvg}
        </g>
      </svg>
    </div>

    <!-- Slide-out Scientific Drawer -->
    <div class="drawer" id="detailDrawer">
      <div class="drawer-header">
        <div class="drawer-title-box">
          <h3 id="drawerTitle">Node Details</h3>
          <p id="drawerSubtitle">Category &amp; Verification</p>
        </div>
        <button class="btn-close" onclick="closeDrawer()">✕</button>
      </div>

      <div class="drawer-tabs">
        <div class="dtab active" id="tabTheoryBtn" onclick="switchDrawerTab('theory')">理论证据</div>
        <div class="dtab" id="tabCodeBtn" onclick="switchDrawerTab('code')">代码物理映射</div>
        <div class="dtab" id="tabHpcBtn" onclick="switchDrawerTab('hpc')">执行与偏差审计</div>
        <div class="dtab" id="tabFigureBtn" onclick="switchDrawerTab('figure')">学术图表</div>
      </div>

      <div class="drawer-body" id="drawerBody">
        <!-- Content populated via JavaScript -->
      </div>
    </div>
  </div>

  <div class="bottom-bar">
    <strong style="color: var(--accent);">核心结论：</strong>
    ${(spec.meta.conclusions || []).map(c => `
      <div class="conclusion-item">
        <span class="dot ${c.dot || 'cyan'}"></span>
        <span><strong>${escapeHtml(c.title)}:</strong> ${escapeHtml(c.items?.[0] || '')}</span>
      </div>
    `).join('')}
  </div>

  <script>
    const SPEC = ${specJsonStr};
    const nodeMap = new Map(SPEC.nodes.map(n => [n.id, n]));
    let currentNodeId = null;
    let currentTab = 'theory';

    // Pan & Zoom
    let scale = 1;
    let panX = 0;
    let panY = 0;
    let isDragging = false;
    let startX, startY;

    const container = document.getElementById('canvasContainer');
    const transformGroup = document.getElementById('transformGroup');

    container.addEventListener('mousedown', (e) => {
      if (e.target.closest('.node-group')) return;
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

    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      scale = Math.min(Math.max(0.4, scale * zoomFactor), 3.0);
      applyTransform();
    });

    function applyTransform() {
      transformGroup.setAttribute('transform', \`translate(\${panX}, \${panY}) scale(\${scale})\`);
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

    function toggleFullscreen() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }

    // Node Selection & Drawer
    function selectNode(id) {
      currentNodeId = id;
      const node = nodeMap.get(id);
      if (!node) return;

      document.querySelectorAll('.node-group').forEach(el => el.classList.remove('selected'));
      const el = document.getElementById('node-' + id);
      if (el) el.classList.add('selected');

      document.getElementById('drawerTitle').innerText = node.label;
      document.getElementById('drawerSubtitle').innerText = (node.tag ? '[' + node.tag + '] ' : '') + (node.sublabel || '');

      // Open drawer and default to best tab
      document.getElementById('detailDrawer').classList.add('open');

      if (node.figure) {
        switchDrawerTab('figure');
      } else if (node.evidence?.execution_audit?.discrepancy?.has_deviation) {
        switchDrawerTab('hpc');
      } else if (node.evidence?.code_realization) {
        switchDrawerTab('code');
      } else {
        switchDrawerTab('theory');
      }
    }

    function closeDrawer() {
      document.getElementById('detailDrawer').classList.remove('open');
      document.querySelectorAll('.node-group').forEach(el => el.classList.remove('selected'));
      currentNodeId = null;
    }

    function switchDrawerTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.dtab').forEach(el => el.classList.remove('active'));
      const btn = document.getElementById('tab' + capitalize(tab) + 'Btn');
      if (btn) btn.classList.add('active');

      renderDrawerContent();
    }

    function capitalize(s) {
      return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function renderDrawerContent() {
      const node = nodeMap.get(currentNodeId);
      if (!node) return;

      const body = document.getElementById('drawerBody');
      const ev = node.evidence || {};

      if (currentTab === 'theory') {
        const t = ev.theory;
        if (!t) {
          body.innerHTML = '<p style="color:var(--text-muted);">该节点无直接代数公式定义，属于计算或观测量结果。</p>';
          return;
        }
        body.innerHTML = \`
          <div class="section-card">
            <h4>代数定义与哈密顿量</h4>
            \${t.formula_latex ? \`<div class="formula-box">\${escapeHtml(t.formula_latex)}</div>\` : ''}
            <p style="font-size:0.83rem; line-height:1.5; color:var(--text);">\${escapeHtml(t.warrant || '无正规形式化依据说明')}</p>
          </div>
          \${t.invariants && t.invariants.length > 0 ? \`
            <div class="section-card">
              <h4>物理对称性与守恒不变量</h4>
              <ul style="padding-left:18px; font-size:0.82rem; color:var(--text-muted); line-height:1.6;">
                \${t.invariants.map(inv => \`<li>\${escapeHtml(inv)}</li>\`).join('')}
              </ul>
            </div>
          \` : ''}
        \`;
      } else if (currentTab === 'code') {
        const c = ev.code_realization;
        if (!c) {
          body.innerHTML = '<p style="color:var(--text-muted);">该节点为纯理论公理或宏观观测量，无对应底层代码实现行。</p>';
          return;
        }
        body.innerHTML = \`
          <div class="section-card">
            <h4>代码物理映射 (Ground Truth)</h4>
            <div style="font-size:0.82rem; color:var(--text-muted); margin-bottom:8px;">
              <strong>仓库路径:</strong> <code>\${escapeHtml(c.repo_path || 'N/A')}</code><br>
              <strong>代码行号:</strong> <code>\${escapeHtml(c.lines || 'N/A')}</code><br>
              \${c.git_commit ? \`<strong>固定Commit:</strong> <code>\${escapeHtml(c.git_commit.slice(0, 8))}</code><br>\` : ''}
            </div>
            <p style="font-size:0.83rem; line-height:1.5; color:var(--text);">\${escapeHtml(c.physical_interpretation || '')}</p>
          </div>
          \${c.rationale_for_change ? \`
            <div class="section-card">
              <h4>为什么进行代码架构调整 (Rationale)</h4>
              <p style="font-size:0.83rem; color:var(--text); line-height:1.5;">\${escapeHtml(c.rationale_for_change)}</p>
            </div>
          \` : ''}
        \`;
      } else if (currentTab === 'hpc') {
        const h = ev.execution_audit;
        if (!h) {
          body.innerHTML = '<p style="color:var(--text-muted);">该节点非超算大规模运行战役，无 SLURM 执行审计记录。</p>';
          return;
        }

        const d = h.discrepancy;
        body.innerHTML = \`
          \${d && d.has_deviation ? \`
            <div class="discrepancy-card">
              <h4>⚠️ 执行偏差审计警告 (Audit Discrepancy)</h4>
              <p style="font-size:0.83rem; color:var(--text); line-height:1.5; margin-bottom:8px;">
                <strong>偏差归因分析:</strong> \${escapeHtml(d.rationale)}
              </p>
              <div class="param-compare">
                <div class="param-box">
                  <strong>用户指令期望参数</strong>
                  <pre style="white-space:pre-wrap;">\${JSON.stringify(h.requested_parameters, null, 2)}</pre>
                </div>
                <div class="param-box">
                  <strong>LLM 实际提交运行参数</strong>
                  <pre style="white-space:pre-wrap;">\${JSON.stringify(h.actual_parameters, null, 2)}</pre>
                </div>
              </div>
            </div>
          \` : ''}

          <div class="section-card">
            <h4>SLURM 执行凭据</h4>
            <div style="font-size:0.82rem; color:var(--text-muted); line-height:1.6;">
              <strong>Job IDs:</strong> \${(h.slurm_job_ids || []).join(', ') || 'N/A'}<br>
              <strong>运行脚本:</strong> <code>\${escapeHtml(h.slurm_script || 'N/A')}</code><br>
              <strong>计算资源:</strong> \${escapeHtml(h.resources_used || 'N/A')}
            </div>
          </div>
        \`;
      } else if (currentTab === 'figure') {
        const f = node.figure;
        if (!f) {
          body.innerHTML = '<p style="color:var(--text-muted);">该节点无附加学术图表资产。</p>';
          return;
        }

        body.innerHTML = \`
          <div class="section-card">
            <h4>\${escapeHtml(f.title)}</h4>
            <div class="figure-container">
              <img src="\${f.dataUri || f.asset_path}" alt="\${escapeHtml(f.title)}" />
              <p class="figure-caption">\${escapeHtml(f.caption || '')}</p>
            </div>
            \${f.key_metrics && f.key_metrics.length > 0 ? \`
              <div style="margin-top:14px; border-top:1px solid var(--border); padding-top:10px;">
                <strong style="font-size:0.8rem; color:var(--text-muted);">关键物理指标:</strong>
                <div style="display:flex; gap:12px; margin-top:6px;">
                  \${f.key_metrics.map(m => \`
                    <div style="background:var(--bg-panel); padding:6px 10px; border-radius:6px; font-size:0.8rem;">
                      <span style="color:var(--text-muted);">\${escapeHtml(m.label)}:</span>
                      <strong style="color:var(--accent);">\${escapeHtml(m.value)} \${escapeHtml(m.unit || '')}</strong>
                    </div>
                  \`).join('')}
                </div>
              </div>
            \` : ''}
          </div>
        \`;
      }
    }

    // Views / Stories
    function selectView(viewId) {
      document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
      const view = (SPEC.meta.views || []).find(v => v.id === viewId);
      if (!view) return;

      const btn = Array.from(document.querySelectorAll('.view-tab')).find(b => b.getAttribute('onclick')?.includes(viewId));
      if (btn) btn.classList.add('active');

      const focusSet = new Set(view.focus || []);
      document.querySelectorAll('.node-group').forEach(el => {
        const id = el.getAttribute('data-id');
        if (focusSet.has(id)) {
          el.classList.remove('dimmed');
        } else {
          el.classList.add('dimmed');
        }
      });

      document.querySelectorAll('.edge-group').forEach(el => {
        const from = el.getAttribute('data-from');
        const to = el.getAttribute('data-to');
        if (focusSet.has(from) && focusSet.has(to)) {
          el.classList.remove('dimmed');
        } else {
          el.classList.add('dimmed');
        }
      });
    }

    // Search
    function handleSearch(query) {
      const q = query.trim().toLowerCase();
      if (!q) {
        document.querySelectorAll('.node-group, .edge-group').forEach(el => el.classList.remove('dimmed'));
        return;
      }

      document.querySelectorAll('.node-group').forEach(el => {
        const id = el.getAttribute('data-id');
        const node = nodeMap.get(id);
        const match = node && (
          node.label.toLowerCase().includes(q) ||
          (node.sublabel && node.sublabel.toLowerCase().includes(q)) ||
          (node.tag && node.tag.toLowerCase().includes(q))
        );
        if (match) {
          el.classList.remove('dimmed');
        } else {
          el.classList.add('dimmed');
        }
      });
    }

    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('searchInput').focus();
      } else if (e.key === '0') {
        resetZoom();
      } else if (e.key === 't' || e.key === 'T') {
        toggleTheme();
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 'Escape') {
        closeDrawer();
      } else if (e.key === '[' || e.key === ']') {
        const views = SPEC.meta.views || [];
        if (views.length === 0) return;
        const currentActiveIdx = views.findIndex(v => {
          const btn = Array.from(document.querySelectorAll('.view-tab')).find(b => b.getAttribute('onclick')?.includes(v.id));
          return btn && btn.classList.contains('active');
        });
        let nextIdx = e.key === ']' ? currentActiveIdx + 1 : currentActiveIdx - 1;
        if (nextIdx < 0) nextIdx = views.length - 1;
        if (nextIdx >= views.length) nextIdx = 0;
        selectView(views[nextIdx].id);
      }
    });

    function escapeHtml(str) {
      return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
      }[m]));
    }
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
}
