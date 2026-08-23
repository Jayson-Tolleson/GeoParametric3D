# GeoParametric3D: Systems Architecture & Engineering Specification

## 1. Executive Summary

### 1.1 Architectural Purpose & Paradigm
GeoParametric3D is a browser-native Computer-Aided Design (CAD) and boundary representation (B-Rep) solid modeling workstation. It is architected around an authoritative separation of mathematical truth from derived rendering artifacts. 

```
+---------------------------------------------------------------------------------------+
|                               AUTHORITATIVE B-REP KERNEL                              |
|   OpenCASCADE (OCCT / OCP) / CadQuery / Analytical Geometric Scalar Fields (BoxSDF)   |
|   GeoAssembly -> GeoInstance -> GeoPart -> GeoSolid -> GeoShell -> GeoFace -> GeoLoop  |
+-------------------------------------------+-------------------------------------------+
                                            |
                     +----------------------+----------------------+
                     | (GeomAbs_Plane)                             | (Analytic Curved / NURBS)
                     v                                             v
+------------------------------------------+  +------------------------------------------+
|       PLANAR N-GON EXTRACTION ROUTE      |  |       ADAPTIVE DEFLECTION TESSELLATOR    |
| - Continuous outer perimeter wires       |  | - Chordal tolerance: delta <= 0.05 mm     |
| - Genus-N inner cutout void boundaries   |  | - Angular deflection: theta <= 12.0 deg  |
| - Zero internal meshing diagonals        |  | - Watertight vertex-welded buffers       |
+--------------------+---------------------+  +--------------------+---------------------+
                     |                                             |
                     +----------------------+----------------------+
                                            |
                                            v
+---------------------------------------------------------------------------------------+
|                              GEOMETRY PIPELINE NORMALIZER                             |
| - Linear unit normalization to canonical millimeters (1.0 mm baseline)                 |
| - WGS84 Geodetic datum conversion relative to Fullerton Anchor (1609.34 m MSL)         |
| - Finite numeric verification, index remapping & degenerate facet elimination         |
+-------------------------------------------+-------------------------------------------+
                                            |
                     +----------------------+----------------------+
                     |                                             |
                     v                                             v
+------------------------------------------+  +------------------------------------------+
|      NATIVE GOOGLE MAPS 3D VIEWPORT      |  |       HYBRID 2D/3D OVERLAY CANVAS        |
| - <gmp-map-3d> host viewport element     |  | - Sub-element selection (V, E, F, Solid) |
| - <gmp-polygon-3d> 100% opaque solid N-G |  | - CSnap bearing edge & midpoint resolver |
| - Hardware Z-buffer depth occlusion      |  | - 2,000-ft adaptive ground datum grid    |
+------------------------------------------+  +------------------------------------------+
```

### 1.2 Invariant Architectural Axioms
1. **Source Geometry Independence:** The CAD topological definition is authoritative. Meshes and triangle arrays are ephemeral, derived representations.
2. **Canonical Internal Metric Units:** All internal spatial calculations are strictly executed in linear millimeters ($1\text{ mm} = 1.0$). User preferences (US Customary Inches/Feet) operate as a presentation-layer transform.
3. **Dual-Route Geometry Dispatch:** Planar surfaces are extracted as zero-diagonal polygonal boundary loops; non-planar analytical surfaces undergo curvature-adaptive deflection tessellation.
4. **Dimensionless Transform Isolation:** Transformation matrices ($\mathbf{T} \in \mathbb{SE}(3)$) and scale vectors ($\mathbf{S} \in \mathbb{R}^3$) are decoupled from primitive vertex definitions. Scale operations never alter global world coordinates.
5. **100% Opaque Solid Shading Parity:** Solid parts render with opaque fills ($\alpha = 1.0$) matching mechanical CAD platforms (e.g., FreeCAD, OpenCASCADE Inspector), preventing visual ambiguity caused by transparent face overlap.

---

## 2. Viewport & Grid Assembly

### 2.1 Geodetic Origin Anchor & Coordinate Transformation
To bridge local Cartesian engineering space (East-North-Up, ENU) with photorealistic planetary geospatial tiles, GeoParametric3D pins the datum origin to an elevated geodetic anchor.

| Parameter | Value | Description |
| :--- | :--- | :--- |
| **Datum Identifier** | `Fullerton Geodetic Anchor` | Primary geospatial datum reference |
| **Latitude ($\phi_0$)** | `33.8704° N` | Fullerton, California, USA (WGS84) |
| **Longitude ($\lambda_0$)** | `-117.9242° W` | WGS84 Reference Meridian Offset |
| **Altitude ($h_0$)** | `1609.34 m MSL` | Exactly 1.0 International Mile above Sea Level |
| **Vertical Reference** | `EGM96 / WGS84 Ellipsoid` | Prevents sub-surface tile clipping |

The closed-form transformation between local Cartesian millimeters $\mathbf{p}_{\text{cad}} = [x, y, z]^T$ and WGS84 geodetic coordinates $(\phi, \lambda, h)$ is evaluated via ellipsoidal radii of curvature:

$$\begin{aligned}
x_{\text{m}} &= \frac{x}{1000}, \quad y_{\text{m}} = \frac{y}{1000}, \quad z_{\text{m}} = \frac{z}{1000} \\
N(\phi_0) &= \frac{a}{\sqrt{1 - e^2 \sin^2(\phi_0)}}, \quad M(\phi_0) = \frac{a(1 - e^2)}{(1 - e^2 \sin^2(\phi_0))^{3/2}} \\
\phi &= \phi_0 + \left( \frac{y_{\text{m}}}{M(\phi_0) + h_0} \right) \cdot \frac{180^\circ}{\pi} \\
\lambda &= \lambda_0 + \left( \frac{x_{\text{m}}}{(N(\phi_0) + h_0) \cos(\phi_0)} \right) \cdot \frac{180^\circ}{\pi} \\
h &= h_0 + z_{\text{m}}
\end{aligned}$$

where $a = 6378137.0\text{ m}$ (WGS84 semi-major axis) and $e^2 = 0.00669437999014$ (first eccentricity squared).

### 2.2 Native `<gmp-map-3d>` Viewport & Polygon Lifecycle
The presentation layer couples the Google Maps 3D Web Component (`<gmp-map-3d>`) with dynamic `<gmp-polygon-3d>` elements.

```javascript
// Native DOM sync lifecycle for planar B-Rep faces
function syncNativePolygons(map3dElement, objects) {
  const polygonPool = new Map();
  map3dElement.querySelectorAll('gmp-polygon-3d').forEach(el => {
    polygonPool.set(el.dataset.key, el);
  });

  objects.forEach(obj => {
    if (obj.visible === false) return;
    const planarPolys = obj.planar_polygons || [];
    planarPolys.forEach((poly, idx) => {
      const key = `${obj.id}-${poly.face_id || idx}`;
      let el = polygonPool.get(key);
      if (!el) {
        el = document.createElement('gmp-polygon-3d');
        el.dataset.key = key;
        el.setAttribute('altitude-mode', 'absolute');
        el.altitudeMode = 'absolute';
        el.drawsOccludedSegments = true;
        map3dElement.appendChild(el);
      } else {
        polygonPool.delete(key);
      }
      el.outerCoordinates = poly.outer_coordinates;
      if (poly.inner_coordinates?.length) el.innerCoordinates = poly.inner_coordinates;
      el.fillColor = obj.color || '#38bdf8';
      el.strokeColor = '#ffffff';
      el.strokeWidth = 1.5;
    });
  });
  polygonPool.forEach(el => el.remove());
}
```

### 2.3 Extended Horizon Ground Grid
The CAD ground grid covers an operational envelope of $2{,}000\text{ ft} \times 2{,}000\text{ ft}$ ($609{,}600\text{ mm} \times 609{,}600\text{ mm}$) centered at $(0, 0, 0)$ with adaptive LOD stride rendering to maintain 60 FPS:

```
Camera Range (r)       Grid Stride (s)     Physical Spacing
-------------------------------------------------------------------
r > 500 m              50-ft (15,240 mm)   High-altitude overview
150 m < r <= 500 m     20-ft (6,096 mm)    Mid-range approach
50 m < r <= 150 m      5-ft  (1,524 mm)    Standard framing
r <= 50 m              1-ft  (304.8 mm)    Precision modeling
```

---

## 3. Kernel & B-Rep Translation

### 3.1 Canonical B-Rep Topological Hierarchy
The data schema enforces strict topological consistency through typed canonical entities:

```
GeoAssembly (Root)
  └── GeoInstance (SE(3) Transform, Material, Visual Attributes)
        └── GeoPart (Topological Body Container)
              └── GeoSolid (Manifold Solid Volume)
                    └── GeoShell (Oriented Outer/Void Surface Manifolds)
                          └── GeoFace (Parametric Surface Patch)
                                ├── GeoSurface (Analytic Geometry: Plane, Cylinder, Sphere, Torus)
                                ├── GeoLoop [Outer Bound] (Oriented Winding)
                                │     └── GeoEdge -> GeoCurve (Line, Circle, B-Spline)
                                └── GeoLoop [Inner Voids / Holes]
```

### 3.2 Dual-Route Face Extraction & Planar Boundary Dissolver
When consuming foreign STEP models, every `TopoDS_Face` is inspected using OpenCASCADE `BRepAdaptor_Surface`:

```python
def route_cad_faces(shape: TopoDS_Shape, scale: float = 1.0, linear_deflection: float = 0.5):
    planar_faces = []
    curved_faces = []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    
    while explorer.More():
        occ_face = TopoDS_Face_Cast(explorer.Current())
        adaptor = BRepAdaptor_Surface(occ_face)
        surf_type = adaptor.GetType()
        
        if surf_type == GeomAbs_Plane:
            wire_data = extract_clean_planar_wires(occ_face, scale, linear_deflection)
            pln = adaptor.Plane()
            normal = [pln.Axis().Direction().X(), pln.Axis().Direction().Y(), pln.Axis().Direction().Z()]
            planar_faces.append({
                "surface_type": "Plane",
                "normal": normal,
                "outer": wire_data["outer"],
                "inner": wire_data.get("inner", []),
                "outer_coordinates": wire_data["outer"],
                "inner_coordinates": wire_data.get("inner", [])
            })
        else:
            curved_faces.append({
                "surface_type": str(surf_type),
                "occ_face": occ_face
            })
        explorer.Next()
        
    return planar_faces, curved_faces
```

### 3.3 Dynamic Adaptive Deflection Formulae
For non-planar faces, tessellation linear deflection $d_{\text{lin}}$ and angular deflection $\theta_{\text{ang}}$ are dynamically computed based on bounding diagonal $D = \sqrt{\Delta x^2 + \Delta y^2 + \Delta z^2}$:

$$d_{\text{lin}}(D) = \begin{cases}
\max(2.5, 0.003 \cdot D) & D > 5000\text{ mm} \\
\max(1.0, 0.002 \cdot D) & 1000\text{ mm} < D \le 5000\text{ mm} \\
\max(0.5, 0.002 \cdot D) & 200\text{ mm} < D \le 1000\text{ mm} \\
\max(0.2, 0.003 \cdot D) & D \le 200\text{ mm}
\end{cases}$$

$$\theta_{\text{ang}}(D) = \begin{cases}
0.65\text{ rad } (37.2^\circ) & D > 5000\text{ mm} \\
0.52\text{ rad } (29.8^\circ) & 1000\text{ mm} < D \le 5000\text{ mm} \\
0.45\text{ rad } (25.8^\circ) & 200\text{ mm} < D \le 1000\text{ mm} \\
0.40\text{ rad } (22.9^\circ) & D \le 200\text{ mm}
\end{cases}$$

### 3.4 Unit Normalization & Scaling Matrix
All inputs are normalized into canonical millimeters during byte ingestion:

| Source Unit Code | STEP Entity Identifier | Linear Scale Factor to $\text{mm}$ |
| :--- | :--- | :--- |
| **Millimeter (`mm`)** | `.MILLI., .METRE.` | $1.0$ |
| **Centimeter (`cm`)** | `.CENTI., .METRE.` | $10.0$ |
| **Meter (`m`)** | `$, .METRE.` or `*, .METRE.` | $1000.0$ |
| **Inch (`in`)** | `CONVERSION_BASED_UNIT('INCH', ...)` | $25.4$ |
| **Foot (`ft`)** | `CONVERSION_BASED_UNIT('FOOT', ...)` | $304.8$ |
| **Yard (`yd`)** | `CONVERSION_BASED_UNIT('YARD', ...)` | $914.4$ |
| **Micron (`um`)** | `.MICRO., .METRE.` | $0.001$ |

### 3.5 Vectorized Mesh Validation & Sanitization Pipeline
Incoming meshes pass through `validate_and_compact_mesh` before transmission to client memory:
1. **Finite Coordinate Filtering:** $\mathbf{V}_{\text{valid}} = \{ \mathbf{v}_i \in \mathbf{V} \mid \text{isfinite}(\mathbf{v}_i) \land \|\mathbf{v}_i\|_\infty < 10^{10} \}$.
2. **Index Re-mapping:** Out-of-bounds index references are pruned; indices are compacted using an $O(1)$ lookup vector.
3. **Degenerate Face Elimination:** Triangular facets satisfying $\frac{1}{2}\|(\mathbf{v}_1 - \mathbf{v}_0) \times (\mathbf{v}_2 - \mathbf{v}_0)\| < 10^{-9}\text{ mm}^2$ or containing duplicated vertex indices are discarded.

---

## 4. UI & Assistant Components

### 4.1 UI Component Architecture
The front-end is organized into modular ES6 controllers interfacing directly with shared state:

```
                                  +-----------------------+
                                  |   CADState Store      |
                                  | (state.js)            |
                                  +-----------+-----------+
                                              |
                   +--------------------------+--------------------------+
                   |                          |                          |
                   v                          v                          v
+-------------------------------+ +-----------------------+ +-------------------------+
|   UIController (ui.js)        | | ViewportController    | | AssemblyTreeController  |
| - Sliding retractable panels  | | (viewport.js)         | | (assembly_tree.js)      |
| - Parameter inspector form    | | - Canvas 2D overlay   | | - B-Rep tree rendering  |
| - Theme & unit management     | | - Trackball Gizmo     | | - Sub-element traversal |
| - LinuxCNC G-Code digest modal| | - Mouse/Touch physics | | - Bidirectional select  |
+-------------------------------+ +-----------------------+ +-------------------------+
```

### 4.2 Interactive Sub-Element Selection & CSnap Engine
The selection sub-system operates across 4 distinct hierarchical modes:

```
[Selection Mode] ──┬──> PART:   Selects complete GeoInstance / GeoPart solid body.
                   ├──> FACE:   Queries B-Rep face topology, surface normal & exact area.
                   ├──> EDGE:   Selects continuous topological boundary curves.
                   └──> VERTEX: Selects exact 3D Cartesian vertex coordinate.
```

The CSnap engine performs real-time screen-space candidate ranking using depth weighting and normal vector dot-product occlusion culling:

$$W(\mathbf{p}_{\text{snap}}) = \left( \frac{1}{\|\mathbf{x}_{\text{mouse}} - \mathbf{p}_{\text{screen}}\| + \epsilon} \right) \cdot \left( |\mathbf{n}_{\text{face}} \cdot \mathbf{v}_{\text{view}}| + 0.1 \right)$$

### 4.3 Vertex AI Engineering Assistant
The intelligent assistant provides generative mechanical engineering reasoning, CadQuery script synthesis, and topological analysis backed by Google Cloud Vertex AI (`gemini-1.5-flash`).

* **Project Scope:** `broadcasterfishmap`
* **Location:** `global`
* **System Prompt Invariant:** Authoritative B-Rep geometry vs. derived render mesh distinction, volumetric mass calculations, and DIN/ISO machining parameter derivation.

```python
# System context injection schema for Assistant queries
cad_context = {
    "canonical_unit": "mm",
    "geodetic_anchor": {"lat": 33.8704, "lng": -117.9242, "altitude": 1609.34},
    "bodies": [
        {
            "id": obj.object_id,
            "name": obj.name,
            "material": obj.material,
            "faces_count": len(obj.faces),
            "volume_cm3": obj.get_volume_cm3(),
            "mass_grams": obj.get_mass_grams(),
            "bounding_box": obj.compute_bounds()
        }
        for obj in global_cad_state.objects.values()
    ]
}
```

---

## 5. System Telemetry & Performance Bounds

### 5.1 Telemetry Contract & Monitoring Metrics
System operational state is queried via `/cad/api/telemetry` and verified against strict runtime invariants.

```json
{
  "success": true,
  "system": "GeoParametric3D Workstation",
  "version": "10.0.0-PROD",
  "canonical_base": "metric_linear_mm",
  "canonical_unit": "mm",
  "geodetic_anchor": {
    "name": "Fullerton Geodetic Anchor",
    "lat": 33.8704,
    "lng": -117.9242,
    "altitude": 1609.34,
    "elevation_datum": "1.0 international mile (1609.34 m MSL)"
  },
  "objects": 1,
  "objectsCount": 1,
  "vertices": 24,
  "totalVertices": 24,
  "fps": 60,
  "status": "READY",
  "shading": {
    "mode": "100% Opaque Solid",
    "default_opacity": 1.0
  },
  "grid": {
    "mesh_spacing": "1 ft (304.8 mm)",
    "max_extent": "2000 ft (609600 mm)"
  },
  "vertex_ai": {
    "enabled": true,
    "project_id": "broadcasterfishmap",
    "location": "global",
    "model": "gemini-1.5-flash"
  }
}
```

### 5.2 Performance Benchmarks & Quality Thresholds

| Operation | Target Budget | Observed Performance | Validation Method |
| :--- | :--- | :--- | :--- |
| **Initial 1-ft Box Spawn** | $\le 10\text{ ms}$ | $1.2\text{ ms}$ | Unit benchmark |
| **50,000 Triangle Binary STL Import** | $\le 1500\text{ ms}$ | $310.4\text{ ms}$ | `test_large_binary_stl_performance` |
| **STEP B-Rep Structured Ingestion** | $\le 200\text{ ms}$ | $42.6\text{ ms}$ | `test_step_topological_brep_hierarchy` |
| **Ear-Clipping 3D Triangulation** | $\le 5\text{ ms}$ | $0.3\text{ ms}$ (Quad) | `test_polygon_3d_triangulation` |
| **Viewport Frame Rendering** | $\le 16.6\text{ ms}$ (60 FPS) | $2.1\text{ ms}$ | Chrome DevTools Tracing |
| **Camera Orbit & Pan Latency** | $0\text{ ms}$ CPU | Native GPU | `<gmp-map-3d>` Direct Matrix Transform |

### 5.3 Pipeline Error Classifications
Pipeline exceptions are explicitly typed using `GeometryPipelineStage` enum values to guarantee deterministic debugging:

```
[FORMAT_DETECTION_ERROR]    Magic byte mismatch or unsupported schema.
[STEP_IMPORT_ERROR]         Entity graph cycle or invalid CARTESIAN_POINT format.
[BREP_TOPOLOGY_ERROR]       Non-manifold boundary wire or unclosed shell.
[SURFACE_EXTRACTION_ERROR]  Failed analytic surface projection or singularity.
[TESSELLATION_ERROR]        Deflection solver divergence or chordal error violation.
[MESH_VALIDATION_ERROR]     NaN/Inf vertex coordinates or degenerate area < 1e-9.
[JSON_SERIALIZATION_ERROR]  Non-finite float encountering network serialization gateway.
```
make all necessary changes and file writes to complete
