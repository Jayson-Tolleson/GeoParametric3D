# GeoParametric3D: High-Precision Geodetic CAD Architecture & Dual-Route B-Rep Visualization Specification

## 1. Executive Summary

GeoParametric3D is an engineering-grade, web-native Computer-Aided Design (CAD) and Computer-Aided Manufacturing (CAM) workstation designed to bridge analytical Boundary Representation (B-Rep) solid modeling with photorealistic geodetic digital twins. Built atop Open CASCADE Technology (OCCT/OCP), WebAssembly, and the Google Maps 3D Web Component (`<gmp-map-3d>`), GeoParametric3D enforces a strict separation between **authoritative geometric truth** and **derived visual representations**.

### 1.1 Core Architectural Tenets
* **B-Rep Primacy:** The mathematical entity model (`GeoAssembly`, `GeoPart`, `GeoSolid`, `GeoShell`, `GeoFace`, `GeoLoop`, `GeoEdge`, `GeoVertex`) is the single source of truth. Triangulated meshes are ephemeral client artifacts.
* **Canonical Internal Scale:** All linear dimensions are normalized to millimeters ($\text{mm}$) within the numerical kernel, while client viewports seamlessly present Imperial ($12''\text{ / }1\text{ ft}$) and Metric ($304.8\text{ mm}$) projections.
* **Geodetic Anchoring:** Local Tangent Plane (ENU) Cartesian CAD coordinates are mapped to WGS84 Geodetic ellipsoidal coordinates anchored at Fullerton, California ($\text{Lat: } 33.8704^\circ\text{ N}, \text{ Lng: } -117.9242^\circ\text{ W}, \text{ Alt: } 1609.34\text{ m}$ / $1\text{ mile}$ AGL).
* **Dual-Route Rendering:** Planar topological faces (`GeomAbs_Plane`) bypass destructive tessellation and render directly as native 3D vector polygons (`<gmp-polygon-3d>`) with zero internal diagonals. Curved analytical topologies undergo curvature-adaptive chordal deflection.
* **Hardware Depth & Shading Parity:** 100% opaque solid shading with native depth buffer occlusion matching industrial workstations (FreeCAD, OpenCASCADE Inspector).

| Specification Metric | Canonical Standard | Target Tolerance |
| :--- | :--- | :--- |
| Internal Working Unit | Linear Millimeter ($\text{mm}$) | $\epsilon_{\text{pos}} = 10^{-6}\text{ mm}$ |
| Angular Resolution | Radians ($\text{rad}$) / Degrees ($^\circ$) | $\epsilon_{\text{norm}} = 10^{-6}$ |
| Geodetic Anchor | Fullerton, CA ($33.8704^\circ\text{ N}, -117.9242^\circ\text{ W}, 1609.34\text{ m}$) | WGS84 Ellipsoidal |
| Primary Shading Model | 100% Opaque Solid (RGB / Hex Metadata) | Zero Translucency (Alpha = 1.0) |
| Target Refresh Cadence | 60 FPS under continuous orbit/pan | $< 16.6\text{ ms}$ Frame Budget |

---

## 2. Viewport & Grid Assembly

```
                       +-------------------------------------------------------+
                       |              <gmp-map-3d> Viewport Host              |
                       +---------------------------+---------------------------+
                                                   |
                         +-------------------------+-------------------------+
                         |                                                   |
                         v                                                   v
        +---------------------------------+                 +---------------------------------+
        |    Vector 3D Geometry Layer     |                 |    Dynamic Canvas / WebGL Layer |
        |  \u2022 <gmp-polygon-3d> (Planar)     |                 |  \u2022 2,000-ft Horizon Grid (1-ft)  |
        |  \u2022 <gmp-polyline-3d> (Wires)     |                 |  \u2022 XYZ Datum Origin Axes         |
        |  \u2022 <gmp-marker-3d> (Vertices)    |                 |  \u2022 CSnap Bearing Indicators     |
        |  \u2022 altitude-mode="absolute"        |                 |  \u2022 Trackball Spherical Gizmo    |
        +---------------------------------+                 +---------------------------------+
```

### 2.1 Coordinate Transformation: ENU to WGS84 Geodetic
The mapping pipeline projects local Cartesian offsets $(x, y, z)_{\text{mm}}$ relative to the local reference point $(\phi_0, \lambda_0, h_0)$ into WGS84 curvilinear coordinates $(\phi, \lambda, h)$ using the local radii of curvature in the meridian ($M$) and prime vertical ($N$):

$$a = 6378137.0\text{ m}, \quad e^2 = 0.00669437999014$$

$$N(\phi_0) = \frac{a}{\sqrt{1 - e^2 \sin^2 \phi_0}}, \quad M(\phi_0) = \frac{a(1 - e^2)}{(1 - e^2 \sin^2 \phi_0)^{3/2}}$$

$$\phi = \phi_0 + \left(\frac{y \cdot 10^{-3}}{M(\phi_0) + h_0}\right) \cdot \frac{180}{\pi}, \quad \lambda = \lambda_0 + \left(\frac{x \cdot 10^{-3}}{(N(\phi_0) + h_0) \cos \phi_0}\right) \cdot \frac{180}{\pi}, \quad h = h_0 + (z \cdot 10^{-3})$$

### 2.2 Native Polygon Injection Contract (`<gmp-polygon-3d>`)
Planar boundary loops are injected into the Google Maps 3D DOM with strict topological closure rules:
* **Loop Closure:** Outer and inner loops must satisfy $|p_0 - p_{n-1}| < 10^{-7}$ degrees.
* **Coordinate Format:** `[{ lat: float, lng: float, altitude: float }, ...]`
* **Altitude Mode:** `altitude-mode="absolute"` prevents terrain clipping and depth-fighting.
* **Material Properties:** `fillColor` uses full opaque RGB values (`#38bdf8`, `#3b82f6`); `strokeWidth = 1.5`; `drawsOccludedSegments = true`.

```javascript
// High-performance element pooling and DOM reconciliation
export function syncNativePolygons(map3dElement, objects) {
  const existing = new Map();
  map3dElement.querySelectorAll('gmp-polygon-3d').forEach(el => existing.set(el.dataset.key, el));

  objects.forEach(obj => {
    if (obj.visible === false) return;
    const polys = obj.planar_polygons || [];
    polys.forEach((poly, idx) => {
      const key = `ngon-${obj.id}-${poly.face_id || idx}`;
      let el = existing.get(key);
      if (!el) {
        el = document.createElement('gmp-polygon-3d');
        el.dataset.key = key;
        el.setAttribute('altitude-mode', 'absolute');
        el.altitudeMode = 'absolute';
        el.drawsOccludedSegments = true;
        map3dElement.appendChild(el);
      } else {
        existing.delete(key);
      }
      el.outerCoordinates = poly.outer_coordinates;
      if (poly.inner_coordinates?.length) el.innerCoordinates = poly.inner_coordinates;
      el.fillColor = poly.color || '#38bdf8';
      el.strokeColor = '#ffffff';
      el.strokeWidth = 1.5;
    });
  });
  existing.forEach(stale => stale.remove());
}
```

### 2.3 2,000-Foot Ground Grid & Adaptive Stride
The ground canvas renders an infinite reference horizon spanning $\pm 2,000\text{ ft}$ ($\pm 609,600\text{ mm}$) with $1\text{ ft}$ ($304.8\text{ mm}$) subdivisions. Frame rates are maintained via dynamic range-based stride scaling:

```javascript
// Adaptive grid stride calculation
const rangeMeters = cam.range / 1000.0;
let stride = 1;
if (rangeMeters > 500) stride = 50;
else if (rangeMeters > 150) stride = 20;
else if (rangeMeters > 50) stride = 5;
else if (rangeMeters > 20) stride = 2;
const stepMm = 304.8 * stride;
```

---

## 3. Kernel & B-Rep Translation

```
             +-------------------------------------------------------+
             |             Input Payload (STEP / IGES / XBF)         |
             +---------------------------+---------------------------+
                                         |
                                         v
             +-------------------------------------------------------+
             |       SI_UNIT & CONVERSION_BASED_UNIT Resolver        |
             |       Linear Scale Factor Normalization -> mm         |
             +---------------------------+---------------------------+
                                         |
                                         v
             +-------------------------------------------------------+
             |            OCCT / OCP Topology Traversal              |
             |  TopoDS_Compound -> TopoDS_Solid -> TopoDS_Face      |
             +---------------------------+---------------------------+
                                         |
                       +-----------------+-----------------+
                       |                                   |
                       v                                   v
    +-------------------------------------+  +-------------------------------------+
    |        Route A: GeomAbs_Plane       |  |      Route B: Analytical / NURBS    |
    |  \u2022 BRepTools_WireExplorer Loops       |  |  \u2022 GCPnts_QuasiUniformDeflection   |
    |  \u2022 Zero-diagonal N-Gon extraction    |  |  \u2022 Dynamic Deflection Scaling     |
    |  \u2022 Inner void loop classification    |  |  \u2022 Watertight compact mesh         |
    +------------------+------------------+  +------------------+------------------+
                       |                                        |
                       +-------------------+--------------------+
                                           |
                                           v
             +-------------------------------------------------------+
             |      Vectorized Validation & Compaction Engine        |
             |  \u2022 Finite coordinate bounds checking [0, 1e10]     |
             |  \u2022 Zero-area face & degenerate edge filtering     |
             |  \u2022 Continuous vertex index remapping (int32)     |
             +-------------------------------------------------------+
```

### 3.1 Mathematical Formulation of Deflection
For curved analytical boundaries, the maximum permissible chordal deviation $\delta_{\text{lin}}$ and angular deflection $\theta_{\text{ang}}$ are dynamically scaled based on the solid's bounding box diagonal $D_{\text{solid}}$:

$$\delta_{\text{lin}} = \max\left(0.2\text{ mm}, \, D_{\text{solid}} \cdot 0.002\right), \quad \theta_{\text{ang}} = \begin{cases} 0.65\text{ rad} & D_{\text{solid}} > 5000\text{ mm} \\ 0.52\text{ rad} & D_{\text{solid}} > 1000\text{ mm} \\ 0.40\text{ rad} & D_{\text{solid}} \le 200\text{ mm} \end{cases}$$

### 3.2 Dual-Route Face Extraction Engine
```python
def route_cad_faces(shape, scale: float = 1.0, linear_deflection: float = 0.5):
    planar_faces, curved_faces = [], []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    idx = 0
    while explorer.More():
        idx += 1
        occ_face = TopoDS_Face_Cast(explorer.Current())
        adaptor = BRepAdaptor_Surface(occ_face)
        if adaptor.GetType() == GeomAbs_Plane:
            wires = extract_clean_planar_wires(occ_face, scale=scale, linear_deflection=linear_deflection)
            pln = adaptor.Plane()
            ax = pln.Axis().Direction()
            loc = pln.Location()
            planar_faces.append({
                "face_id": f"Face_Planar_{idx}",
                "surface_type": "Plane",
                "normal": [float(ax.X()), float(ax.Y()), float(ax.Z())],
                "origin": [float(loc.X() * scale), float(loc.Y() * scale), float(loc.Z() * scale)],
                "outer": wires["outer"],
                "inner": wires.get("inner", []),
                "has_holes": len(wires.get("inner", [])) > 0
            })
        else:
            curved_faces.append({
                "face_id": f"Face_Curved_{idx}",
                "surface_type": str(adaptor.GetType()),
                "occ_face": occ_face
            })
        explorer.Next()
    return planar_faces, curved_faces
```

### 3.3 Authoritative Entity Mapping
```python
# Canonical Class Hierarchy
GeoAssembly: { id: str, name: str, parts: Dict[str, GeoPart], instances: Dict[str, GeoInstance] }
GeoPart:     { id: str, solids: Dict[str, GeoSolid], shells: Dict[str, GeoShell], faces: Dict[str, GeoFace] }
GeoSolid:    { id: str, outer_shell_id: str, void_shell_ids: List[str] }
GeoShell:    { id: str, face_ids: List[str], is_closed: bool }
GeoFace:     { id: str, surface_id: str, outer_loop_id: str, inner_loop_ids: List[str] }
GeoLoop:     { id: str, ordered_edge_ids: List[str], is_outer: bool }
GeoEdge:     { id: str, vertex_start: str, vertex_end: str, curve_id: str }
GeoVertex:   { id: str, point: np.ndarray[3, float64] }
```

---

## 4. UI & Assistant Components

The GeoParametric3D workstation provides 79 structured tool controls, bidirectional tree-to-viewport inspection, and a Vertex AI Engineering Assistant connected via Google Cloud.

```
+---------------------------------------------------------------------------------------------------+
| TOP BAR: [Session (New, Open, Save, Import, Export, Undo, Redo)] [12" Primitives] [Transform] ... |
+-----------------------+---------------------------------------------------+-----------------------+
| LEFT PANEL            | VIEWPORT (<gmp-map-3d>)                           | RIGHT PANEL           |
| \u2022 Assembly Tree   | \u2022 Solid 100% Opaque <gmp-polygon-3d> Faces        | \u2022 Action Panel   |
| \u2022 Part Instances  | \u2022 2,000-ft Horizon Ground Grid (1-ft Mesh)    | \u2022 B-Rep Inspector|
| \u2022 Shells / Solids | \u2022 CSnap Disambiguation Overlay                | \u2022 Unit Converter |
| \u2022 Sub-Face Wires  | \u2022 Spherical Viridian/Neon View Gizmo         | \u2022 Sys Telemetry  |
+-----------------------+---------------------------------------------------+-----------------------+
| BOTTOM DOCK: Engineering AI Assistant (broadcasterfishmap / global) \u2014 LinuxCNC / G-Code Generator  |
+---------------------------------------------------------------------------------------------------+
```

### 4.1 Vertex AI Assistant Architecture
The Engineering Assistant connects directly to Google Cloud Vertex AI REST endpoints (`projects/broadcasterfishmap/locations/global/publishers/google/models/gemini-1.5-flash:generateContent`). The server injects full B-Rep topological and material state into each prompt context.

```python
# Server context injection in app.py
system_context = (
    f"You are the dedicated Engineering Assistant for GeoParametric3D (Project: {PROJECT_ID}, Location: {LOCATION}).\n"
    "Provide substantive, technically precise engineering reasoning, CAD/CAM/CAE guidance, "
    "B-Rep topological insight, material selection, and mathematical derivations.\n"
    "B-Rep geometry is authoritative; render meshes are derived representations."
)
```

### 4.2 CSnap Bearing Edge Disambiguation
The CSnap engine resolves ambiguous edge and midpoint selections under perspective projection by weighting distance with the face normal's alignment to the view vector:

$$\mathbf{v}_{\text{dir}} = \begin{bmatrix} -\sin\theta_{\text{hdg}}\cos\phi_{\text{tilt}} \\ -\cos\theta_{\text{hdg}}\cos\phi_{\text{tilt}} \\ -\sin\phi_{\text{tilt}} \end{bmatrix}, \quad W_{\text{snap}} = \frac{1}{d_{\text{screen}} + \epsilon} \cdot \left(|\mathbf{n}_{\text{face}} \cdot \mathbf{v}_{\text{dir}}| + 0.1\right)$$

---

## 5. System Telemetry & Quality Gates

The system includes automated telemetry monitoring, unit conversion verification, and headless regression quality gates.

```
+----------------------------------------------------------------------------------------+
|                               CI / TEST AUTOMATION GATES                              |
+----------------------------------------------------------------------------------------+
  |-- test_canonical_geometry.py   --> B-Rep entity validation & LOD render mesh extraction
  |-- test_cad_architecture.py      --> Unit scaling, STEP AP214 parsing, NaN/Inf compaction
  |-- test_kernel_math.py          --> BoxSDF scalar field & exact Boolean math invariance
  |-- test_workstation_repair.py   --> Dimensionless scale invariance & XBF/FCStd roundtrips
```

### 5.1 Verification Test Matrix

| Test Suite | Scope | Acceptance Criteria |
| :--- | :--- | :--- |
| `test_canonical_geometry.py` | B-Rep Integrity | 8 Vertices, 12 Edges, 6 Loops, 6 Faces, 1 Shell, 1 Solid for Canonical Box |
| `test_cad_architecture.py` | Unit Scaling | $1.0\text{ in} \equiv 25.4\text{ mm}$, $1.0\text{ ft} \equiv 304.8\text{ mm}$, volumetric $d^3$ scaling verified |
| `test_kernel_math.py` | Scalar Fields & Booleans | Signed distance field matches analytical box boundary within $\pm 10^{-5}\text{ mm}$ |
| `test_workstation_repair.py` | Scale Invariance | Scaling multiplier never mutates world translation vector $(\mathbf{p}_{\text{after}} \equiv \mathbf{p}_{\text{before}})$ |
| `universal_byte_parser.py` | Binary STL Scaling | $50,000$ raw triangles ingested and compacted in $< 1.5\text{ seconds}$ |

### 5.2 Telemetry API Contract (`/cad/api/telemetry`)
```json
{
  "success": true,
  "system": "GeoParametric3D Workstation",
  "version": "10.0.0-PROD",
  "objects": 1,
  "vertices": 24,
  "fps": 60,
  "status": "READY",
  "canonical_unit": "mm",
  "geodetic_origin": {
    "name": "Fullerton Geodetic Anchor",
    "lat": 33.8704,
    "lng": -117.9242,
    "altitude": 1609.34
  },
  "grid": {
    "mesh_spacing": "1 ft (304.8 mm)",
    "max_extent": "2000 ft (609600 mm)"
  },
  "shading": {
    "mode": "100% Opaque Solid",
    "default_opacity": 1.0
  },
  "vertex_ai": {
    "enabled": true,
    "project_id": "broadcasterfishmap",
    "location": "global",
    "model": "gemini-1.5-flash"
  }
}
```
