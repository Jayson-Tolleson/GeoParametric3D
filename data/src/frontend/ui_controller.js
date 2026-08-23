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
    this.fileInput = document.getElementById('step-file-input');
    this.btnUpload = document.getElementById('btn-upload-step');
    this.telemetryBox = document.getElementById('telemetry-terminal');
    this.propsContainer = document.getElementById('properties-content');
    this.btnFlyHome = document.getElementById('btn-fly-home');
    this.statusBadge = document.getElementById('system-status-badge');
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
          if (this.telemetryBox && data.lines) {
            this.telemetryBox.innerHTML = data.lines.map(line => {
              let colorClass = 'text-slate-300';
              if (line.includes('[STEP')) colorClass = 'text-cyan-400 font-mono';
              if (line.includes('[IMPORT SUCCESS]')) colorClass = 'text-emerald-400 font-semibold';
              if (line.includes('[ERROR]') || line.includes('[WARN]')) colorClass = 'text-rose-400';
              return `<div class="${colorClass} text-xs leading-relaxed py-0.5">${this.escapeHTML(line)}</div>`;
            }).join('');
            this.telemetryBox.scrollTop = this.telemetryBox.scrollHeight;
          }
        }
      } catch (e) { /* silent poll */ }
      setTimeout(poll, 1000);
    };
    poll();
  }

  updateStatusBadge(text, colorClass) {
    if (!this.statusBadge) return;
    this.statusBadge.className = `px-2.5 py-1 rounded-full text-xs font-semibold text-white transition-all ${colorClass}`;
    this.statusBadge.textContent = text;
  }

  render(event, data) {
    if (event === 'units_changed') {
      if (this.unitStatusEl) {
        this.unitStatusEl.textContent = CADState.isImperial() ? 'Imperial (in)' : 'Metric (mm)';
      }
      this.renderProperties();
    } else if (event === 'selection_changed' || event === 'assembly_loaded') {
      this.renderProperties();
    }
  }

  renderProperties() {
    if (!this.propsContainer) return;

    const assembly = CADState.getAssembly();
    const selFaceId = CADState.getSelectedFace();

    if (!assembly) {
      this.propsContainer.innerHTML = '<div class="text-slate-400 text-xs italic">No CAD model loaded</div>';
      return;
    }

    let selectedFaceData = null;
    let selectedSolidData = null;

    if (selFaceId && assembly.solids) {
      for (const solid of assembly.solids) {
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
            <div class="text-xs font-semibold text-sky-400 tracking-wider uppercase">Selected Planar Face</div>
            <div class="text-sm font-mono text-white font-bold">${selectedFaceData.face_id}</div>
            <div class="text-xs text-slate-400">Solid: ${selectedSolidData.name}</div>
          </div>

          <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="bg-slate-800/80 p-2 rounded border border-slate-700/50">
              <span class="text-slate-400 block">Topology</span>
              <span class="text-emerald-400 font-semibold">True N-Gon (Zero Diag)</span>
            </div>
            <div class="bg-slate-800/80 p-2 rounded border border-slate-700/50">
              <span class="text-slate-400 block">Vertices</span>
              <span class="text-white font-mono">${selectedFaceData.vertex_count || 0} pts</span>
            </div>
            <div class="bg-slate-800/80 p-2 rounded border border-slate-700/50">
              <span class="text-slate-400 block">Cutout Voids</span>
              <span class="text-white font-mono">${selectedFaceData.holes_count || 0} loops</span>
            </div>
            <div class="bg-slate-800/80 p-2 rounded border border-slate-700/50">
              <span class="text-slate-400 block">Surface Type</span>
              <span class="text-sky-300 font-mono">GeomAbs_Plane</span>
            </div>
          </div>

          <div class="border-t border-slate-700/60 pt-2">
            <div class="text-xs font-semibold text-slate-300 mb-1">Solid Bounding Box (${unitLabel})</div>
            <div class="text-xs font-mono text-amber-300 bg-slate-950/60 p-2 rounded border border-slate-800">
              ${CADState.formatDimensions(dims)}
            </div>
            <div class="text-[11px] text-slate-400 mt-1">
              Diagonal: <span class="text-slate-200 font-mono">${CADState.formatLinear(diag)}</span>
            </div>
          </div>
        </div>
      `;
    } else {
      // Overall Assembly Summary
      this.propsContainer.innerHTML = `
        <div class="space-y-3">
          <div class="border-b border-slate-700/60 pb-2">
            <div class="text-xs font-semibold text-sky-400 tracking-wider uppercase">Assembly Summary</div>
            <div class="text-sm font-semibold text-white">${assembly.filename || 'Active CAD Model'}</div>
          </div>

          <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="bg-slate-800/80 p-2 rounded border border-slate-700/50">
              <span class="text-slate-400 block">Solid Bodies</span>
              <span class="text-white font-mono font-bold">${assembly.total_solids || 0}</span>
            </div>
            <div class="bg-slate-800/80 p-2 rounded border border-slate-700/50">
              <span class="text-slate-400 block">True N-Gons</span>
              <span class="text-emerald-400 font-mono font-bold">${assembly.total_ngons || 0}</span>
            </div>
            <div class="bg-slate-800/80 p-2 rounded border border-slate-700/50">
              <span class="text-slate-400 block">Mesh Triangles</span>
              <span class="text-sky-300 font-mono font-bold">${(assembly.total_triangles || 0).toLocaleString()}</span>
            </div>
            <div class="bg-slate-800/80 p-2 rounded border border-slate-700/50">
              <span class="text-slate-400 block">Viewport Target</span>
              <span class="text-emerald-300 font-semibold">60.0 FPS</span>
            </div>
          </div>

          <div class="text-[11px] text-slate-400 bg-slate-900/60 p-2.5 rounded border border-slate-800">
            Click any planar polygon in the <span class="text-sky-400 font-semibold">&lt;gmp-map-3d&gt;</span> viewport to inspect individual topological loop bounds and dimensions.
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
