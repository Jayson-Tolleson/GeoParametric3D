# GeoParametric3D: Technical Architectural Specification & System Blueprint

## 1. Executive Summary & Architectural Invariants

GeoParametric3D is a cloud-native, high-precision Computer-Aided Design (CAD) workstation engineered to bridge exact Boundary Representation (B-Rep) solid modeling with web-scale 3D geospatial visualization via Google Photorealistic 3D Tiles (`<gmp-map-3d>`). 

```
                                    +-------------------------------------------------+
                                    |         CANONICAL B-REP SOURCE OF TRUTH         |
                                    |   GeoAssembly -> GeoInstance -> GeoPart -> ...  |
                                    +------------------------+------------------------+
                                                             |
                                      [Dual-Route Topological Classifier]
                                                             |
                           +---------------------------------+---------------------------------+
                           |                                                                   |
                           v                                                                   v
            +------------------------------+                                    +------------------------------+
            |  ROUTE A: PLANAR N-GON LOOPS |                                    |  ROUTE B: CURVED DEFLECTION  |
            |  • GeomAbs_Plane Extractor   |                                    |  • GCPnts Quasi-Uniform      |
            |  • Outer/Inner Wire Loops    |                                    |  • Adaptive Linear/Angular   |
            |  • Zero Internal Diagonals   |                                    |  • Watertight Surface Mesh   |
            +--------------+---------------+                                    +--------------+---------------+
                           |                                                                   |
                           +---------------------------------+---------------------------------+
                                                             |
                                          [Canonical Coordinate & Scale Normalizer]
                                          • Local Millimeter (mm) -> WGS84 Geodetic
                                          • Single Authoritative Transformation Matrix
                                                             |
                           +---------------------------------+---------------------------------+
                           |                                                                   |
                           v                                                                   v
            +------------------------------+                                    +------------------------------+
            |   GEOSPATIAL DOM OVERLAY     |                                    |    ANALYTIC CANVAS ENGINE    |
            |   <gmp-map-3d> Viewport      |                                    |    2D Canvas / WebGL Hybrid  |
            |   <gmp-polygon-3d> Elements  |                                    |    2,000-ft 1-ft Ground Grid |
            |   100% Opaque Shading        |                                    |    CSnap Real-Time Target    |
            +------------------------------+                                    +------------------------------+
```

### 1.1 Core Architectural Invariants
* **Invariant I: Source Geometry $\neq$ Render Representation.** The exact B-Rep boundary model (`GeoPart`, `GeoSolid`, `GeoShell`, `GeoFace`, `GeoLoop`, `GeoEdge`, `GeoVertex`) constitutes mathematical source truth. Render meshes and 3D polygon nodes are derived downstream projections.
* **Invariant II: Zero Internal Diagonals on Planar Faces.** Planar topological faces (`GeomAbs_Plane`) are never degraded to triangle soups for flat rendering. They are routed into clean, non-triangulated outer perimeter and inner cutout loops.
* **Invariant III: 100% Opaque Solid Shading.** Parts instantiate with complete opacity ($\alpha = 1.0$) by default to ensure unambiguous depth occlusion, preventing visual ambiguity and overlapping transparency artifacts.
* **Invariant IV: Authoritative Canonical Unit Standard.** All internal geometric definitions, dimensions, bounding volumes, and transformations are strictly normalized to linear millimeters ($\text{mm}$). Imperial/Metric presentation conversions occur solely at UI boundaries.
* **Invariant V: Scale-Dimensionless Invariance.** Rigid transforms maintain scale, position, and orientation orthogonally: $\mathbf{P}' = \mathbf{T} \cdot \mathbf{R} \cdot \mathbf{S} \cdot \mathbf{P}$. Scale modifications never drift the spatial anchor coordinates.

---

## 2. Viewport & Grid Assembly

```
+----------------------------------------------------------------------------------------------------+
|  <gmp-map-3d id="boatscreen" center="0,0,0" range="1828.8" tilt="65" heading="30">                 |
|    +------------------------------------------------------------------------------------------+    |
|    |  <gmp-polygon-3d> [Planar N-Gon #1]  outerCoordinates=[{lat,lng,alt}, ...]               |    |
|    |  <gmp-polygon-3d> [Planar N-Gon #2]  innerCoordinates=[{lat,lng,alt}, ...] (Holes)       |    |
|    +------------------------------------------------------------------------------------------+    |
|    +------------------------------------------------------------------------------------------+    |
|    |  <canvas id="viewport-overlay-canvas">                                                   |    |
|    |    • 2,000-ft Horizon Ground Grid (1-ft Squares; Step = 304.8mm)                         |    |
|    |    • Tri-Color Coordinate Datum Axes (X=Red, Y=Green, Z=Blue)                            |    |
|    |    • CSnap Edge/Midpoint/Vertex Disambiguation Rings                                     |    |
|    |    • Dynamic Box Marquee & Real-Time Construction Vectors                                |    |
|    +------------------------------------------------------------------------------------------+    |
+----------------------------------------------------------------------------------------------------+
```

### 2.1 Geospatial Engine & Local Tangent Plane (ENU) Mapping
The workstation anchors local CAD Cartesian millimeter coordinates $[x_{\text{mm}}, y_{\text{mm}}, z_{\text{mm}}]^T$ to the WGS84 ellipsoidal reference frame $(\text{lat}, \text{lng}, \text{alt})$ anchored at the Null Island Geodetic Origin ($0.0^{\circ}\text{N}, 0.0^{\circ}\text{E}, 0.0\,\text{m}$):

$$\phi = \phi_0 + \frac{y_{\text{mm}} \cdot 10^{-3}}{M(\phi_0) + h_0} \cdot \left(\frac{180}{\pi}\right), \quad \lambda = \lambda_0 + \frac{x_{\text{mm}} \cdot 10^{-3}}{(N(\phi_0) + h_0)\cos(\phi_0)} \cdot \left(\frac{180}{\pi}\right), \quad h = h_0 + z_{\text{mm}} \cdot 10^{-3}$$

Where prime vertical radius $N(\phi)$ and meridional radius $M(\phi)$ use standard WGS84 constants:
* Semi-major axis: $a = 6{,}378{,}137.0\,\text{m}$
* First eccentricity squared: $e^2 = 0.00669437999014$

### 2.2 2,000-Foot 1-Foot Ground Mesh Grid
The infinite-plane illusion utilizes a dynamic LOD multi-tier grid spanning $\pm 2{,}000\,\text{ft}$ ($\pm 609{,}600\,\text{mm}$) around the geodetic anchor:
* **Base Grid Unit:** $1\,\text{ft} \equiv 304.8\,\text{mm}$ constant spacing.
* **Extended Bound:** $x, y \in [-609600\,\text{mm}, +609600\,\text{mm}]$.
* **Adaptive Visual Density:** When camera range increases, rendering dynamically adapts line strides ($k \in \{1, 2, 5, 20, 50\}$) to preserve fixed $60\,\text{FPS}$ throughput without high-frequency aliasing:

```javascript
// Dynamic Grid Striding Engine
const rangeMeters = cam.range / 1000.0;
let stride = 1;
if (rangeMeters > 500) stride = 50;
else if (rangeMeters > 150) stride = 20;
else if (rangeMeters > 50) stride = 5;
else if (rangeMeters > 20) stride = 2;

const step = 304.8 * stride; // 1-ft base quantum
ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
```

### 2.3 Shading, Presentation & Import Color Retention
* **Material Shading:** Solids render opaque ($\alpha = 1.0$), bypassing default alpha-blending transparency traps.
* **Metadata Extraction:** Direct recovery of STEP presentation colors (`COLOUR_RGB`, `XCAFDoc_ColorTool`) during ingestion:
  * Surface and curve colors map directly to `<gmp-polygon-3d>` properties: `fillColor`, `strokeColor`, `strokeWidth`.
  * Fallback deterministic palette for multi-solid compounds: `["#38bdf8", "#34d399", "#fbbf24", "#ec4899", "#a78bfa", "#fb923c"]`.

---

## 3. Kernel & B-Rep Translation

```
+---------------------------------------------------------------------------------------+
|                       PARALLEL DUAL-ROUTE INGESTION PIPELINE                          |
+---------------------------------------------------------------------------------------+
|  [Input Source] STEP AP203/214/242, FCStd, XBF, STL, OBJ, GLB, 3MF                    |
|        |                                                                              |
|        v                                                                              |
|  [Thread 1..N: ThreadPoolExecutor(max_workers=4)]                                     |
|        |                                                                              |
|        +---> STEP 1: TopExp_Explorer -> Unpack TopoDS_Solid / TopoDS_Shell            |
|        |                                                                              |
|        +---> STEP 2: Compute Bounding Diagonal:                                       |
|        |             d = sqrt((x_max-x_min)^2 + (y_max-y_min)^2 + (z_max-z_min)^2)    |
|        |                                                                              |
|        +---> STEP 3: Dynamic Linear/Angular Deflection Calculation:                   |
|        |             delta_lin = max(0.2, d * 0.002), theta_ang = 0.40..0.65 rad      |
|        |                                                                              |
|        +---> STEP 4: Surface Classification via BRepAdaptor_Surface:                  |
|                      ├── GeomAbs_Plane  ──> extract_clean_planar_wires()               |
|                      └── Non-Planar     ──> BRepMesh_IncrementalMesh()                |
+---------------------------------------------------------------------------------------+
```

### 3.1 Mathematical B-Rep Entity Hierarchy

| Entity Type | Mathematical Definition | Memory Invariant |
| :--- | :--- | :--- |
| `GeoVertex` | $\mathbf{v} = [x, y, z]^T \in \mathbb{R}^3$ | Finite coordinates ($\text{NaN}/\infty$ rejected) |
| `GeoCurve` | $\mathbf{C}(t): [0, 1] \to \mathbb{R}^3$ (Line, Circle, Arc, Spline) | Analytical formula; sampled on demand |
| `GeoEdge` | $E = (\mathbf{v}_{\text{start}}, \mathbf{v}_{\text{end}}, \mathbf{C}(t), \text{orient})$ | $\| \mathbf{v}_{\text{start}} - \mathbf{v}_{\text{end}} \| \ge 10^{-7}\,\text{mm}$ |
| `GeoLoop` | $L = (E_1, E_2, \dots, E_k), \quad \partial L = \emptyset$ | Planar closed winding; Outer vs. Inner voids |
| `GeoSurface`| $\mathbf{S}(u, v): \mathbb{R}^2 \to \mathbb{R}^3$ (Plane, Cylinder, Cone, Torus) | Normal field $\mathbf{n}(u,v) = \frac{\mathbf{S}_u \times \mathbf{S}_v}{\|\mathbf{S}_u \times \mathbf{S}_v\|}$ |
| `GeoFace` | $F = (\mathbf{S}(u,v), L_{\text{outer}}, \{L_{\text{inner}, 1..m}\})$ | Distinct face UUIDs for provenance tracking |
| `GeoShell` | $\Sigma = \{F_1, F_2, \dots, F_p\}, \quad \text{manifold}$ | 2-manifold closedness check |
| `GeoSolid` | $\Omega = (\Sigma_{\text{outer}}, \{\Sigma_{\text{void}, 1..q}\})$ | Exact interior/exterior sign determination |

### 3.2 Dual-Route Face Classification Engine

```python
def route_cad_faces(shape: TopoDS_Shape, scale: float = 1.0, linear_deflection: float = 0.5):
    planar_faces, curved_faces = [], []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    
    while explorer.More():
        occ_face = TopoDS.Face_s(explorer.Current())
        adaptor = BRepAdaptor_Surface(occ_face)
        stype = adaptor.GetType()
        
        if stype == GeomAbs_Plane:
            wire_data = extract_clean_planar_wires(occ_face, scale, linear_deflection)
            planar_faces.append({
                "face_id": f"Face_Planar_{uuid.uuid4().hex[:6]}",
                "surface_type": "Plane",
                "normal": [adaptor.Plane().Axis().Direction().X(),
                           adaptor.Plane().Axis().Direction().Y(),
                           adaptor.Plane().Axis().Direction().Z()],
                "outer": wire_data["outer"],
                "inner": wire_data["inner"],
                "has_holes": len(wire_data["inner"]) > 0
            })
        else:
            curved_faces.append({"occ_face": occ_face, "surface_type": str(stype)})
        explorer.Next()
    return planar_faces, curved_faces
```

### 3.3 Strict Finite Compaction & Degenerate Rejection Contract
Before mesh streaming to WebGL/Canvas buffers, geometry is sanitized:

```python
def validate_and_compact_mesh(raw_v: np.ndarray, raw_t: np.ndarray, tol: float = 1e-8):
    # 1. Finite Masking
    finite_mask = np.all(np.isfinite(raw_v), axis=1)
    old_to_new = np.full(len(raw_v), -1, dtype=np.int32)
    old_to_new[finite_mask] = np.arange(np.count_nonzero(finite_mask), dtype=np.int32)
    compact_v = raw_v[finite_mask]

    # 2. Index Remapping & Boundary Culling
    remapped_t = old_to_new[np.clip(raw_t, 0, len(raw_v) - 1)]
    valid_tri_mask = ~np.any(remapped_t < 0, axis=1)
    t_filt = remapped_t[valid_tri_mask]

    # 3. Degenerate Area Culling
    p0, p1, p2 = compact_v[t_filt[:, 0]], compact_v[t_filt[:, 1]], compact_v[t_filt[:, 2]]
    cross_prod = np.cross(p1 - p0, p2 - p0)
    areas_x2 = np.linalg.norm(cross_prod, axis=1)
    non_deg_mask = (areas_x2 > tol) & np.isfinite(areas_x2)
    
    return compact_v, t_filt[non_deg_mask], {"status": "PASS", "triangles": np.count_nonzero(non_deg_mask)}
```

---

## 4. UI, Assistants & Command Gateway

```
+----------------------------------------------------------------------------------------------------+
| TOP PANEL: [SESSION] [SHARE & CAPTURE] [12" PRIMITIVES] [TRANSFORM] [DRAFT] [CSNAP] [FEATURES]   |
+----------------------------------------------------------------------------------------------------+
| LEFT SLIDE:                               | VIEWPORT:                         | RIGHT SLIDE:       |
| • Assembly Tree                           | • Google Maps 3D Canvas           | • Active Action    |
| • GeoSolid / GeoShell                     | • 2,000-ft Grid                   | • Properties       |
| • GeoFace Provenance                      | • Spherical Trackball             | • System Telemetry |
+----------------------------------------------------------------------------------------------------+
| BOTTOM DRAWER: [ 🤖 Engineering Assistant & AI Script Engine (broadcasterfishmap/global) ]         |
+----------------------------------------------------------------------------------------------------+
```

### 4.1 Master Toolbar Layout (79 Bound Operations)
* **Session Management:** New Project, Save UUID, Load UUID, Universal Byte Import, Export (`.xbf`, `.step`), Undo, Redo, Preferences.
* **Capture & Broadcast:** Snapshot Viewport, Snapshot + Interface Overlay, 60-Second HD MP4 Video Recorder, Social Share Dialog.
* **12-Inch ($304.8\,\text{mm}$) Primitives:** Box, Cylinder, Sphere, Cone, Torus, Triangular/Hexagonal Prism, Regular Polygon, Ellipse, Wedge, Pyramid, Ellipsoid, Tube, Plane.
* **Direct Drafting & CSnap:** Line, Rectangle, Circle, Continuous Polyline, Arc, Polygon, Ellipse with smart vertex/midpoint snapping.
* **Parametric Features & Solid Ops:** Extrude, Revolve, Hole, Fillet, Chamfer, Cross-Section Slicing, Boolean Union, Subtract, Intersect.

### 4.2 CSnap Bearing Edge Disambiguation
To prevent erroneous snap acquisitions on overlapping silhouettes, CSnap weights candidates via geometric proximity, topological classification, and surface normal direction:

$$W(\mathbf{p}) = \left(\frac{1}{\|\mathbf{x}_{\text{cursor}} - \mathbf{p}_{\text{screen}}\| + \epsilon}\right) \cdot \left( |\mathbf{n}_{\text{face}} \cdot \mathbf{d}_{\text{view}}| + 0.1 \right)$$

```
                                    Cursor Position
                                          *
                                         / \
                                        /   \
                                       /     \
                       Candidate Vertex       Candidate Midpoint
                         (Weight: 0.95)         (Weight: 0.42)
```

### 4.3 Vertex AI Engineering Assistant Gateway
* **Project ID:** `broadcasterfishmap`
* **Location:** `global`
* **Model:** `gemini-1.5-flash`
* **System Integration:** Operates with continuous assembly state inspection (`cad_context`), generating exact CadQuery scripts, B-Rep geometric derivations, and automated parametric mutations.

```python
# System Context Schema for Vertex AI
system_context = (
    "You are the dedicated Engineering Assistant for GeoParametric3D (Project: broadcasterfishmap, Location: global).\n"
    "B-Rep geometry is authoritative; render meshes are derived representations.\n"
    "Distinguish CAD topology (faces, edges, loops, vertices) from render artifacts (triangles, diagonals)."
)
```

---

## 5. System Telemetry, Math Rigor & Verification Matrix

### 5.1 Analytical Box Signed Distance Field (SDF) Formulation
Validation uses an exact analytical Box SDF to verify boundary evaluation, volume calculations, and gradient normal accuracy:

$$\Phi_{\text{box}}(\mathbf{p}) = \|\max(\mathbf{q}, \mathbf{0})\|_2 + \min(\max(q_x, \max(q_y, q_z)), 0.0), \quad \mathbf{q} = |\mathbf{p} - \mathbf{c}| - \mathbf{r}$$

```python
class BoxSDF(GeometricScalarField):
    def __init__(self, w: float, d: float, h: float, cx: float = 0.0, cy: float = 0.0, cz: float = 0.0):
        self.r = np.array([w / 2.0, d / 2.0, h / 2.0], dtype=np.float64)
        self.c = np.array([cx, cy, cz + h / 2.0], dtype=np.float64)

    def evaluate(self, x: float, y: float, z: float) -> float:
        p = np.array([x, y, z], dtype=np.float64)
        q = np.abs(p - self.c) - self.r
        ext = np.linalg.norm(np.maximum(q, 0.0))
        internal = min(max(q[0], max(q[1], q[2])), 0.0)
        return float(ext + internal)
```

### 5.2 Verification Test Matrix

```
====================================================================================================
               GEOPARAMETRIC3D COMPREHENSIVE VERIFICATION SUITE
====================================================================================================
 Test Target                    Verification Criteria                     Status   Execution SLA
----------------------------------------------------------------------------------------------------
 test_canonical_box_brep        8 Vertices, 12 Edges, 6 Loops, 6 Faces     PASS     < 5.0 ms
 test_transform_composition     100 Instances, Single Geometry Part        PASS     < 12.0 ms
 test_adaptive_tessellation     High-LOD Derived Mesh, Intact B-Rep        PASS     < 8.0 ms
 test_unit_conversion           mm/cm/m/in/ft exact conversion factors    PASS     < 1.0 ms
 test_step_ap214_brep           Entity Graph Extraction & Color Parse      PASS     < 35.0 ms
 test_finite_coordinates       NaN/Inf Detection & Safe Rejection         PASS     < 2.0 ms
 test_large_binary_stl          50k Triangle Vectorized Import Pipeline    PASS     < 1500.0 ms
 test_scale_invariance          Pos_initial == Pos_scaled (Exact Match)    PASS     < 1.0 ms
 test_box_sdf_golden            Analytical Distance & Normal Equivalence   PASS     < 3.0 ms
====================================================================================================
```

### 5.3 Workstation System Telemetry Contract

```json
{
  "system": "GeoParametric3D Workstation",
  "version": "10.0.0-PROD",
  "status": "READY",
  "fps": 60,
  "canonical_unit": "mm",
  "geodetic_origin": { "lat": 0.0, "lng": 0.0, "altitude": 0.0 },
  "grid": { "mesh_spacing": "1 ft (304.8 mm)", "max_extent": "2000 ft (609600 mm)" },
  "shading": { "mode": "100% Opaque Solid", "default_opacity": 1.0 },
  "vertex_ai": {
    "enabled": true,
    "project_id": "broadcasterfishmap",
    "location": "global",
    "model": "gemini-1.5-flash"
  }
}
```
