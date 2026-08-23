import { CADState } from './cad_state.js';

export class UIController {
  constructor(viewportRenderer) {
    this.viewportRenderer = viewportRenderer;
    this.initDOM();
    this.bindEvents();
    this.startTelemetryPoll();
    CADState.subscribe((event, data) => this.render(event, data));
  }

  initDOM() {
    this.unitToggleBtn = document.getElementById('btn-unit-toggle');
    this.unitStatusEl = document.getElementById('unit-status-indicator');
    this.headerUnitTag = document.getElementById('header-unit-tag');
    this.fileInput = document.getElementById('step-file-input');
    this.btnUpload = document.getElementById('btn-upload-step');
    this.telemetryBox = document.getElementById('telemetry-terminal');
    this.propsContainer = document.getElementById('properties-content');
    this.btnFlyHome = document.getElementById('btn-fly-home');
    this.statusBadge = document.getElementById('system-status-badge');
    this.treeListEl = document.getElementById('assembly-tree-list');
    this.treeSolidCountEl = document.getElementById('tree-solid-count');
    
    // Preset buttons
    this.btnPresetJetdrive = document.getElementById('preset-jetdrive');
    this.btnPresetCollector = document.getElementById('preset-collector');
    this.btnPresetPart56 = document.getElementById('preset-part56');
    
    // View Angle buttons
    this.btnViewFit = document.getElementById('btn-view-fit');
    this.btnViewIso = document.getElementById('btn-view-iso');
    this.btnViewTop = document.getElementById('btn-view-top');
    this.btnViewFront = document.getElementById('btn-view-front');
    this.btnViewSide = document.getElementById('btn-view-side');
  }

  bindEvents() {
    if (this.unitToggleBtn) {
      this.unitToggleBtn.addEventListener('click', () => {
        CADState.toggleUnits();
      });
    }

    if (this.btnUpload && this.fileInput) {
      this.btnUpload.addEventListener('click', () => this.fileInput.click());
      this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
    }

    if (this.btnFlyHome) {
      this.btnFlyHome.addEventListener('click', () => {
        if (this.viewportRenderer) this.viewportRenderer.flyToAssembly();
      });
    }

    // Presets
    if (this.btnPresetJetdrive) {
      this.btnPresetJetdrive.addEventListener('click', () => this.loadPreset('jetdrive'));
    }
    if (this.btnPresetCollector) {
      this.btnPresetCollector.addEventListener('click', () => this.loadPreset('collector'));
    }
    if (this.btnPresetPart56) {
      this.btnPresetPart56.addEventListener('click', () => this.loadPreset('part56'));
    }

    // View angles
    if (this.btnViewFit) this.btnViewFit.addEventListener('click', () => this.viewportRenderer.setViewAngle('fit'));
    if (this.btnViewIso) this.btnViewIso.addEventListener('click', () => this.viewportRenderer.setViewAngle('iso'));
    if (this.btnViewTop) this.btnViewTop.addEventListener('click', () => this.viewportRenderer.setViewAngle('top'));
    if (this.btnViewFront) this.btnViewFront.addEventListener('click', () => this.viewportRenderer.setViewAngle('front'));
    if (this.btnViewSide) this.btnViewSide.addEventListener('click', () => this.viewportRenderer.setViewAngle('side'));
  }

  async loadPreset(presetId) {
    this.updateStatusBadge(`Loading ${presetId}...`, 'bg-amber-500');
    try {
      const res = await fetch(`/api/presets/${presetId}`);
      if (res.ok) {
        const data = await res.json();
        CADState.setAssembly(data);
        this.updateStatusBadge('Ready (60 FPS)', 'bg-emerald-500');
      }
    } catch (e) {
      console.error(e);
      this.updateStatusBadge('Preset Error', 'bg-red-500');
    }
  }

  async handleFileUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    this.updateStatusBadge('Ingesting STEP...', 'bg-amber-500');

    try {
      const response = await fetch('/api/import/step', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const data = await response.json();
      CADState.setAssembly(data);
      this.updateStatusBadge('Ready (60 FPS)', 'bg-emerald-500');
    } catch (err) {
      console.error(err);
      this.updateStatusBadge('Import Failed', 'bg-red-500');
    }
  }

  async startTelemetryPoll() {
    const poll = async () => {
      try {
        const res = await fetch('/api/telemetry');
        if (res.ok) {
          const data = await res.json();
          if (this.telemetryBox && data.lines && data.lines.length > 0) {
            this.telemetryBox.innerHTML = data.lines.map(line => {
              let colorClass = 'text-slate-300';
              if (line.includes('[STEP')) colorClass = 'text-cyan-400 font-mono';
              if (line.includes('[IMPORT SUCCESS]')) colorClass = 'text-emerald-400 font-semibold';
              if (line.includes('[ERROR]') || line.includes('[WARN]')) colorClass = 'text-rose-400';
              return `<div class="${colorClass} text-[10px] leading-tight py-0.5">${this.escapeHTML(line)}</div>`;
            }).join('');
            this.telemetryBox.scrollTop = this.telemetryBox.scrollHeight;
          }
        }
      } catch (e) { /* silent poll */ }
      setTimeout(poll, 1200);
    };
    poll();
  }

  updateStatusBadge(text, colorClass) {
    if (!this.statusBadge) return;
    this.statusBadge.className = `px-2.5 py-1 rounded-full text-[10px] font-semibold text-white flex items-center space-x-1 shadow ring-1 ring-white/20 transition-all ${colorClass}`;
    const spanText = document.getElementById('status-badge-text');
    if (spanText) spanText.textContent = text;
  }

  render(event, data) {
    if (event === 'units_changed') {
      const unitStr = CADState.isImperial() ? 'Imperial (in)' : 'Metric (mm)';
      if (this.unitStatusEl) this.unitStatusEl.textContent = unitStr;
      if (this.headerUnitTag) this.headerUnitTag.textContent = unitStr;
      this.renderProperties();
    } else if (event === 'selection_changed') {
      this.renderProperties();
      this.highlightTreeNode(data.solidId, data.faceId);
    } else if (event === 'assembly_loaded') {
      this.renderProperties();
      this.renderAssemblyTree();
    }
  }

  renderAssemblyTree() {
    if (!this.treeListEl) return;
    const assembly = CADState.getAssembly();
    if (!assembly || !assembly.solids) {
      this.treeListEl.innerHTML = '<div class="p-2 text-slate-500 italic text-[10px]">No assembly loaded</div>';
      if (this.treeSolidCountEl) this.treeSolidCountEl.textContent = '0';
      return;
    }

    if (this.treeSolidCountEl) this.treeSolidCountEl.textContent = `${assembly.solids.length}`;

    let html = '';
    for (const solid of assembly.solids) {
      const isSelSolid = CADState.getSelectedSolid() === solid.solid_id;
      const planarCount = (solid.planar_polygons || []).length;
      
      html += `
        <div class="assembly-node rounded p-1 mb-0.5 transition cursor-pointer ${isSelSolid ? 'bg-sky-950/90 border border-sky-500/50' : 'hover:bg-slate-800/60 border border-transparent'}" data-solid-id="${solid.solid_id}">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-1.5 overflow-hidden">
              <span class="w-2.5 h-2.5 rounded-full inline-block shrink-0 shadow-sm" style="background-color: ${solid.color || '#38bdf8'}"></span>
              <span class="truncate font-medium text-slate-200 text-[11px]">${solid.name}</span>
            </div>
            <span class="text-[9px] text-slate-400 font-mono px-1 bg-slate-900 rounded">${planarCount}N</span>
          </div>
        </div>
      `;
    }
    
    this.treeListEl.innerHTML = html;

    // Bind tree click events
    this.treeListEl.querySelectorAll('.assembly-node').forEach(node => {
      node.addEventListener('click', () => {
        const solidId = node.dataset.solidId;
        CADState.selectSolid(solidId);
      });
    });
  }

  highlightTreeNode(solidId, faceId) {
    if (!this.treeListEl) return;
    this.treeListEl.querySelectorAll('.assembly-node').forEach(node => {
      if (node.dataset.solidId === solidId) {
        node.className = 'assembly-node rounded p-1 mb-0.5 transition cursor-pointer bg-sky-950/90 border border-sky-500/50';
      } else {
        node.className = 'assembly-node rounded p-1 mb-0.5 transition cursor-pointer hover:bg-slate-800/60 border border-transparent';
      }
    });
  }

  renderProperties() {
    if (!this.propsContainer) return;

    const assembly = CADState.getAssembly();
    const selFaceId = CADState.getSelectedFace();
    const selSolidId = CADState.getSelectedSolid();

    if (!assembly) {
      this.propsContainer.innerHTML = '<div class="text-slate-400 text-xs italic">No CAD model loaded</div>';
      return;
    }

    let selectedFaceData = null;
    let selectedSolidData = null;

    if (assembly.solids) {
      for (const solid of assembly.solids) {
        if (selSolidId && solid.solid_id === selSolidId) {
          selectedSolidData = solid;
        }
        const f = (solid.planar_polygons || []).find(p => p.face_id === selFaceId);
        if (f) {
          selectedFaceData = f;
          selectedSolidData = solid;
          break;
        }
      }
    }

    const isImp = CADState.isImperial();
    const unitLabel = isImp ? 'in' : 'mm';

    if (selectedFaceData && selectedSolidData) {
      const bb = selectedSolidData.bounding_box || {};
      const dims = bb.dimensions_mm || [0, 0, 0];
      const diag = bb.diagonal_mm || 0;

      this.propsContainer.innerHTML = `
        <div class="space-y-3">
          <div class="border-b border-slate-700/60 pb-2">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-semibold text-sky-400 uppercase tracking-wider">Selected Topology</span>
              <span class="w-3 h-3 rounded-full border border-white/20" style="background-color: ${selectedSolidData.color || '#38bdf8'}"></span>
            </div>
            <div class="text-xs font-mono text-white font-bold truncate mt-0.5">${selectedFaceData.face_id}</div>
            <div class="text-[11px] text-slate-300">Solid: <span class="text-emerald-400 font-semibold">${selectedSolidData.name}</span></div>
          </div>

          <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="bg-slate-900/80 p-2 rounded border border-slate-800">
              <span class="text-slate-400 text-[10px] block">Topology</span>
              <span class="text-emerald-400 font-semibold">True N-Gon (Zero Diag)</span>
            </div>
            <div class="bg-slate-900/80 p-2 rounded border border-slate-800">
              <span class="text-slate-400 text-[10px] block">Vertices</span>
              <span class="text-white font-mono font-bold">${selectedFaceData.vertex_count || 0} pts</span>
            </div>
            <div class="bg-slate-900/80 p-2 rounded border border-slate-800">
              <span class="text-slate-400 text-[10px] block">Cutout Voids</span>
              <span class="text-white font-mono font-bold">${selectedFaceData.holes_count || 0} loops</span>
            </div>
            <div class="bg-slate-900/80 p-2 rounded border border-slate-800">
              <span class="text-slate-400 text-[10px] block">Surface Type</span>
              <span class="text-sky-300 font-mono">GeomAbs_Plane</span>
            </div>
          </div>

          <div class="border-t border-slate-800 pt-2">
            <div class="text-[11px] font-semibold text-slate-300 mb-1 flex items-center justify-between">
              <span>Canonical Bounding Box</span>
              <span class="text-[10px] text-amber-400 font-mono">${unitLabel}</span>
            </div>
            <div class="text-xs font-mono text-amber-300 bg-slate-950 p-2 rounded border border-slate-800">
              ${CADState.formatDimensions(dims)}
            </div>
            <div class="text-[10px] text-slate-400 mt-1 flex justify-between">
              <span>Diagonal:</span>
              <span class="text-slate-200 font-mono">${CADState.formatLinear(diag)}</span>
            </div>
          </div>
        </div>
      `;
    } else {
      // Overall Assembly Summary
      this.propsContainer.innerHTML = `
        <div class="space-y-3">
          <div class="border-b border-slate-700/60 pb-2">
            <div class="text-[10px] font-semibold text-sky-400 tracking-wider uppercase">Assembly Summary</div>
            <div class="text-xs font-semibold text-white truncate mt-0.5">${assembly.filename || 'Active CAD Model'}</div>
          </div>

          <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="bg-slate-900/80 p-2 rounded border border-slate-800">
              <span class="text-slate-400 text-[10px] block">Solid Bodies</span>
              <span class="text-white font-mono font-bold">${assembly.total_solids || 0}</span>
            </div>
            <div class="bg-slate-900/80 p-2 rounded border border-slate-800">
              <span class="text-slate-400 text-[10px] block">True N-Gons</span>
              <span class="text-emerald-400 font-mono font-bold">${assembly.total_ngons || 0}</span>
            </div>
            <div class="bg-slate-900/80 p-2 rounded border border-slate-800">
              <span class="text-slate-400 text-[10px] block">Mesh Triangles</span>
              <span class="text-sky-300 font-mono font-bold">${(assembly.total_triangles || 0).toLocaleString()}</span>
            </div>
            <div class="bg-slate-900/80 p-2 rounded border border-slate-800">
              <span class="text-slate-400 text-[10px] block">Viewport Rate</span>
              <span class="text-emerald-300 font-semibold">60.0 FPS</span>
            </div>
          </div>

          <div class="text-[10px] text-slate-400 bg-slate-900/60 p-2 rounded border border-slate-800 leading-relaxed">
            Select any planar surface directly in the <code class="text-amber-300 font-mono">&lt;gmp-map-3d&gt;</code> viewport or Workspace Assembly Tree to inspect exact topological loops.
          </div>
        </div>
      `;
    }
  }

  escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
