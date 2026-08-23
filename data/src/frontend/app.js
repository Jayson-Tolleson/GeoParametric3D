import { CADState } from './cad_state.js';
import { Map3DViewportRenderer } from './map3d_renderer.js';
import { UIController } from './ui_controller.js';

// Earth constants for ENU (East-North-Up in mm) to WGS84 Geodetic conversion
const SITE_ANCHOR = { lat: 33.881400, lng: -117.921300, altitude: 95.0 };
const METERS_PER_LAT = 111132.954;
const METERS_PER_LNG = 111412.877 * Math.cos(SITE_ANCHOR.lat * Math.PI / 180);

function enuMmToWgs84(coordsMm) {
  return coordsMm.map(pt => {
    const dx_m = (pt[0] || 0) / 1000.0;
    const dy_m = (pt[1] || 0) / 1000.0;
    const dz_m = (pt[2] || 0) / 1000.0;
    return {
      lat: SITE_ANCHOR.lat + (dy_m / METERS_PER_LAT),
      lng: SITE_ANCHOR.lng + (dx_m / METERS_PER_LNG),
      altitude: SITE_ANCHOR.altitude + dz_m
    };
  });
}

function createFallbackDemo() {
  const outer_flange_mm = [
    [-821.109, -254.0, 0.0],
    [821.109, -254.0, 0.0],
    [821.109, 254.0, 0.0],
    [-821.109, 254.0, 0.0]
  ];
  const void_intake_mm = [
    [-700.0, -180.0, 0.0],
    [700.0, -180.0, 0.0],
    [700.0, 180.0, 0.0],
    [-700.0, 180.0, 0.0]
  ];
  const l_outer_mm = [
    [0.0, 0.0, 50.0],
    [100.0, 0.0, 50.0],
    [100.0, 20.0, 50.0],
    [20.0, 20.0, 50.0],
    [20.0, 100.0, 50.0],
    [0.0, 100.0, 50.0]
  ];

  return {
    success: true,
    filename: 'jetdrive_collector.step',
    units: { source: 'mm', canonical: 'mm', scale: 1.0 },
    extracted_colors: ['#34d399', '#ec4899'],
    total_solids: 2,
    solids: [
      {
        solid_id: 'solid_collector_01',
        name: 'Collector',
        color: '#34d399',
        bounding_box: {
          min: [-821.109, -254.0, 0.0],
          max: [821.109, 254.0, 414.337],
          dimensions_mm: [1642.218, 508.0, 414.337],
          diagonal_mm: Math.sqrt(1642.218**2 + 508.0**2 + 414.337**2)
        },
        deflection: { linear_mm: 1.2, angular_rad: 0.52 },
        planar_polygons: [
          {
            face_id: 'Face_Collector_Flange_Top',
            solid_id: 'solid_collector_01',
            solid_name: 'Collector',
            surface_type: 'GeomAbs_Plane',
            outer_coordinates: enuMmToWgs84(outer_flange_mm),
            inner_coordinates: [enuMmToWgs84(void_intake_mm)],
            raw_outer_mm: outer_flange_mm,
            vertex_count: 4,
            holes_count: 1,
            color: '#34d399'
          }
        ],
        curved_mesh: { vertices: [], indices: [], tri_count: 0 }
      },
      {
        solid_id: 'solid_part_56',
        name: 'jetdrive - Part 56',
        color: '#ec4899',
        bounding_box: {
          min: [0.0, 0.0, 50.0],
          max: [100.0, 100.0, 70.0],
          dimensions_mm: [100.0, 100.0, 20.0],
          diagonal_mm: Math.sqrt(100.0**2 + 100.0**2 + 20.0**2)
        },
        deflection: { linear_mm: 0.2, angular_rad: 0.40 },
        planar_polygons: [
          {
            face_id: 'Face_L_Flange_Mount_56',
            solid_id: 'solid_part_56',
            solid_name: 'jetdrive - Part 56',
            surface_type: 'GeomAbs_Plane',
            outer_coordinates: enuMmToWgs84(l_outer_mm),
            inner_coordinates: [],
            raw_outer_mm: l_outer_mm,
            vertex_count: 6,
            holes_count: 0,
            color: '#ec4899'
          }
        ],
        curved_mesh: { vertices: [], indices: [], tri_count: 0 }
      }
    ],
    total_ngons: 2,
    total_triangles: 0,
    duration_ms: 45
  };
}

window.addEventListener('DOMContentLoaded', async () => {
  const map3dEl = document.querySelector('gmp-map-3d');
  const viewportRenderer = new Map3DViewportRenderer(map3dEl);
  const uiController = new UIController(viewportRenderer);

  try {
    const res = await fetch('/api/assembly/current');
    if (res.ok) {
      const assemblyData = await res.json();
      CADState.setAssembly(assemblyData);
    } else {
      CADState.setAssembly(createFallbackDemo());
    }
  } catch (err) {
    console.warn('Backend offline, running in standalone True N-Gon workstation mode.');
    CADState.setAssembly(createFallbackDemo());
  }
});
