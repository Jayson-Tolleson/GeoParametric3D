"use strict";

import { CADApi } from './api.js';
import { CADState } from './state.js';

const DEFAULT_12_INCH_MM = 304.8;

class CommandDispatcher {
  async execute(commandName, parameters = {}) {
    if (commandName === 'import') {
      const fileInput = document.getElementById('import-file-input');
      fileInput?.click();
      return;
    }

    if (commandName === 'export') {
      return CADApi.exportModel(parameters.format || 'xbf');
    }

    const result = await CADApi.sendCommand(commandName, parameters);

    if (result && (result.ok || result.success)) {
      if (result.document) {
        CADState.setDocument(result.document);
      }
      const obj = result.cad_obj ?? result.object;
      if (obj) {
        CADState.setSelectedId(obj.manifest_id ?? obj.id ?? obj.object_id);
      }
      if (result.deleted_ids) {
        CADState.setSelectedId(null);
      }
      if (result.camera) {
        CADState.setCamera(result.camera);
      }
      return result;
    }

    const err = result?.error ?? 'Network error';
    console.error(`[Command Error] ${commandName}:`, err);
    window.uiController?.logServerEvent(`[CMD ERROR] ${commandName}: ${err}`);
    return result;
  }

  async createPrimitive(type, params = {}) {
    const defaultParams = {
      box: { width: DEFAULT_12_INCH_MM, depth: DEFAULT_12_INCH_MM, height: DEFAULT_12_INCH_MM },
      cylinder: { radius: DEFAULT_12_INCH_MM / 2, height: DEFAULT_12_INCH_MM, segments: 32 },
      sphere: { radius: DEFAULT_12_INCH_MM / 2, segments: 24 },
      cone: { radius: DEFAULT_12_INCH_MM / 2, height: DEFAULT_12_INCH_MM, segments: 32 },
      torus: { major_radius: DEFAULT_12_INCH_MM / 2, minor_radius: DEFAULT_12_INCH_MM / 6, segments: 24 },
      prism: { radius: DEFAULT_12_INCH_MM / 2, height: DEFAULT_12_INCH_MM, sides: 12 },
      polygon: { sides: 5, radius: DEFAULT_12_INCH_MM / 2, height: DEFAULT_12_INCH_MM * 0.5 },
      ellipse: { radius_x: DEFAULT_12_INCH_MM / 2, radius_y: DEFAULT_12_INCH_MM / 3, height: DEFAULT_12_INCH_MM * 0.5 },
      wedge: { width: DEFAULT_12_INCH_MM, depth: DEFAULT_12_INCH_MM, height: DEFAULT_12_INCH_MM * 0.8 },
      pyramid: { width: DEFAULT_12_INCH_MM, depth: DEFAULT_12_INCH_MM, height: DEFAULT_12_INCH_MM },
      ellipsoid: { radius_x: DEFAULT_12_INCH_MM / 2, radius_y: DEFAULT_12_INCH_MM / 3, radius_z: DEFAULT_12_INCH_MM / 4 },
      tube: { radius: DEFAULT_12_INCH_MM / 2, inner_radius: DEFAULT_12_INCH_MM / 3, height: DEFAULT_12_INCH_MM },
      plane: { width: DEFAULT_12_INCH_MM, depth: DEFAULT_12_INCH_MM, plane: 'xy' }
    };

    const shapeParams = { ...(defaultParams[type] ?? { width: DEFAULT_12_INCH_MM, depth: DEFAULT_12_INCH_MM, height: DEFAULT_12_INCH_MM }), ...params };

    let position = [0.0, 0.0, 0.0];
    if (params.cx !== undefined || params.cy !== undefined || params.cz !== undefined) {
      position = [
        params.cx ?? 0.0,
        params.cy ?? 0.0,
        params.cz ?? 0.0
      ];
      delete shapeParams.cx;
      delete shapeParams.cy;
      delete shapeParams.cz;
    } else if (params.position) {
      position = params.position;
    }

    return this.execute('create_primitive', {
      primitive: type,
      parameters: shapeParams,
      position
    });
  }

  async deleteSelected() {
    const { selectedIds } = CADState.state;
    if (!selectedIds || !selectedIds.length) return;
    const idsToDelete = [...selectedIds];
    idsToDelete.forEach(id => {
      CADState.removeObject(id);
      CADState.clearBuffer(id);
    });
    CADState.setSelectedId(null);
    if (window.uiController) {
      window.uiController.renderAssemblyTree();
      window.uiController.renderInspector();
      window.uiController.renderTelemetry();
    }
    if (window.CADViewport) {
      window.CADViewport.geometryCacheDirty = true;
      window.CADViewport.syncNativeDOM();
      window.CADViewport.render();
    }
    return this.execute('delete_object', { ids: idsToDelete });
  }

  async toggleSelectedVisibility() {
    const { selectedIds } = CADState.state;
    if (!selectedIds.length) return;
    return this.execute('toggle_visibility', { ids: selectedIds });
  }

  async undo() {
    return this.execute('undo');
  }

  async redo() {
    return this.execute('redo');
  }

  async setProperty(prop, value) {
    const sel = CADState.getSelectedObject();
    if (!sel) return;
    const id = sel.manifest_id ?? sel.id ?? sel.object_id;
    CADState.clearBuffer(id);
    return this.execute('set_property', { id, [prop]: value });
  }

  async transform(action, params = {}) {
    const sel = CADState.getSelectedObject();
    const id = params.target_id ?? (sel ? (sel.manifest_id ?? sel.id ?? sel.object_id) : null);
    return this.execute('transform_object', { id, action, ...params });
  }

  async booleanOp(operation) {
    const selectedIds = CADState.state.selectedIds ?? [];
    if (selectedIds.length < 2) {
      alert('Select two bodies for a boolean operation (Ctrl/Cmd-click the second body).');
      return;
    }
    const target = CADState.state.objects.find(o => (o.manifest_id ?? o.id ?? o.object_id) === selectedIds[0]);
    const tool = CADState.state.objects.find(o => (o.manifest_id ?? o.id ?? o.object_id) === selectedIds[1]);
    if (!target || !tool) return;

    return this.execute(`boolean_${operation}`, {
      target_id: target.manifest_id ?? target.id ?? target.object_id,
      tool_id: tool.manifest_id ?? tool.id ?? tool.object_id
    });
  }

  async cameraPreset(preset) {
    return this.execute(`camera_${preset}`);
  }

  async newDocument() {
    const res = await CADApi.newProject();
    if (res?.document) {
      CADState.setDocument(res.document);
      window.uiController?.logServerEvent(`[SESSION] Initialized new UUID workstation: ${res.project_id}`);
    }
    return res;
  }
}

export const CADCommands = new CommandDispatcher();
window.CADCommands = CADCommands;
