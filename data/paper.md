# Architectural Specification: GeoParametric3D Geospatial B-Rep CAD Engine & Photorealistic Maps 3D Web Workstation

---

## 1. Executive Summary

GeoParametric3D is an authoritative engineering computer-aided design (CAD) workstation engineered directly within the web runtime. It unifies boundary representation (B-Rep) solid modeling with Google Maps 3D Photorealistic Tiles (`<gmp-map-3d>`). 

### 1.1 Core System Objectives
* **Authoritative B-Rep Mathematical Truth:** Strict separation of exact topological entities (`GeoAssembly`, `GeoPart`, `GeoSolid`, `GeoShell`, `GeoFace`, `GeoLoop`, `GeoEdge`, `GeoVertex`) from derived render meshes. Render meshes are strictly transient artifacts for visualization.
* **Geodetic & Cartesian Duality:** Full bidirectional synchronization between Cartesian Local Tangent Plane coordinates (East-North-Up / ENU in millimeters) and geospatial geodetic coordinates (WGS84 Latitude, Longitude, Ellipsoidal Altitude).
* **The Ground-Occlusion & Initial Render Invariant:** Resolves viewport clipping and terrain collision by anchoring the CAD world origin $(0, 0, 0)_{\text{ENU}}$ at **1.0 international mile ($1609.34\text{ m}$)** above Fullerton, California ($33.8704^\circ\text{ N}, -117.9242^\circ\text{ W}$). This ensures zero terrain clipping, complete visual clearance, and immediate rendering of canonical solids upon initialization.
* **Dual-Route Rendering Pipeline:** Planar analytical faces (`GeomAbs_Plane`) are mapped directly to native `<gmp-polygon-3d>` elements to eliminate triangulation diagonals. Curved/freeform surfaces undergo adaptive chordal and angular deflection meshing.
* **Autonomous Engineering Assistant:** Deep contextual integration with Google Cloud Vertex AI (`project: broadcasterfishmap`, `location: global`, model: `gemini-1.5-flash`) for natural-language topological queries, parametric scripting, and manufacturing toolpath digestion.

### 1.2 System Invariant Matrix

| Parameter / Subsystem | Invariant Specification | Verification Standard |
| :--- | :--- | :--- |
| **Canonical Internal Unit** | Metric linear millimeter ($\text{mm}$) | Single-point authoritative unit conversion across all imports/exports |
| **Geodetic Site Anchor** | $33.8704^\circ\text{ N}, -117.9242^\circ\text{ W}, 1609.34\text{ m}$ MSL | Fullerton, CA Geodetic Datum |
| **Default Primitive Dimension** | $1.0\text{ ft} = 12.0\text{ in} = 304.8\text{ mm}$ | Golden Box equivalence verification ($\Delta V < 10^{-4}\text{ mm}^3$) |
| **Planar Face Representation** | True N-Gon loops (outer wire + inner voids) | Rendered via `<gmp-polygon-3d>` with zero internal diagonals |
| **Curvature Deflection Limit** | $\theta_{\max} = 12.0^\circ$, Chordal tolerance $\delta = 0.05\text{ mm}$ | Adaptive linear/angular scaling based on bounding diagonal |
| **Shading Standard** | $100\%$ Opaque solid shading (FreeCAD parity) | Hardware depth buffer occlusion with explicit color inheritance |
| **Working Ground Grid** | $2,000\text{ ft} \times 2,000\text{ ft}$ ($609.6\text{ m}$) at $1.0\text{ ft}$ spacing | Adaptive stride decimation sustaining 60 FPS |
| **Vertex Numerical Safety** | Strict IEEE 754 finite coordinates ($-\infty < x, y, z < \infty$) | Rejection of NaN/Inf with `GeometryPipelineException` |

```
FOREIGN GEOMETRY PAYLOAD (STEP, FCStd, STL, OBJ, 3MF, GLTF, DAE, WRL, XBF)
       │
       ▼
[STAGE 1: BYTE & SCHEMA INTELLIGENCE] Magic bytes, SI_UNIT, CONVERSION_BASED_UNIT
       │
       ▼
[STAGE 2: KERNEL INGESTION & HEALING] TopoDS_Shape / OpenCASCADE C++ / WASM Engine
       │
       ▼
[STAGE 3: MULTI-SOLID DECOMPOSITION] ThreadPool multi-worker compound unpacking
       │
       ▼
[STAGE 4: DUAL-ROUTE CLASSIFICATION]
       ├─────────────────────────────────────────┐
       ▼ (GeomAbs_Plane)                         ▼ (Curved / Freeform NURBS)
[ROUTE A: PLANAR N-GON EXTRACTOR]         [ROUTE B: ADAPTIVE DEFLECTION ENGINE]
 Outer/Inner Wires, Zero Diagonals         Chordal $\delta=0.05\text{mm}$, Angular $\theta=12^\circ$
       │                                         │
       ├─────────────────────────────────────────┘
       ▼
[STAGE 5: CANONICAL GEOMETRY COMPACTION] GeoAssembly / GeoPart / GeoSolid Model Tree
       │
       ▼
[STAGE 6: GEOSPATIAL PROJECTION ENGINE] ENU Cartesian (mm) ──> WGS84 Geodetic
       │
       ├─────────────────────────────────────────┐
       ▼                                         ▼
[NATIVE MAPS 3D VIEWPORT]               [OVERLAY CANVAS ENGINE]
 `<gmp-map-3d>` Photorealistic Tiles     2,000-ft Ground Grid, Csnap Gizmos,
 `<gmp-polygon-3d>` Solid Facets         Marquee Box, Datum Coordinate Axes
```

---

## 2. Viewport & Grid Assembly

### 2.1 Geospatial Anchoring & Coordinate Systems
The workstation bridges two distinct spatial references:
1. **Local Tangent Plane (ENU Cartesian):** Right-handed orthogonal coordinate frame defined in linear millimeters ($\text{mm}$). $+X$ points East, $+Y$ points North, and $+Z$ points Up along the local ellipsoidal normal.
2. **Geodetic Coordinate Frame (WGS84):** Curvilinear coordinates defined by Latitude ($\phi$), Longitude ($\lambda$), and Altitude ($h$) in meters above the WGS84 reference ellipsoid ($a = 6378137.0\text{ m}, f = 1 / 298.257223563$).

#### Geodetic Translation Equations
Given geodetic anchor $(\phi_0, \lambda_0, h_0)$ where $\phi_0 = 33.8704^\circ$, $\lambda_0 = -117.9242^\circ$, $h_0 = 1609.34\text{ m}$, the radii of curvature in the prime vertical ($N$) and meridian ($M$) are computed as:

$$N(\phi_0) = \frac{a}{\sqrt{1 - e^2 \sin^2 \phi_0}}, \quad M(\phi_0) = \frac{a(1 - e^2)}{(1 - e^2 \sin^2 \phi_0)^{3/2}}$$

where $e^2 = 2f - f^2 \approx 0.00669437999014$. For a local ENU displacement $(x, y, z)$ in millimeters:

$$\Delta x_{\text{m}} = \frac{x}{1000.0}, \quad \Delta y_{\text{m}} = \frac{y}{1000.0}, \quad \Delta z_{\text{m}} = \frac{z}{1000.0}$$

$$\phi = \phi_0 + \left( \frac{\Delta y_{\text{m}}}{M(\phi_0) + h_0} \right) \cdot \frac{180}{\pi}$$

$$\lambda = \lambda_0 + \left( \frac{\Delta x_{\text{m}}}{(N(\phi_0) + h_0) \cos \phi_0} \right) \cdot \frac{180}{\pi}$$

$$h = h_0 + \Delta z_{\text{m}}$$

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

### 2.2 Dual-Layer Rendering Engine
The viewport architecture decouples dense photorealistic terrain from high-frequency CAD interaction:
* **Base Layer (`<gmp-map-3d>`):** Handles 3D Tiles rendering, atmospheric scattering, lighting, and GPU-driven hardware depth-buffering for solid faces via `<gmp-polygon-3d>`.
* **Overlay Layer (`<canvas id="viewport-overlay-canvas">`):** Pixel-perfect 2D/WebGL canvas hosting interactive elements:
  * Wireframe construction guides.
  * Csnap magnetic indicators (vertices, midpoints, edge trajectories).
  * Dynamic dimensioning strings and rubber-band drafting lines.
  * Selection marquees and transform gizmo overlays.

```
+-------------------------------------------------------------------------+
| TOP SLIDING TOOLBAR CONTAINER (79 Mapped CAD & Transform Tools)         |
+-------------------------------------------------------------------------+
| LEFT PANEL           | VIEWPORT CONTAINER              | RIGHT PANEL    |
| (Assembly Tree)      |  +---------------------------+  | (Properties &  |
|                      |  | Overlay Canvas (Csnap/HUD)|  |  Action Panel) |
|                      |  +---------------------------+  |                |
|                      |  | Native <gmp-map-3d>       |  |                |
|                      |  | Photorealistic 3D Tiles   |  |                |
|                      |  | <gmp-polygon-3d> Facets   |  |                |
|                      |  +---------------------------+  |                |
|                      |  | Spherical Trackball Gizmo |  |                |
+----------------------+---------------------------------+----------------+
| BOTTOM SLIDING ASSISTANT DRAWER (Vertex AI Context Gateway)            |
+-------------------------------------------------------------------------+
```

### 2.3 Extended Horizon Ground Grid & Datum Coordinate Frame
* **Grid Extent:** $2,000\text{ ft} \times 2,000\text{ ft}$ ($609,600\text{ mm} \times 609,600\text{ mm}$) centered on $(0, 0, 0)_{\text{ENU}}$.
* **Base Unit Spacing:** $1\text{ ft}$ ($304.8\text{ mm}$) major subdivisions.
* **Camera-Adaptive Stride:** To eliminate fill-rate bottlenecks when zoomed out, grid drawing adapts dynamically:

$$\text{Stride Multiplier} = \begin{cases} 
50 & \text{if } \text{Range} > 500\text{ m} \\
20 & \text{if } 150\text{ m} < \text{Range} \le 500\text{ m} \\
5 & \text{if } 50\text{ m} < \text{Range} \le 150\text{ m} \\
2 & \text{if } 20\text{ m} < \text{Range} \le 50\text{ m} \\
1 & \text{if } \text{Range} \le 20\text{ m}
\end{cases}$$

* **Datum Coordinate Axes:** Explicit RGB vector triplet rendered at origin:
  * $+X$ Axis: Red line (`#ef4444`), extending East along $[304.8, 0, 0]$.
  * $+Y$ Axis: Green line (`#10b981`), extending North along $[0, 304.8, 0]$.
  * $+Z$ Axis: Blue line (`#3b82f6`), extending Up along $[0, 0, 304.8]$.

### 2.4 Spherical Trackball Gizmo & Camera Dynamics
The viewport features a custom spherical trackball oriented in real time with the camera matrix:
* **Visual Presentation:** 115px SVG sphere with viridian radial gradient (`#40E0D0` $\to$ `#00A877` $\to$ `#004d40`), cyan neon glow ring (`#00f3ff`), and projected cardinal labels (`TOP`, `BOT`, `N`, `S`, `E`, `W`).
* **Camera Navigation Formulation:**
  * **Orbit:** Heading $\psi \in [0^\circ, 360^\circ)$, Tilt $\theta \in [1^\circ, 179^\circ]$ relative to the ground normal.
  * **Pan:** True planar screen-to-ENU projection converting pixel shifts $(\Delta x_{\text{px}}, \Delta y_{\text{px}})$ into ground-tangent translation vectors.
  * **Zoom / Fit Coverage:** The camera framing algorithm calculates the bounding sphere radius $R = \frac{1}{2} \sqrt{\Delta X^2 + \Delta Y^2 + \Delta Z^2}$ and sets the range to $D = \max(152.4\text{ mm}, 60.0 \cdot R)$, guaranteeing an optimal $60:1$ viewport-to-part ratio without near-plane clipping.

---

## 3. Kernel & B-Rep Translation

### 3.1 Authoritative B-Rep Separation & Hierarchy
GeoParametric3D enforces a strict topological structure modeled after OpenCASCADE ISO 10303 standards:

```
GeoAssembly (Root)
 └── GeoInstance (Transform 4x4, Name, Color, Opacity)
      └── GeoPart (Canonical Geometry Container, Units: mm)
           └── GeoSolid (Manifold 3D Volume)
                └── GeoShell (Closed Outer & Void Boundaries)
                     └── GeoFace (Parametric Surface Manifold)
                          ├── GeoSurface (Plane, Cylinder, Cone, Sphere, Torus, BSpline)
                          └── GeoLoop (Outer Boundary Wire & Inner Cutout Wires)
                               └── GeoEdge (Curve Segment Reference)
                                    ├── GeoCurve (Line, Circle, Arc, Ellipse, NURBS)
                                    ├── GeoVertex Start (Finite 3D Point)
                                    └── GeoVertex End (Finite 3D Point)
```

### 3.2 Dual-Route Classification & Planar N-Gon Dissolver
Standard CAD pipelines triangulate planar surfaces, causing visual diagonal artifacts across flat faces. GeoParametric3D uses a parallel dual-route face classification algorithm:

```python
def route_cad_faces(shape, scale=1.0, linear_deflection=0.5):
    planar_faces = []
    curved_faces = []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    
    while explorer.More():
        occ_face = TopoDS_Face_Cast(explorer.Current())
        adaptor = BRepAdaptor_Surface(occ_face)
        stype = adaptor.GetType()
        
        if stype == GeomAbs_Plane:
            wire_data = extract_clean_planar_wires(occ_face, scale, linear_deflection)
            pln = adaptor.Plane()
            norm = [pln.Axis().Direction().X(), pln.Axis().Direction().Y(), pln.Axis().Direction().Z()]
            planar_faces.append({
                "surface_type": "Plane",
                "normal": norm,
                "outer": wire_data["outer"],
                "inner": wire_data["inner"],
                "has_holes": len(wire_data["inner"]) > 0
            })
        else:
            curved_faces.append({"surface_type": str(stype), "occ_face": occ_face})
        explorer.Next()
        
    return planar_faces, curved_faces
```

* **Outer Wire Extraction:** Discretizes edges using `GCPnts_QuasiUniformDeflection` to accurately resolve curved boundaries on planar sheets (e.g. rounded tabs or bracket profiles).
* **Inner Wire Extraction:** Preserves interior loops for multi-connected cutout topologies (e.g. mounting holes or slots) and assigns them to `innerCoordinates` in `<gmp-polygon-3d>`.

### 3.3 Fast Ingestion, Multi-Format Intelligence & ThreadPool Worker Unpacking
The universal byte parser accepts heterogeneous CAD payloads and normalizes them into canonical millimeters:

| Format / Magic Bytes | Schema Detection | Parsing Strategy | Topological Recovery |
| :--- | :--- | :--- | :--- |
| **STEP / `ISO-10303-21`** | AP203, AP214, AP242 | OCCT C++/WASM Reader (`STEPControl_Reader`) | Exact B-Rep solid manifold extraction |
| **FreeCAD / `PK..Document.xml`** | FCStd ZIP Container | XML DOM Extraction + BRep shape decoding | Multi-body parametric feature tree |
| **STL (Binary & ASCII)** | Binary Header / `solid` | Vectorized NumPy Struct (`<3f3f3f3fH`) | Coplanar edge welding & connected components |
| **3MF / `PK..3dmodel.model`** | 3D Manufacturing Format | Zip archive XML XMLNS extraction | Multi-mesh instancing & color palette assignment |
| **GLTF / GLB / `glTF`** | JSON / Binary Buffer | Chunk-0 JSON + Chunk-1 Binary buffer slices | Indexed triangle mesh with unit conversion |
| **OBJ / Wavefront** | `v `, `f ` prefixes | Regex tokenizer + ear-clipping triangulator | Recovered part instance |
| **XBF (Binary B-Rep)** | `XBF1`, `XBF2` Magic | Structured binary buffer read | Direct zero-copy GPU memory mapping |

```python
def compute_optimal_deflection(diag_mm: float) -> Tuple[float, float]:
    """Calculates linear and angular deflection based on solid bounding extent."""
    if diag_mm > 5000.0:
        return max(2.5, diag_mm * 0.003), 0.65
    elif diag_mm > 1000.0:
        return max(1.0, diag_mm * 0.002), 0.52
    elif diag_mm > 200.0:
        return max(0.5, diag_mm * 0.002), 0.45
    return max(0.2, diag_mm * 0.003), 0.40
```

### 3.4 Numerical Compaction, Golden Box Equivalence & Signed Distance Fields
* **Signed Distance Field (SDF) Formulation:** Analytical evaluation verifies solid containment and boundary precision for primitives. For a box with dimensions $(w, d, h)$ centered at $(c_x, c_y, c_z)$:

$$p = \begin{bmatrix} |x - c_x| - \frac{w}{2} \\ |y - c_y| - \frac{d}{2} \\ |z - (c_z + \frac{h}{2})| - \frac{h}{2} \end{bmatrix}$$

$$G_{\text{Box}}(x, y, z) = \sqrt{\max(p_x, 0)^2 + \max(p_y, 0)^2 + \max(p_z, 0)^2} + \min(\max(p_x, \max(p_y, p_z)), 0)$$

* **Mesh Validation & Compaction:** Compacts raw vertex arrays by stripping `NaN`/`Inf` coordinates, pruning degenerate zero-area triangles ($A < 10^{-9}\text{ mm}^2$), and re-indexing valid facets via vectorized NumPy mappings.

---

## 4. UI & Assistant Components

### 4.1 Retractable Sliding Panels & Workstation Layout
* **Top Toolbar (`#top-slide-container`):** Three organized rows accommodating 79 mapped tools:
  * *Row 1:* Session management (`New`, `Open`, `Save`, `Import`, `Export`, `Undo`, `Redo`, `Preferences`), Social Share/Capture (`Snapshot`, `Snap+Bars`, `Record MP4`, `Share...`), and $12''$ Primitive builders (`Box`, `Cylinder`, `Sphere`, `Cone`, `Torus`, `Prism`, `Polygon`, `Ellipse`, `Wedge`, `Pyramid`, `Ellipsoid`, `Tube`, `Plane`).
  * *Row 2:* Direct Spatial Transformations (`Move`, `Rotate`, `Scale`, `Duplicate`, `Align`), 2D Draft Tools (`Line`, `Rectangle`, `Circle`, `Arc`, `Polyline`, `PolyDraft`, `EllipseDraft`), and Snap/Selection filters (`Csnap`, `Part`, `Face`, `Edge`, `Vertex`).
  * *Row 3:* Parametric Features (`Extrude`, `Cross Sections`, `Hole`, `Revolve`), Boolean Operations (`Union`, `Subtract`, `Intersect`), Surface Modifications (`Fillet`, `Chamfer`), and Inspection/Manufacturing (`Measure`, `Mass Properties`, `LinuxCNC G-Code`, `CadQuery Script`).
* **Left Panel (`#left-slide-container`):** Hierarchical Workspace Assembly Tree with nested expansion, selection synchronization, and visibility toggling.
* **Right Panel (`#right-slide-container`):** Dynamic Inspector & Action Panel providing real-time property bindings, material assignment with density tables ($7.85\text{ g/cm}^3$ Steel down to $0.50\text{ g/cm}^3$ Wood), sub-element selection badges, and a streaming system telemetry log.

### 4.2 Csnap Precision Snapping Engine
The Csnap engine resolves interactive cursor placement onto 3D CAD topology using a depth-ordered, normal-weighted candidate evaluator:

$$W(\text{candidate}) = \frac{1}{\text{dist}_{\text{px}} + \epsilon} \cdot \left( |\mathbf{n} \cdot \mathbf{v}_{\text{cam}}| + 0.1 \right)$$

* **Vertex Snapping:** Snaps to exact 3D vertices within a 16px radius, displaying a circular gold glyph (`#fbbf24`).
* **Edge Midpoint Snapping:** Computes and locks to the exact 3D midpoint of linear or circular boundary segments with a square gold glyph.
* **Bearing Edge Disambiguation:** Rejects back-facing occluded candidate edges where $\mathbf{n} \cdot \mathbf{v}_{\text{cam}} > 0.05$.

### 4.3 Google Cloud Vertex AI Engineering Assistant
The assistant subsystem establishes a direct link between the UI input dock and the Vertex AI model:
* **Context Ingestion:** Packages the active assembly state (body names, materials, volumetric properties, bounding boxes, and canonical dimensions) into the reasoning prompt.
* **Action Intent Dispatch:** Translates natural language engineering queries into structured CAD operations:
  * Standard CAD aliases (`L` $\to$ Line, `REC` $\to$ Rectangle, `C` $\to$ Circle, `M` $\to$ Move, `CO` $\to$ Duplicate, `RO` $\to$ Rotate, `SC` $\to$ Scale, `E` $\to$ Erase, `Z` $\to$ Zoom Fit).
  * Direct Python CadQuery script execution via the `/cad/api/command` gateway.
  * Industrial 3-axis LinuxCNC ISO G-code generation with configurable spindle speeds and feed rates.

```python
async def call_vertex_gemini(prompt: str, cad_context: dict = None) -> str:
    system_context = (
        f"You are the dedicated Engineering Assistant for GeoParametric3D "
        f"(Project: {PROJECT_ID}, Location: {LOCATION}).\n"
        "Provide substantive, technically precise engineering reasoning, CAD/CAM guidance, "
        "B-Rep topological insight, material selection, and mathematical derivations.\n"
        "B-Rep geometry is authoritative; render meshes are derived representations.\n"
        "Distinguish CAD topology from render artifacts."
    )
    # REST invocation targeting Google Cloud Vertex AI Publisher API
```

---

## 5. System Telemetry & Diagnostic Verification

### 5.1 Real-Time Performance & Pipeline Telemetry
The workstation continuously computes and broadcasts pipeline metrics:
* **Object & Vertex Count:** Real-time solid body tallies and active topological facet computations.
* **Frame Rate Monitoring:** Monitored viewport refresh rates (targeting sustained 60 FPS under active 3D Tiles streaming).
* **Geospatial Sync State:** Verification of Local-Tangent-Plane-to-WGS84 projection consistency.

### 5.2 End-to-End Test Suite Verification Matrix

```
========================================================================================
GEOPARAMETRIC3D COMPREHENSIVE ARCHITECTURAL VERIFICATION SUITE (ALL TESTS PASSING)
========================================================================================
Test Module                  Test Case                        Verified Invariant
----------------------------------------------------------------------------------------
test_canonical_geometry.py   test_canonical_box_brep_structure Pure B-Rep 6-face topology
                             test_transform_composition       Single part / multi-instance
                             test_adaptive_tessellation       Render buffer separation
                             test_native_representation       <gmp-polygon-3d> routing
                             test_finite_coordinate_validation NaN/Inf coordinate rejection
----------------------------------------------------------------------------------------
test_cad_architecture.py     test_unit_conversion_integrity   mm canonical normalization
                             test_import_bytes_universal      Format auto-detection
                             test_step_format_brep            STEP AP214 B-Rep recovery
                             test_step_curved_classification  Analytic cylinder extraction
                             test_vertex_triangle_integrity   Mesh compaction & cleaning
                             test_stl_topology_reconstruction Component assembly recovery
                             test_large_binary_stl_scaling    Vectorized C-speed parsing
                             test_primitive_import_equivalent Semantic CAD model parity
----------------------------------------------------------------------------------------
test_kernel_math.py          test_box_golden_equivalence      Golden Box SDF & volume match
                             test_prism_polygon_geometry      Exact polygonal cap math
                             test_box_sdf_distance_accuracy   Euclidean field evaluation
                             test_box_gradient_normals        Analytical gradient normals
                             test_scalar_field_booleans       Constructive field CSG
                             test_thickness_offset            Boundary dilation by tau
----------------------------------------------------------------------------------------
test_workstation_repair.py   test_scale_dimensionless_inv     Position unaffected by scale
                             test_xbf_bytes_roundtrip         Binary B-Rep model export
                             test_fcstd_container_inspect     FreeCAD ZIP container parse
========================================================================================
```

### 5.3 Hardware Acceleration & Deployment Architecture
* **ASGI Server Runtime:** Hypercorn serving asynchronous Quart endpoints supporting multi-gigabyte CAD payloads (`MAX_CONTENT_LENGTH = 1420 MB`).
* **WebAssembly Bridge (`WasmCADKernel`):** In-browser OpenCASCADE WebAssembly engine (`occtimportjs`) enabling zero-latency client-side STEP and FCStd parsing.
* **Production Deployment Configuration:**
  * Application Port: `5000` (Bound to `0.0.0.0`).
  * Primary Application Gateway: `/cad/` and `/GeoParametric3D/`.
  * Canonical API Routing: `/cad/api/` with legacy fallbacks for `/GeoParametric3D/api/`.
