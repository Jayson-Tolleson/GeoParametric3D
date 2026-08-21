"use strict";

import { CADState, enuToGeodetic } from './state.js';
import { CADCommands } from './commands.js';
import { CADApi } from './api.js';
import { windowViewport } from './viewport.js';

export function fitCameraToModel(options = {}) {
  const map3d = document.getElementById('map-3d-element') || document.querySelector('gmp-map-3d');
  const bounds = windowViewport ? windowViewport.computeSceneBoundingBox() : null;
  if (!bounds) return;

  // Calculate bounding box maximum dimension
  const maxDim = bounds.maxDimension || bounds.diagonal || 304.8;
  const fov = (CADState.state.camera && CADState.state.camera.fov) || 45;
  // Dynamic distance based on 30:1 viewport-to-part ratio (30 * R where R = maxDim / 2, 3x larger framing ratio)
  const R = bounds.radius || (maxDim / 2.0);
  const fitDistanceMm = Math.max(76.2, 30.0 * R);
  const fitDistanceMeters = fitDistanceMm / 1000.0;
  const targetRangeMeters = Math.max(0.001, Math.min(1000000, fitDistanceMeters));

  const cx = bounds.center[0], cy = bounds.center[1], cz = bounds.center[2];
  const geoCenter = enuToGeodetic(cx, cy, cz);

  const heading = typeof options.heading === 'number' ? options.heading : (CADState.state.camera.heading || 30);
  const tilt = typeof options.tilt === 'number' ? options.tilt : (CADState.state.camera.tilt || 65);
  const roll = 0;

  // Unlock camera frustum and projection settings if Three.js/Perspective camera is active
  if (window.camera) {
    window.camera.near = 0.001;
    window.camera.far = 1000000;
    if (typeof window.camera.updateProjectionMatrix === 'function') {
      window.camera.updateProjectionMatrix();
    }
  }

  // Override camera controller zoom clamps
  if (window.controls) {
    window.controls.minDistance = 0.001;
    window.controls.maxDistance = 1000000;
  }

  CADState.state.camera.center = geoCenter;
  CADState.state.camera.heading = heading;
  CADState.state.camera.tilt = tilt;
  CADState.state.camera.range = targetRangeMeters * 1000.0;
  CADState.state.camera.panX = 0;
  CADState.state.camera.panY = 0;
  CADState.state.camera.target = [cx, cy, cz];
  CADState.state.camera.near = 0.001;
  CADState.state.camera.far = 1000000;
  CADState.state.camera.minDistance = 0.001;
  CADState.state.camera.maxDistance = 1000000;

  if (map3d) {
    map3d.setAttribute('min-altitude', '0');
    map3d.setAttribute('max-altitude', '1000000000');
    map3d.setAttribute('min-distance', '0.001');
    map3d.setAttribute('max-distance', '1000000');

    const centerObj = {
      lat: geoCenter.lat,
      lng: geoCenter.lng,
      altitude: geoCenter.altitude
    };

    if (typeof map3d.flyCameraTo === 'function' && !options.immediate) {
      try {
        map3d.flyCameraTo({
          endCamera: {
            center: centerObj,
            heading,
            tilt,
            range: targetRangeMeters,
            roll
          },
          durationMillis: 1000
        });
      } catch (e) {
        map3d.center = centerObj;
        map3d.heading = heading;
        map3d.tilt = tilt;
        map3d.range = targetRangeMeters;
      }
    } else {
      map3d.setAttribute('center', `${geoCenter.lat},${geoCenter.lng},${geoCenter.altitude}`);
      map3d.setAttribute('heading', String(heading));
      map3d.setAttribute('tilt', String(tilt));
      map3d.setAttribute('range', String(targetRangeMeters));
    }
  }

  if (windowViewport) {
    if (windowViewport.trackball) {
      windowViewport.trackball.updateFromCamera(heading, tilt);
    }
    windowViewport.render();
  }
  CADState.notify();
}

window.fitCameraToModel = fitCameraToModel;

document.addEventListener('DOMContentLoaded', async () => {
  console.log('CascadeCAD 12-Inch Workstation Bootstrapping...');

  const map3d = document.getElementById('map-3d-element') || document.querySelector('gmp-map-3d');
  if (map3d) {
    map3d.setAttribute('min-altitude', '0');
    map3d.setAttribute('max-altitude', '1000000000');
  }

  document.querySelectorAll('.preset-chip[data-dir="fit"]').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fitCameraToModel();
    });
  });

  try {
    const savedUuid = localStorage.getItem('cascadecad-active-uuid');
    if (savedUuid) {
      const res = await CADApi.loadProject(savedUuid);
      if (res?.success && res?.document) {
        CADState.setDocument(res.document);
        fitCameraToModel({ immediate: true });
      } else {
        await CADCommands.newDocument();
        fitCameraToModel({ immediate: true });
      }
    } else {
      const res = await CADApi.newProject();
      if (res?.document) {
        CADState.setDocument(res.document);
        fitCameraToModel({ immediate: true });
      }
    }

    const telemetry = await CADApi.fetchTelemetry();
    if (telemetry) {
      CADState.state.telemetry.fps = telemetry.fps ?? 60;
    }
  } catch (error) {
    console.error('[Bootstrap Error]', error);
  }
});
