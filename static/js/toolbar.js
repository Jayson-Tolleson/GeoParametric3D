"use strict";

import { CADCommands } from './commands.js';
import { windowViewport } from './viewport.js';
import { CADApi } from './api.js';
import { CADState } from './state.js';
import { windowUI } from './ui.js';
import { CADShare } from './share.js';

document.addEventListener('DOMContentLoaded', () => {
  const bindBtn = (id, handler) => {
    const btn = document.getElementById(id);
    btn?.addEventListener('click', (e) => {
      e.preventDefault();
      handler();
    });
  };

  // 1. SESSION & PERSISTENCE
  bindBtn('toolbar-new', () => CADCommands.newDocument());
  bindBtn('toolbar-undo', () => CADCommands.undo());
  bindBtn('toolbar-redo', () => CADCommands.redo());
  bindBtn('toolbar-prefs', () => windowUI.openPreferencesModal());

  bindBtn('toolbar-save', async () => {
    const pid = CADState.state.projectId;
    const res = await CADApi.saveProject(pid, CADState.state);
    if (res?.success) {
      windowUI.logServerEvent(`[STORAGE] Saved session to storage/${res.project_id}.json`);
      alert(`Project successfully saved to storage/${res.project_id}.json`);
    }
  });

  bindBtn('toolbar-open', async () => {
    const pid = prompt('Enter UUID project to open from /storage:', CADState.state.projectId || '');
    if (pid) {
      const res = await CADApi.loadProject(pid.trim());
      if (res?.success && res.document) {
        CADState.setDocument(res.document);
        windowViewport.centerViewport();
        windowUI.logServerEvent(`[STORAGE] Loaded UUID project: ${pid}`);
      } else {
        alert(`Failed to load project: ${res?.error || 'File not found'}`);
      }
    }
  });

  bindBtn('toolbar-import', () => CADCommands.execute('import'));
  bindBtn('toolbar-export', async () => {
    const fmt = prompt('Export format: xbf or step', 'xbf');
    if (fmt) {
      const res = await CADApi.exportModel(fmt.trim().toLowerCase());
      if (res?.ok || res?.success) {
        windowUI.logServerEvent(`[EXPORT] Downloaded ${res.filename || fmt}`);
      } else {
        alert(`Export Failed: ${res?.error || 'Unknown error'}`);
      }
    }
  });

  // SHARE & CAPTURE TOOLBAR HANDLERS
  bindBtn('btn-share-snapshot', () => CADShare.takeSnapshot(false));
  bindBtn('btn-share-snapshot-all', () => CADShare.takeSnapshot(true));
  bindBtn('btn-share-record', () => {
    if (CADShare.isRecording) {
      CADShare.stopRecording();
    } else {
      CADShare.startRecording();
    }
  });
  bindBtn('btn-open-share-modal', () => CADShare.openShareModal());

  // Share Modal Actions
  const closeShareModal = () => {
    const modal = document.getElementById('share-social-modal');
    modal?.classList.add('hidden');
  };

  bindBtn('btn-share-modal-rec', () => {
    closeShareModal();
    CADShare.startRecording();
  });

  bindBtn('btn-share-modal-snap', () => {
    closeShareModal();
    CADShare.takeSnapshot(false);
  });

  bindBtn('btn-share-modal-snap-bars', () => {
    closeShareModal();
    CADShare.takeSnapshot(true);
  });

  document.getElementById('btn-close-share-modal')?.addEventListener('click', closeShareModal);
  document.getElementById('btn-close-share-footer')?.addEventListener('click', closeShareModal);

  // 2. 12" PRIMITIVES
  bindBtn('btn-add-box', () => CADCommands.createPrimitive('box'));
  bindBtn('btn-add-cylinder', () => CADCommands.createPrimitive('cylinder'));

  bindBtn('btn-add-sphere', () => {
    windowUI.openActionPanel('create_primitive', 'Sphere Primitive Feature', [
      { key: 'radius', label: 'Radius', baseLabel: 'Radius', isLength: true, type: 'number', default: 152.4 },
      { key: 'segments', label: 'Segments', type: 'number', default: 24, step: 1 },
      { key: 'cx', label: 'Center X', baseLabel: 'Center X', isLength: true, type: 'number', default: 0.0 },
      { key: 'cy', label: 'Center Y', baseLabel: 'Center Y', isLength: true, type: 'number', default: 0.0 },
      { key: 'cz', label: 'Center Z', baseLabel: 'Center Z', isLength: true, type: 'number', default: 0.0 }
    ], { primitiveType: 'sphere' });
  });

  bindBtn('btn-add-cone', () => CADCommands.createPrimitive('cone'));
  bindBtn('btn-add-torus', () => CADCommands.createPrimitive('torus'));

  bindBtn('btn-add-prism', () => {
    windowUI.openActionPanel('create_primitive', 'Prism Primitive Feature', [
      { key: 'sides', label: 'Side(s) Number (N)', type: 'number', default: 3, step: 1 },
      { key: 'radius', label: 'Base Circumradius', baseLabel: 'Base Circumradius', isLength: true, type: 'number', default: 152.4 },
      { key: 'height', label: 'Prism Height / Extrusion', baseLabel: 'Prism Height', isLength: true, type: 'number', default: 304.8 },
      { key: 'outline', label: 'Draft Outline Perimeter Only', type: 'checkbox', default: false },
      { key: 'shell', label: 'Hollow Shell Extrusion', type: 'checkbox', default: false }
    ], { primitiveType: 'prism' });
  });

  bindBtn('btn-add-polygon', () => {
    windowUI.openActionPanel('create_primitive', 'Polygon Primitive Feature', [
      { key: 'sides', label: 'Side(s) Number (N)', type: 'number', default: 6, step: 1 },
      { key: 'radius', label: 'Circumradius', baseLabel: 'Circumradius', isLength: true, type: 'number', default: 152.4 },
      { key: 'height', label: 'Extrusion Height', baseLabel: 'Extrusion Height', isLength: true, type: 'number', default: 50.0 },
      { key: 'outline', label: 'Draft Outline Perimeter Only', type: 'checkbox', default: false },
      { key: 'shell', label: 'Hollow Shell Extrusion', type: 'checkbox', default: false }
    ], { primitiveType: 'polygon' });
  });

  bindBtn('btn-add-ellipse', () => {
    windowUI.openActionPanel('create_primitive', 'Ellipse Primitive Feature', [
      { key: 'radius_x', label: 'Semi-Major Radius X', baseLabel: 'Semi-Major Radius X', isLength: true, type: 'number', default: 152.4 },
      { key: 'radius_y', label: 'Semi-Minor Radius Y', baseLabel: 'Semi-Minor Radius Y', isLength: true, type: 'number', default: 101.6 },
      { key: 'height', label: 'Extrusion Height', baseLabel: 'Extrusion Height', isLength: true, type: 'number', default: 50.0 },
      { key: 'outline', label: 'Draft Outline Perimeter Only', type: 'checkbox', default: false },
      { key: 'shell', label: 'Hollow Shell Extrusion', type: 'checkbox', default: false }
    ], { primitiveType: 'ellipse' });
  });

  bindBtn('btn-add-wedge', () => CADCommands.createPrimitive('wedge'));
  bindBtn('btn-add-pyramid', () => CADCommands.createPrimitive('pyramid'));

  bindBtn('btn-add-ellipsoid', () => {
    windowUI.openActionPanel('create_primitive', 'Ellipsoid Primitive Feature', [
      { key: 'radius_x', label: 'Radius X', baseLabel: 'Radius X', isLength: true, type: 'number', default: 152.4 },
      { key: 'radius_y', label: 'Radius Y', baseLabel: 'Radius Y', isLength: true, type: 'number', default: 101.6 },
      { key: 'radius_z', label: 'Radius Z', baseLabel: 'Radius Z', isLength: true, type: 'number', default: 76.2 },
      { key: 'cx', label: 'Center X', baseLabel: 'Center X', isLength: true, type: 'number', default: 0.0 },
      { key: 'cy', label: 'Center Y', baseLabel: 'Center Y', isLength: true, type: 'number', default: 0.0 },
      { key: 'cz', label: 'Center Z', baseLabel: 'Center Z', isLength: true, type: 'number', default: 0.0 }
    ], { primitiveType: 'ellipsoid' });
  });

  bindBtn('btn-add-tube', () => CADCommands.createPrimitive('tube'));
  bindBtn('btn-add-plane', () => CADCommands.createPrimitive('plane'));

  // 3. TRANSFORM TOOLS (Selectable Tool + Sizing Construction Lines + Action Panel)
  const toggleTransformTool = (toolName, defaultAction) => {
    const isCurrent = CADState.state.activeTransformTool === toolName;
    CADState.setActiveTransformTool(isCurrent ? null : toolName);
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active-tool-btn'));
    if (!isCurrent) {
      const btn = document.getElementById(`toolbar-${toolName}`);
      btn?.classList.add('active-tool-btn');
      defaultAction();
    } else {
      windowUI.initActionPanel(); // clear if toggled off
    }
    windowViewport.render();
  };

  bindBtn('toolbar-move', () => {
    toggleTransformTool('move', () => {
      windowUI.openActionPanel('transform_move', 'Transform Move Tool', [
        { key: 'step', label: 'Move Step Distance', baseLabel: 'Move Step Distance', isLength: true, type: 'number', default: 25.4 },
        { key: 'axis', label: 'Move Axis', type: 'select', options: [{ value: 'x', text: 'X-Axis (+)' }, { value: 'y', text: 'Y-Axis (+)' }, { value: 'z', text: 'Z-Axis (+)' }], default: 'x' }
      ], { transformAction: 'move' });
    });
  });

  bindBtn('toolbar-rotate', () => {
    toggleTransformTool('rotate', () => {
      windowUI.openActionPanel('transform_rotate', 'Transform Rotate Tool', [
        { key: 'angle', label: 'Rotation Angle (°)', type: 'number', default: 15.0, step: 5 },
        { key: 'axis', label: 'Rotation Axis', type: 'select', options: [{ value: 'z', text: 'Z-Axis (View Plane)' }, { value: 'x', text: 'X-Axis' }, { value: 'y', text: 'Y-Axis' }], default: 'z' }
      ], { transformAction: 'rotate' });
    });
  });

  bindBtn('toolbar-scale', () => {
    toggleTransformTool('scale', () => {
      windowUI.openActionPanel('transform_scale', 'Transform Scale Tool', [
        { key: 'factor', label: 'Scale Multiplier Factor', type: 'number', default: 1.25, step: 0.05 }
      ], { transformAction: 'scale' });
    });
  });

  bindBtn('toolbar-duplicate', () => CADCommands.transform('duplicate'));

  bindBtn('toolbar-align', () => {
    windowUI.openActionPanel('align', 'Align Geometry', [
      { key: 'target', label: 'Alignment Plane', type: 'select', options: [{ value: 'ground', text: 'Align to Ground (Z=0)' }, { value: 'origin', text: 'Center at Origin (0,0,0)' }], default: 'ground' }
    ]);
  });

  // 4. DRAFT TOOLS
  const bindDraftTool = (id, toolName, label, extraFields = []) => {
    const btn = document.getElementById(id);
    btn?.addEventListener('click', (e) => {
      e.preventDefault();
      const isCurrent = CADState.state.activeTool === toolName;
      if (isCurrent) {
        CADState.setActiveTool(null);
      } else {
        CADState.setActiveTool(toolName);
        const fields = [
          { key: 'depth', label: 'Extrusion Depth', baseLabel: 'Extrusion Depth', isLength: true, type: 'number', default: 25.4 },
          { key: 'outline', label: 'Draft Outline Perimeter Only', type: 'checkbox', default: false },
          { key: 'shell', label: 'Hollow Shell Extrusion', type: 'checkbox', default: false },
          { key: 'shell_thickness', label: 'Shell Wall Thickness', baseLabel: 'Shell Wall Thickness', isLength: true, type: 'number', default: 5.0 },
          ...extraFields
        ];
        windowUI.openActionPanel('draft', `Draft ${label}`, fields);
      }
    });
  };

  bindDraftTool('btn-draft-line', 'line', 'Line');
  bindDraftTool('btn-draft-rect', 'rect', 'Rectangle');
  bindDraftTool('btn-draft-circle', 'circle', 'Circle', [
    { key: 'radius', label: 'Radius', baseLabel: 'Radius', isLength: true, type: 'number', default: 152.4 },
    { key: 'cx', label: 'Center X', baseLabel: 'Center X', isLength: true, type: 'number', default: 0.0 },
    { key: 'cy', label: 'Center Y', baseLabel: 'Center Y', isLength: true, type: 'number', default: 0.0 },
    { key: 'cz', label: 'Center Z', baseLabel: 'Center Z', isLength: true, type: 'number', default: 0.0 }
  ]);
  bindDraftTool('btn-draft-arc', 'arc', 'Arc', [
    { key: 'start_angle', label: 'Start Angle (°)', type: 'number', default: 0.0 },
    { key: 'end_angle', label: 'End Angle (°)', type: 'number', default: 180.0 }
  ]);
  bindDraftTool('btn-draft-polyline', 'polyline', 'P-Line');
  bindDraftTool('btn-draft-polygon', 'polygon', 'PolyDraft', [
    { key: 'sides', label: 'Side(s) Number (N)', type: 'number', default: 5, step: 1 }
  ]);
  bindDraftTool('btn-draft-ellipse', 'ellipse', 'EllipseDraft', [
    { key: 'radius_x', label: 'Radius X', baseLabel: 'Radius X', isLength: true, type: 'number', default: 152.4 },
    { key: 'radius_y', label: 'Radius Y', baseLabel: 'Radius Y', isLength: true, type: 'number', default: 76.2 },
    { key: 'cx', label: 'Center X', baseLabel: 'Center X', isLength: true, type: 'number', default: 0.0 },
    { key: 'cy', label: 'Center Y', baseLabel: 'Center Y', isLength: true, type: 'number', default: 0.0 },
    { key: 'cz', label: 'Center Z', baseLabel: 'Center Z', isLength: true, type: 'number', default: 0.0 }
  ]);

  // 5. CSNAP BUTTON
  bindBtn('btn-toggle-csnap', () => {
    CADState.toggleCsnap();
    const enabled = CADState.state.preferences.csnap !== false;
    windowUI.logServerEvent(`[CSNAP] Object entity edge/midpoint snap ${enabled ? 'ENABLED' : 'DISABLED'}`);
    windowViewport.render();
  });

  // 6. SELECTION MODE (Part, Face, Edge, Vertex)
  document.querySelectorAll('.sel-mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const mode = btn.dataset.mode;
      CADState.setSelectionMode(mode);
      windowUI.logServerEvent(`[SELECTION MODE] Activated: ${mode.toUpperCase()}`);
      windowViewport.render();
    });
  });

  // 7. FEATURES TOOLBAR
  bindBtn('btn-feat-extrude', () => {
    windowUI.openActionPanel('extrude', 'Extrude Solid Feature', [
      { key: 'distance', label: 'Extrusion Distance', baseLabel: 'Extrusion Distance', isLength: true, type: 'number', default: 304.8, step: 10 },
      { key: 'axis', label: 'Direction Axis', type: 'select', options: [{ value: 'Z', text: 'Z-Axis' }, { value: 'Y', text: 'Y-Axis' }, { value: 'X', text: 'X-Axis' }], default: 'Z' },
      { key: 'shell', label: 'Hollow Shell Solid', type: 'checkbox', default: false },
      { key: 'shell_thickness', label: 'Shell Wall Thickness', baseLabel: 'Shell Wall Thickness', isLength: true, type: 'number', default: 5.0 }
    ]);
  });

  bindBtn('btn-feat-cross-sections', () => {
    windowUI.openActionPanel('cross-sections', 'Cross-Sectional Cutout Planes', [
      { key: 'plane', label: 'Reference Plane', type: 'select', options: [{ value: 'XY', text: 'XY Plane' }, { value: 'XZ', text: 'XZ Plane' }, { value: 'YZ', text: 'YZ Plane' }], default: 'XY' },
      { key: 'count', label: 'Number of Planes', type: 'number', default: 3 },
      { key: 'spacing', label: 'Slice Spacing', baseLabel: 'Slice Spacing', isLength: true, type: 'number', default: 60.0 },
      { key: 'thickness', label: 'Slice Thickness', baseLabel: 'Slice Thickness', isLength: true, type: 'number', default: 12.0 }
    ]);
  });

  bindBtn('btn-feat-hole', () => {
    windowUI.openActionPanel('hole', 'Drilled Hole Feature', [
      { key: 'diameter', label: 'Hole Diameter', baseLabel: 'Hole Diameter', isLength: true, type: 'number', default: 50.8 },
      { key: 'depth', label: 'Drill Depth', baseLabel: 'Drill Depth', isLength: true, type: 'number', default: 304.8 }
    ]);
  });

  bindBtn('btn-feat-revolve', () => {
    windowUI.openActionPanel('revolve', 'Revolve Profile', [
      { key: 'angle', label: 'Revolution Angle (°)', type: 'number', default: 360 }
    ]);
  });

  // 8. MODIFY TOOLBAR
  bindBtn('btn-mod-fillet', () => {
    windowUI.openActionPanel('fillet', 'Edge Fillet', [
      { key: 'radius', label: 'Fillet Radius', baseLabel: 'Fillet Radius', isLength: true, type: 'number', default: 12.7 }
    ]);
  });

  bindBtn('btn-mod-chamfer', () => {
    windowUI.openActionPanel('chamfer', 'Edge Chamfer', [
      { key: 'distance', label: 'Chamfer Distance', baseLabel: 'Chamfer Distance', isLength: true, type: 'number', default: 12.7 }
    ]);
  });

  // 9. BOOLEAN TOOLBAR
  bindBtn('btn-bool-union', () => CADCommands.booleanOp('union'));
  bindBtn('btn-bool-sub', () => CADCommands.booleanOp('subtract'));
  bindBtn('btn-bool-intersect', () => CADCommands.booleanOp('intersect'));

  // 10. INSPECT & CNC TOOLBAR
  bindBtn('btn-insp-measure', async () => {
    const sel = CADState.getSelectedObject();
    if (!sel) {
      alert('Select a part, face, edge, or vertex first.');
      return;
    }
    const bb = sel.bounding_box || {};
    const dims = [
      Math.abs((bb.max?.[0] ?? 0) - (bb.min?.[0] ?? 0)),
      Math.abs((bb.max?.[1] ?? 0) - (bb.min?.[1] ?? 0)),
      Math.abs((bb.max?.[2] ?? 0) - (bb.min?.[2] ?? 0))
    ];
    const isImp = CADState.isImperial();
    const unitStr = isImp ? 'in' : 'mm';
    const scaleFactor = isImp ? (1.0 / 25.4) : 1.0;
    const formattedDims = dims.map(v => (v * scaleFactor).toFixed(3)).join(' × ');
    const volDisplay = (Number(sel.volume_cm3) || 0).toFixed(2);
    
    alert(`MEASURE\n${sel.name}\nBounding size: ${formattedDims} ${unitStr}\nVolume: ${volDisplay} cm³`);
  });

  bindBtn('btn-insp-mass', () => {
    const sel = CADState.getSelectedObject();
    if (!sel) {
      alert('Select a part first.');
      return;
    }
    const mass = Number(sel.mass_grams) || 0;
    const vol = Number(sel.volume_cm3) || 0;
    const modal = document.getElementById('mass-props-modal');
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    set('mass-val-vol', `${vol.toFixed(2)} cm³`);
    set('mass-val-g', `${mass.toFixed(2)} g`);
    set('mass-val-kg', `${(mass / 1000).toFixed(4)} kg`);
    set('mass-val-lbs', `${(mass / 453.59237).toFixed(4)} lb`);
    const title = document.getElementById('mass-props-title');
    if (title) title.textContent = `Mass Properties — ${sel.name}`;
    modal?.classList.remove('hidden');
  });

  bindBtn('btn-close-mass-props', () => {
    const modal = document.getElementById('mass-props-modal');
    modal?.classList.add('hidden');
  });

  bindBtn('btn-tool-cnc', () => windowUI.openCncModal());
  bindBtn('btn-tool-script', () => windowUI.openScriptModal());
});
