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
}

export const CADApi = new APIClient();
window.CADApi = CADApi;
