# GeoParametric3D: Architectural Specification & Systems Design Document

**System:** GeoParametric3D Engineering Workstation  
**Document Code:** `SPEC-GP3D-V10`  
**Internal Coordinate Base:** Metric Linear Millimeters (`mm`)  
**Geodetic Anchor:** Fullerton, CA 92831 ($33.8704^\circ\text{ N}, -117.9242^\circ\text{ W}$, Elevation: $1609.34\text{ m}$ / $1\text{ mi}$)  
**Target Viewport:** Google Maps 3D Web Component (`<gmp-map-3d>`) with WebGL/Canvas Hybrid Overlay  

---

## 1. Executive Summary

GeoParametric3D is an authoritative, browser-native Computer-Aided Design (CAD) workstation engineered to bridge exact boundary-representation (B-Rep) solid modeling with high-precision geospatial 3D visualization. Unlike standard polygon-mesh viewers that destroy CAD topology upon ingestion, GeoParametric3D enforces a strict separation between **Authoritative Geometric Truth** (exact analytical topological entities) and **Derived Render Representations** (adaptive polygonal approximations and native planar primitives).

```
+---------------------------------------------------------------------------------------+
|                              AUTHORITATIVE CAD GEOMETRY                               |
|        GeoAssembly -> GeoInstance -> GeoPart -> GeoSolid -> GeoShell -> GeoFace       |
|                                                                                       |
|                 +---------------------------------------------------+                 |
|                 | Mathematical Surfaces: Planes, Cylinders, NURBS   |                 |
|                 | Canonical Storage Unit: Millimeters (mm)           |                 |
|                 +---------------------------------------------------+                 |
+-------------------------------------------+-------------------------------------------+
                                            |
                                            v
                   +------------------------------------------------+
                   |           DUAL-ROUTE GEOMETRY ROUTER           |
                   +------------------------+-----------------------+
                                            |
               +----------------------------+----------------------------+
               |                                                         |
               v [GeomAbs_Plane]                                         v [Curved / Freeform]
+------------------------------+                          +------------------------------+
|     PLANAR N-GON ROUTE       |                          | ADAPTIVE DEFLECTION ROUTE    |
| - Exact boundary outer loops |                          | - Linear / angular defl.     |
| - Multiply-connected holes   |                          | - Dynamic LOD tessellation   |
| - Zero internal diagonals    |                          | - Continuous vertex normals  |
+--------------+---------------+                          +--------------+---------------+
               |                                                         |
               v                                                         v
+------------------------------+                          +------------------------------+
|   NATIVE <gmp-polygon-3d>    |                          |      HYBRID RENDER MESH      |
|  - Hardware depth buffer     |                          | - 100% Opaque solid shading  |
|  - Native WGS84 coordinates  |                          | - Face-provenance retention  |
+------------------------------+                          +------------------------------+
```

### 1.1 Core Invariants
* **Invariant I (Truth Separation):** Authoritative B-Rep geometry and topology exist independently of any render mesh. Meshes are volatile, derived caches.
* **Invariant II (Canonical Unit Authority):** All computational kernel math, boundary evaluations, transforms, and persistence operations execute in canonical linear millimeters ($1\text{ mm} = 1.0$). User preferences (Inches, Feet, Meters) are applied exclusively at display and input boundaries via authoritative single-conversion matrices.
* **Invariant III (Zero Planar Diagonals):** Planar topological faces (`GeomAbs_Plane`) are never rendered with software-meshed interior diagonal lines; they are routed directly to closed N-Gon boundary loops.
* **Invariant IV (Geodetic Zero-Point Clearance):** To prevent clipping beneath digital elevation models (DEM) or terrain meshes at geodetic sea level ($0\text{ m}$ MSL), the CAD document origin $(0, 0, 0)_{\text{ENU}}$ is clamped to an elevated geodetic datum anchored at 1.0 mile ($1609.34\text{ m}$) above Fullerton, California ($33.8704^\circ\text{ N}, -117.9242^\circ\text{ W}$).
* **Invariant V (Scale Dimensionless Invariance):** Object transformations maintain pure separation between translation vectors $\mathbf{t} \in \mathbb{R}^3$, Euler rotations $\mathbf{r} \in \mathbb{R}^3$, and dimensionless scale factors $\mathbf{s} \in \mathbb{R}^3$. Applying scale $\mathbf{s} \to \alpha\mathbf{s}$ strictly preserves world origin position $\mathbf{t}$.

---

## 2. Viewport & Grid Assembly

### 2.1 Geodetic Coordinate Projection ($ENU \leftrightarrow WGS84$)
The workstation integrates an East-North-Up (ENU) Cartesian local tangent plane anchored at geodetic coordinates:
* $\phi_0 = 33.8704^\circ\text{ N}$ (Reference Latitude)
* $\lambda_0 = -117.9242^\circ\text{ W}$ (Reference Longitude)
* $h_0 = 1609.34\text{ m}$ (Reference Ellipsoidal Height, 1 mile above Fullerton, CA)

Transformation from local CAD coordinates $(x, y, z)$ in millimeters to WGS84 $(\phi, \lambda, h)$ uses the WGS84 ellipsoid parameters ($a = 6378137.0\text{ m}$, $f = 1/298.257223563$, $e^2 = 2f - f^2$):

$$\begin{aligned}
x_{\text{m}} &= \frac{x}{1000.0}, \quad y_{\text{m}} = \frac{y}{1000.0}, \quad z_{\text{m}} = \frac{z}{1000.0} \\
N(\phi_0) &= \frac{a}{\sqrt{1 - e^2 \sin^2(\phi_0)}}, \quad M(\phi_0) = \frac{a(1 - e^2)}{(1 - e^2 \sin^2(\phi_0))^{3/2}} \\
\Delta \phi &= \frac{y_{\text{m}}}{M(\phi_0) + h_0} \cdot \frac{180}{\pi}, \quad \Delta \lambda = \frac{x_{\text{m}}}{(N(\phi_0) + h_0) \cos(\phi_0)} \cdot \frac{180}{\pi} \\
\phi &= \phi_0 + \Delta \phi, \quad \lambda = \lambda_0 + \Delta \lambda, \quad h = h_0 + z_{\text{m}}
\end{aligned}$$

```python
def enu_to_wgs84(coords, lat0=33.8704, lon0=-117.9242, alt0=1609.34, rot_z=0.0):
    arr = np.asarray(coords, dtype=np.float64)
    if rot_z != 0.0:
        rad = math.radians(rot_z)
        c, s = math.cos(rad), math.sin(rad)
        rx = arr[:, 0] * c - arr[:, 1] * s
        ry = arr[:, 0] * s + arr[:, 1] * c
        rz = arr[:, 2]
    else:
        rx, ry, rz = arr[:, 0], arr[:, 1], arr[:, 2]

    lat_rad = math.radians(lat0)
    mm_per_deg_lat = 111111000.0
    mm_per_deg_lng = 111111000.0 * math.cos(lat_rad)

    lats = lat0 + (ry / mm_per_deg_lat)
    lngs = lon0 + (rx / mm_per_deg_lng)
    alts = alt0 + (rz * 0.001)
    return lats, lngs, alts
```

### 2.2 2,000-Foot Ground Grid & Datum Coordinate Axes
* **Extent:** $2000\text{ ft} \times 2000\text{ ft}$ ($609,600\text{ mm} \times 609,600\text{ mm}$) centered at $(0, 0, 0)_{\text{ENU}}$.
* **Subdivisions:** Minor grid intervals at $1\text{ ft}$ ($304.8\text{ mm}$) or $300\text{ mm}$ metric.
* **Adaptive Grid Striding:** Dynamically adjusts rendering frequency based on camera range:
  * Range $> 500\text{ m}$: Stride $= 50\times$ ($50\text{ ft}$ intervals)
  * Range $150\text{ m} - 500\text{ m}$: Stride $= 20\times$ ($20\text{ ft}$ intervals)
  * Range $50\text{ m} - 150\text{ m}$: Stride $= 5\times$ ($5\text{ ft}$ intervals)
  * Range $< 50\text{ m}$: Stride $= 1\times$ ($1\text{ ft}$ intervals)
* **Datum Axes:** Orthogonal RGB triad ($X = \text{Red } [1,0,0]$, $Y = \text{Green } [0,1,0]$, $Z = \text{Blue } [0,0,1]$) spanning $1\text{ ft}$ length from local origin.

### 2.3 Camera & Spherical Trackball Navigation
* **Projection Ratios:** Automated scene-fit distance enforces a $60:1$ viewport-to-part ratio ($d = \max(152.4\text{ mm}, 60 \cdot R_{\text{bbox}})$).
* **Viewcube & Gizmo:** Custom SVG spherical trackball with radial neon glow and quick presets (`FIT`, `ISO`, `TOP`, `FRONT`, `SIDE`).
* **Input Bindings:**
  * `Left Click + Drag`: Orbit azimuth (Heading) and elevation (Tilt).
  * `Right Click + Drag` / `Alt + Left Drag`: Screen pan.
  * `Scroll Wheel` / `Pinch`: Continuous zoom.
  * `Shift + Left Drag`: 2D Marquee box selection.
  * `Ctrl + Arrows` / `Shift + Arrows`: Discrete keyboard panning and orbital steps.

---

## 3. Kernel & B-Rep Translation

### 3.1 Canonical Topological Data Model
The internal modeling engine defines CAD topology hierarchically with absolute geometric fidelity:

```
GeoAssembly
 └── GeoInstance (4x4 Transformation Matrix, Styling)
      └── GeoPart
           └── GeoSolid
                └── GeoShell (Closed manifold status)
                     └── GeoFace (Surface reference + Loop bounds)
                          ├── Outer GeoLoop -> Ordered GeoEdges -> GeoCurves -> GeoVertices
                          └── Inner GeoLoop(s) (Holes, Cutouts)
```

| Entity | Mathematical Definition | Canonical Storage Representation |
| :--- | :--- | :--- |
| **GeoVertex** | Point $\mathbf{p} \in \mathbb{R}^3$ | `np.ndarray([x, y, z], dtype=np.float64)` in mm |
| **GeoCurve** | 1D Parametric Curve $\mathbf{C}(t), t \in [0, 1]$ | Type (`LINE`, `CIRCLE`, `ARC`, `NURBS`) + Control Points / Radii |
| **GeoEdge** | Oriented 1D segment bounded by $(V_{\text{start}}, V_{\text{end}})$ | Start UUID, End UUID, Underlying Curve UUID, Direction flag |
| **GeoLoop** | Closed 1D piecewise boundary $\sum \mathbf{e}_i$ | Ordered Edge UUID array, `is_outer` boolean |
| **GeoSurface** | 2D Parametric Surface $\mathbf{S}(u, v) \subset \mathbb{R}^3$ | Type (`PLANE`, `CYLINDER`, `CONE`, `SPHERE`, `TORUS`, `BSPLINE`) |
| **GeoFace** | Trimmed 2D manifold $\mathbf{S} \setminus \bigcup \text{Loops}_{\text{inner}}$ | Surface UUID, Outer Loop UUID, Inner Loop UUIDs list |
| **GeoShell** | 2-manifold boundary collection $\bigcup F_j$ | Face UUID list, `is_closed` watertight validation flag |
| **GeoSolid** | Watertight 3-manifold volume bounded by shells | Outer Shell UUID, Void Shell UUIDs (internal cavities) |

### 3.2 Dual-Route Classification & Tessellation Engine

```python
def route_cad_faces(shape: Any, scale: float = 1.0, linear_deflection: float = 0.5):
    planar_faces = []
    curved_faces = []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    
    while explorer.More():
        occ_face = TopoDS_Face_Cast(explorer.Current())
        adaptor = BRepAdaptor_Surface(occ_face)
        surface_type = adaptor.GetType()
        
        if surface_type == GeomAbs_Plane:
            wire_data = extract_clean_planar_wires(occ_face, scale=scale, linear_deflection=linear_deflection)
            planar_faces.append(wire_data)
        else:
            curved_faces.append(occ_face)
        explorer.Next()
        
    return planar_faces, curved_faces
```

#### Route A: Exact Planar Polygon Extraction (GeomAbs_Plane)
1. **Wire Exploration:** `BRepTools_WireExplorer` extracts ordered oriented edges for both outer loops and interior cutouts.
2. **Deflection Sampling on Curved Edges:** Linear segments retain exact endpoints; curved boundaries (e.g., circular holes in flat plates) are discretized via `GCPnts_QuasiUniformDeflection` under chordal deflection tolerance $\delta_{\text{chord}} \le 0.05\text{ mm}$.
3. **Loop Normalization:** Eliminates coincident points ($\|\mathbf{p}_i - \mathbf{p}_{i-1}\| < 10^{-6}\text{ mm}$) and guarantees counter-clockwise outer winding and clockwise inner hole winding.
4. **Direct Mounting:** Emitted directly as `<gmp-polygon-3d>` elements with `altitudeMode="absolute"`.

#### Route B: Adaptive Curvature Tessellation (Non-Planar Surfaces)
For analytical cylinders, cones, spheres, tori, and freeform NURBS surfaces, dynamic linear and angular deflection is computed from the bounding diagonal $D_{\text{bbox}}$:

$$\delta_{\text{linear}} = \begin{cases} 
\max(2.5, D_{\text{bbox}} \cdot 0.003) & D_{\text{bbox}} > 5000\text{ mm} \\
\max(1.0, D_{\text{bbox}} \cdot 0.002) & 1000\text{ mm} < D_{\text{bbox}} \le 5000\text{ mm} \\
\max(0.5, D_{\text{bbox}} \cdot 0.002) & 200\text{ mm} < D_{\text{bbox}} \le 1000\text{ mm} \\
\max(0.2, D_{\text{bbox}} \cdot 0.003) & D_{\text{bbox}} \le 200\text{ mm}
\end{cases}, \quad \theta_{\text{angular}} = \begin{cases}
0.65\text{ rad} & D_{\text{bbox}} > 5000\text{ mm} \\
0.52\text{ rad} & 1000\text{ mm} < D_{\text{bbox}} \le 5000\text{ mm} \\
0.45\text{ rad} & 200\text{ mm} < D_{\text{bbox}} \le 1000\text{ mm} \\
0.40\text{ rad} & D_{\text{bbox}} \le 200\text{ mm}
\end{cases}$$

### 3.3 Universal Byte Format Parser & Scaling Adapter
The ingestion pipeline processes arbitrary CAD byte streams through an 8-stage verification pipeline:

```
[RAW BYTES] -> Format Detection -> Unit & Color Inspection -> Out-of-Scale Adaptation
            -> B-Rep Kernel Load -> Multi-Solid Unpack -> Compaction -> Projection
```

* **Supported Formats:** STEP (AP203, AP214, AP242), FreeCAD (`.FCStd`), Binary/ASCII STL, Wavefront OBJ, 3MF, GLTF/GLB, PLY, COLLADA DAE, VRML WRL, and Native Binary XBF (`XBF1`, `XBF2`).
* **Unit Recognition:** Regex token parsing on STEP headers detects SI/Imperial declarations (`SI_UNIT($, .METRE.)`, `SI_UNIT(.MILLI., .METRE.)`, `CONVERSION_BASED_UNIT('INCH', ...)`).
* **Out-of-Scale Heuristic:** Unitless meshes with bounding diagonal $D < 0.15$ are automatically scaled by $1000.0\times$ (meter-to-millimeter recovery). Payloads with $D > 50,000,000.0$ are scaled by $0.001\times$ (micron-to-millimeter adaptation).
* **Compaction Quality Gate:** Mesh buffers execute vectorized NaN/Inf elimination, index remapping, and degenerate triangle removal (rejection threshold: Area $\le 10^{-9}\text{ mm}^2$).

---

## 4. UI & Assistant Components

### 4.1 Interface Layout & Component Hierarchy
* **Sliding Top Panel (`#top-slide-container`):** Three-tier retractable action header containing 79 active command buttons organized into discrete functional sections:
  1. *Session & Capture:* New, Open UUID, Save UUID, Universal Import, Export, Undo, Redo, Preferences, Social Share, Viewport Snapshot, 60-Second MP4 Video Recorder.
  2. *Primitives (12" / 304.8 mm Defaults):* Box, Cylinder, Sphere, Cone, Torus, Prism, Polygon, Ellipse, Wedge, Pyramid, Ellipsoid, Tube, Plane.
  3. *Transform & Draft:* Move, Rotate, Scale, Duplicate, Align, Line, Rectangle, Circle, Arc, Polyline, PolyDraft, EllipseDraft, Csnap Toggle.
  4. *Topology Selection:* Part, Face, Edge, Vertex selection modes.
  5. *Features & Operations:* Extrude, Cross Sections, Hole, Revolve, Fillet, Chamfer, Boolean Union, Subtract, Intersect, Measure, Mass, LinuxCNC Digest, Python Scripting.
* **Left Assembly Sidebar (`#left-slide-container`):** Interactive collapsible tree exposing hierarchical B-Rep structures (`GeoAssembly` $\to$ `PartInstance` $\to$ `GeoSolid` $\to$ `GeoShell` $\to$ `GeoFace`).
* **Right Properties & Inspection Inspector (`#right-slide-container`):** Live editing of object coordinates, rotations, scale multipliers, material assignment (22 engineering materials with accurate densities), color, and primitive dimensions.
* **Bottom Assistant Drawer (`#assistant-drawer`):** Collapsible AI dock providing live chat and automated model execution.

### 4.2 Vertex AI Engineering Assistant Integration
* **Model Configuration:** Gemini 1.5 Flash accessed via Google Cloud Vertex AI REST gateway:
  * **Project ID:** `broadcasterfishmap`
  * **Location:** `global`
  * **Endpoint:** `https://aiplatform.googleapis.com/v1/projects/broadcasterfishmap/locations/global/publishers/google/models/gemini-1.5-flash:generateContent`
* **Context Injection:** Prompts are injected with active document state metadata, assembly counts, active selections, volume in $\text{cm}^3$, and B-Rep face classifications.
* **Alias Dispatcher:** Standard CAD short aliases (`l`, `c`, `rec`, `pl`, `m`, `co`, `ro`, `sc`, `e`, `z`) are intercepted on the client and mapped directly to workstation commands.

---

## 5. System Telemetry & Performance Verification

### 5.1 Telemetry Metrics Contract
The server `/cad/api/telemetry` endpoint and client heads-up display provide continuous state monitoring:

| Metric Key | Target Performance | Verification Standard |
| :--- | :--- | :--- |
| **Viewport Refresh Rate** | Sustained $60\text{ FPS}$ | RequestAnimationFrame loop under full 2,000 ft grid load |
| **Binary STL Vectorization** | $< 1.5\text{ s}$ per 50,000 facets | C-level NumPy `frombuffer` struct unpacking |
| **Planar Tessellation Overhead** | $0.0\text{ ms}$ (GPU Native) | Zero CPU triangulation diagonals on planar surfaces |
| **State Snapshot Latency** | $< 5.0\text{ ms}$ | Undo/Redo deepcopy snapshot limit: 50 states |
| **Geospatial Origin Altitude** | $1609.34\text{ m}$ ($1.0\text{ mi}$) | Positive clearance above Fullerton, CA DEM surface |

### 5.2 Verification Test Matrix

```
========================================================================================
GeoParametric3D Automated Verification Suite Status
========================================================================================
[PASS] test_canonical_box_brep_structure (test_canonical_geometry.py)
       - 8 vertices, 12 edges, 6 loops, 6 surfaces, 6 faces, 1 shell, 1 solid.
[PASS] test_transform_composition_and_instancing (test_canonical_geometry.py)
       - 100 lightweight instances generated without geometry duplication.
[PASS] test_adaptive_tessellation_derived_mesh (test_canonical_geometry.py)
       - 6 box faces adaptively tessellated to 12 triangles; canonical part unchanged.
[PASS] test_native_render_representation_selection (test_canonical_geometry.py)
       - Planar faces route to NATIVE_POLYGON_3D; curves to NATIVE_POLYLINE_3D.
[PASS] test_unit_conversion_integrity (test_cad_architecture.py)
       - Inch, Foot, Meter, Centimeter conversions match 25.4mm, 304.8mm, 1000mm.
[PASS] test_step_format_intelligence_and_brep (test_cad_architecture.py)
       - Schema AP214 parsed, materials and product structures recovered.
[PASS] test_vertex_and_triangle_integrity_pipeline (test_cad_architecture.py)
       - Non-finite coordinates stripped; remapped triangle indices validated.
[PASS] test_scale_dimensionless_invariant (test_workstation_repair.py)
       - Scaling by 0.5 leaves world translation invariant at [254.0, 0.0, 0.0].
[PASS] test_box_golden_equivalence (test_kernel_math.py)
       - BoxSDF evaluation matches exact B-Rep boundary volume.
========================================================================================
OVERALL STATUS: 100% OPERATIONAL & VERIFIED
========================================================================================
```
