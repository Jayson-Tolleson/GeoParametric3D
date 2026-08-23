"use strict";

/*
 * GeoParametric3D API Client
 *
 * PUBLIC DEPLOYMENT:
 *     /cad/
 *
 * CANONICAL API:
 *     /cad/api/
 *
 * LEGACY API:
 *     /GeoParametric3D/api/
 */

class APIClient {
  constructor() {
    const path = window.location.pathname || '/';
    this.baseUrl = path.startsWith('/GeoParametric3D')
      ? '/GeoParametric3D/api'
      : '/cad/api';

    console.info('[GeoParametric3D API] baseUrl:', this.baseUrl);
  }

  async requestJSON(path, options = {}) {
    const url = `${this.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...(options.body instanceof FormData
            ? {}
            : { 'Content-Type': 'application/json' }),
          ...(options.headers || {})
        }
      });

      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();

      if (!response.ok) {
        const preview = text.slice(0, 1000);
        console.error('[GeoParametric3D API] HTTP failure', {
          status: response.status,
          statusText: response.statusText,
          url,
          contentType,
          response: preview
        });

        return {
          ok: false,
          success: false,
          error: `HTTP ${response.status} ${response.statusText} from ${url}`,
          status: response.status,
          url,
          content_type: contentType,
          response_text: preview
        };
      }

      if (!text.trim()) {
        console.error('[GeoParametric3D API] Empty response', {
          url,
          status: response.status
        });

        return {
          ok: false,
          success: false,
          error: `Empty response from ${url}`,
          status: response.status,
          url,
          content_type: contentType
        };
      }

      try {
        return JSON.parse(text);
      } catch (parseError) {
        console.error('[GeoParametric3D API] Non-JSON response', {
          url,
          status: response.status,
          contentType,
          parseError: parseError.message,
          response: text.slice(0, 2000)
        });

        return {
          ok: false,
          success: false,
          error: `Expected JSON from ${url}, received ${contentType || 'unknown content type'}`,
          status: response.status,
          url,
          content_type: contentType,
          response_text: text.slice(0, 2000)
        };
      }
    } catch (err) {
      console.error(`[GeoParametric3D API] Network error (${url}):`, err);
      return {
        ok: false,
        success: false,
        error: err.message,
        url
      };
    }
  }

  async sendCommand(command, parameters = {}) {
    return this.requestJSON('/command', {
      method: 'POST',
      body: JSON.stringify({ command, parameters })
    });
  }

  async newProject() {
    return this.requestJSON('/project/new', {
      method: 'POST'
    });
  }

  async saveProject(projectId, documentState = null) {
    return this.requestJSON('/project/save', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        document: documentState
      })
    });
  }

  async loadProject(projectId) {
    return this.requestJSON(`/project/load/${encodeURIComponent(projectId)}`);
  }

  async transformManifest(manifestId, delta) {
    return this.requestJSON('/manifest/transform', {
      method: 'POST',
      body: JSON.stringify({
        manifest_id: manifestId,
        delta
      })
    });
  }

  async updateManifestProperties(manifestId, property, values) {
    return this.requestJSON('/manifest/properties', {
      method: 'POST',
      body: JSON.stringify({
        manifest_id: manifestId,
        property,
        values
      })
    });
  }

  async toggleHideManifest(manifestId) {
    return this.requestJSON('/manifest/hide', {
      method: 'POST',
      body: JSON.stringify({
        manifest_id: manifestId
      })
    });
  }

  async deleteManifest(manifestId) {
    return this.requestJSON('/manifest/delete', {
      method: 'POST',
      body: JSON.stringify({
        manifest_id: manifestId
      })
    });
  }

  async instantiatePrimitive(primitiveType, parameters = {}) {
    return this.requestJSON('/geometry/instantiate', {
      method: 'POST',
      body: JSON.stringify({
        type: primitiveType,
        parameters
      })
    });
  }

  async selectAtPoint(params = {}) {
    return this.requestJSON('/geometry/select-at-point', {
      method: 'POST',
      body: JSON.stringify(params)
    });
  }

  async executeScript(script) {
    return this.requestJSON('/command', {
      method: 'POST',
      body: JSON.stringify({
        command: 'execute_script',
        parameters: { script }
      })
    });
  }

  async buildInstructions(userInput = '', extra = {}) {
    return this.requestJSON('/instructions/build', {
      method: 'POST',
      body: JSON.stringify({
        input: userInput,
        ...extra
      })
    });
  }

  async generateCnc(params = {}) {
    return this.requestJSON('/cnc/generate', {
      method: 'POST',
      body: JSON.stringify(params)
    });
  }

  async importBytes(file) {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${this.baseUrl}/import`, {
        method: 'POST',
        body: formData
      });

      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();

      if (!response.ok) {
        console.error('[GeoParametric3D API] Import HTTP failure', {
          status: response.status,
          url: `${this.baseUrl}/import`,
          contentType,
          response: text.slice(0, 2000)
        });

        return {
          ok: false,
          success: false,
          error: `HTTP ${response.status} ${response.statusText}`,
          status: response.status,
          response_text: text.slice(0, 2000)
        };
      }

      try {
        return JSON.parse(text);
      } catch {
        return {
          ok: false,
          success: false,
          error: 'Import endpoint returned non-JSON data',
          response_text: text.slice(0, 2000)
        };
      }
    } catch (err) {
      console.error('[GeoParametric3D API] Import Error:', err);
      return {
        ok: false,
        success: false,
        error: err.message
      };
    }
  }

  async fetchTelemetry() {
    return this.requestJSON('/telemetry');
  }

  async fetchSite() {
    return this.requestJSON('/site');
  }

  async sendAssistantPrompt(message) {
    return this.requestJSON('/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({ message })
    });
  }

  async exportModel(format = 'xbf') {
    const res = await this.sendCommand('export', { format });
    if (res && (res.ok || res.success) && res.content_base64) {
      let blob;
      const fmt = (res.format || format).toLowerCase();
      if (fmt === 'step' || fmt === 'stp') {
        blob = new Blob([res.content_base64], { type: 'text/plain;charset=utf-8' });
      } else {
        const binaryString = atob(res.content_base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        blob = new Blob([bytes], { type: 'application/octet-stream' });
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `model_export_${Date.now()}.${fmt}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { ok: true, success: true, filename: a.download };
    }
    return res;
  }

  async fetchGeometryBinary(objectId = null, forceRefresh = false) {
    const cacheKey = objectId || '__default__';
    if (!forceRefresh && window.CADState && typeof window.CADState.getBuffer === 'function') {
      const cachedBuffer = window.CADState.getBuffer(cacheKey);
      if (cachedBuffer && cachedBuffer.byteLength >= 8) {
        const headerView = new Uint32Array(cachedBuffer, 0, 2);
        const vertexCount = headerView[0];
        const indexCount = headerView[1];
        const posByteOffset = 8;
        const posByteLength = vertexCount * 3 * 4;
        const idxByteOffset = posByteOffset + posByteLength;

        const positions = new Float32Array(cachedBuffer, posByteOffset, vertexCount * 3);
        const indices = new Uint32Array(cachedBuffer, idxByteOffset, indexCount);

        return {
          ok: true,
          vertexCount,
          indexCount,
          positions,
          indices,
          arrayBuffer: cachedBuffer,
          fromCache: true
        };
      }
    }

    const url = `${this.baseUrl}/geometry/binary${objectId ? `?id=${encodeURIComponent(objectId)}` : ''}`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status} from ${url}` };
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength < 8) {
        return { ok: false, error: 'Binary buffer underflow' };
      }

      if (window.CADState && typeof window.CADState.setBuffer === 'function') {
        window.CADState.setBuffer(cacheKey, buffer);
      }

      const headerView = new Uint32Array(buffer, 0, 2);
      const vertexCount = headerView[0];
      const indexCount = headerView[1];
      const posByteOffset = 8;
      const posByteLength = vertexCount * 3 * 4;
      const idxByteOffset = posByteOffset + posByteLength;
      
      const positions = new Float32Array(buffer, posByteOffset, vertexCount * 3);
      const indices = new Uint32Array(buffer, idxByteOffset, indexCount);

      return {
        ok: true,
        vertexCount,
        indexCount,
        positions,
        indices,
        arrayBuffer: buffer,
        fromCache: false
      };
    } catch (err) {
      console.error('[API] fetchGeometryBinary error:', err);
      return { ok: false, error: err.message };
    }
  }
}

export const CADApi = new APIClient();
window.CADApi = CADApi;
