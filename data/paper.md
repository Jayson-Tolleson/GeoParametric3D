# Master Architectural Specification & System Engineering Report
**GeoParametric3D: Authoritative Boundary-Representation (B-Rep) CAD/CAM Architecture with Native Google Maps 3D Integration & Vertex AI Intelligence**

---

## 1. Executive Summary & Core Architectural Invariants

GeoParametric3D represents a next-generation cloud-native computer-aided design (CAD) workstation engineered to bridge analytical solid modeling (OpenCASCADE / B-Rep) with real-world geospatial visualization (`<gmp-map-3d>`). 

### The Immutable Invariants
1. **The Source Geometry is NOT the Render Mesh:** Analytical B-Rep topology (`GeoSolid` $\rightarrow$ `GeoShell` $\rightarrow$ `GeoFace` $\rightarrow$ `GeoLoop` $\rightarrow$ `GeoEdge` $\rightarrow$ `GeoVertex`) constitutes the immutable single source of geometric truth. Polygonal tessellations and triangular approximations are strictly derived, ephemeral rendering representations.
2. **Canonical Internal Linear Millimeter ($mm$):** All internal spatial representations, bounding boxes, inertia tensors, transformation matrices, and physics calculations are strictly executed in millimeters ($mm$). Conversions to and from source file units (e.g., inches, feet, meters, centimeters) and user display preferences (US/Imperial vs. Metric) occur exclusively at input ingestion and output presentation boundaries.
3. **Dual-Route Surface Routing & True N-Gon Preservation:** Planar topological faces (`GeomAbs_Plane`) are never degraded into triangular approximations with visible diagonals. They are extracted as clean boundary wire loops (outer perimeter + inner void cutouts) and rendered directly as native `<gmp-polygon-3d>` planar polygons. Analytical curved surfaces (cylinders, cones, spheres, tori, NURBS) undergo adaptive chordal and angular deflection tessellation.
4. **100% Opaque Solid Shading & Depth Coherence:** Solid bodies default to 100% opacity with hardware depth buffer occlusion, preventing ghosting, internal diagonal leakage, or translucent artifacts unless intentionally designated by the user.
5. **True Bearing Edge & Cursor Snapping (Csnap):** Geometric picking must compute the exact bearing edge of pointer contact via point-to-segment Euclidean projection rather than greedy bounding box overlap.
6. **Conversational Vertex AI Assistant:** Contextual engineering intelligence operating directly on live CAD B-Rep assembly metadata under Google Cloud Project `broadcasterfishmap` (Location: `global`).

---

## 2. Rendering Subsystem & Face Geometry Diagnostics

### 2.1 Diagnostic of Translucent / Clear Artifacts
In legacy CAD-to-WebGL pipelines, rendering artifacts where solid models appear hollow, translucent, or wireframe-like occur due to three distinct root causes:
1. **Premature Decimation and Diagonal Artifacts:** Incremental meshing sweeps (`BRepMesh_IncrementalMesh`) generate diagonal chords across flat faces. When rendering flat surfaces with semi-transparent shaders or double-sided triangle rasterization without polygon offset, z-fighting and translucent edge bleeding occur.
2. **Alpha-Blending Default Conflicts:** Default canvas stroke/fill styles using RGBA channels with alpha $< 1.0$ cause depth-buffer writing to be disabled or blended incorrectly, revealing rear faces through front faces.
3. **Missing Face Coordinate Arrays:** When importing complex multi-solid STEP or FCStd models, failure to project all face coordinates into WGS84 Geodetic format (`lat`, `lng`, `altitude`) anchored at `SITE_ANCHOR` results in missing `<gmp-polygon-3d>` elements, forcing the viewport to fall back onto wireframe outlines.

### 2.2 Dual-Route Face Extraction Architecture
To resolve this permanently, `universal_byte_parser.py` and `occ_kernel.py` implement an automated dual-route classification pipeline:

```
                  AUTHORITATIVE TopoDS_Shape / GeoPart
                                   |
               +-------------------+-------------------+
               |                                       |
               v                                       v
     [GeomAbs_Plane Detected]                [Curved Surface Detected]
               |                                       |
               v                                       v
    extract_clean_planar_wires()             Adaptive Deflection Meshing
    - Outer Loop Wires                       - GCPnts_QuasiUniformDeflection
    - Inner Hole Cutout Wires                - Linear Deflection: max(0.2, D*0.002)
    - Zero Triangle Diagonals                - Angular Deflection: 12.0 deg
               |                                       |
               v                                       v
    <gmp-polygon-3d> Elements                Hardware Depth Buffer Shading
    - 100% Solid Color                       - 100% Opaque Solid Material
    - Outer + Inner Coordinates              - Exact Normal Vector Buffers
```

---

## 3. Unit System & Authoritative Coordinate Normalization

### 3.1 Source Ingestion Unit Resolution
Incoming CAD bytes are automatically scanned across headers and metadata schemas to extract the authoritative scale factor relative to the canonical internal millimeter ($mm$):

| Format / Schema | Unit Entity / Header Signature | Scale Factor to Canonical ($mm$) |
| :--- | :--- | :--- |
| **STEP (AP203/214/242)** | `SI_UNIT(.MILLI., .METRE.)` | $1.0$ |
| **STEP (AP203/214/242)** | `SI_UNIT($, .METRE.)` / `SI_UNIT(*, .METRE.)` | $1000.0$ |
| **STEP (AP203/214/242)** | `SI_UNIT(.CENTI., .METRE.)` | $10.0$ |
| **STEP (AP203/214/242)** | `CONVERSION_BASED_UNIT('INCH', ...)` / `25.4` | $25.4$ |
| **STEP (AP203/214/242)** | `CONVERSION_BASED_UNIT('FOOT', ...)` | $304.8$ |
| **GLTF / GLB / DAE** | Asset Schema Standard (Meters) | $1000.0$ |
| **3MF / FCStd** | XML Metric Standard ($mm$) | $1.0$ |
| **STL / OBJ / PLY** | Unitless (Adaptive Extent Inspection) | Metric/Imperial Adaptive Scale |

### 3.2 Viewport Preference Standard (US/Imperial vs. Metric)
* **Imperial Preference (`in` / `ft`):** Viewport displays all dimensions, positions, and grid lines in inches and feet (e.g., $12''$ primitives, $1'$ reference grid), while transforming user inputs to linear $mm$ via $v_{mm} = v_{in} \times 25.4$.
* **Metric Preference (`mm` / `m`):** Viewport displays dimensions directly in millimeters or meters with $300mm$ reference grid steps.
* **Scale Dimensionless Invariance:** Scaling an object transforms its local geometric extents while preserving its world position vector $[X, Y, Z]$ identically.

---

## 4. Cursor Snapping (Csnap) & Bearing Edge Precision Subsystem

### 4.1 Root Cause of Spurious Edge Selection
Cursor snapping previously suffered from greedy 2D bounding box tests and centroid distance metrics, which caused clicks near one edge of a polygon to inadvertently select an opposite or diagonal edge.

### 4.2 Exact Point-to-Segment Projection Formulation
For every projected screen edge segment $S = \mathbf{p}_1 \rightarrow \mathbf{p}_2$ and mouse pointer coordinate $\mathbf{p}_m = [x_m, y_m]$:

1. Compute the squared segment length:
   $$L^2 = (x_2 - x_1)^2 + (y_2 - y_1)^2$$
2. Project the cursor point onto the parametric edge axis:
   $$t = \max\left(0, \min\left(1, \frac{(\mathbf{p}_m - \mathbf{p}_1) \cdot (\mathbf{p}_2 - \mathbf{p}_1)}{L^2}\right)\right)$$
3. Calculate the closest projection point $\mathbf{p}_c$:
   $$\mathbf{p}_c = \mathbf{p}_1 + t(\mathbf{p}_2 - \mathbf{p}_1)$$
4. Compute the Euclidean distance:
   $$d = \|\mathbf{p}_m - \mathbf{p}_c\| = \sqrt{(x_m - x_c)^2 + (y_m - y_c)^2}$$
5. The bearing edge is selected if and only if $d \le d_{\text{threshold}}$ (typically $10\,\text{px}$) and $d$ is minimal across all active candidate edges.

---

## 5. Workstation Toolbar Architecture & Button Wiring (79 Buttons)

The workstation interface is partitioned into five functional clusters with full two-way state binding and undo/redo snapshot capture:

```
+---------------------------------------------------------------------------------------------------+
| ROW 1: SESSION (New, Open UUID, Save UUID, Universal Import, Export, Undo, Redo, Preferences)     |
|        SHARE & CAPTURE (Snapshot, Snap+Bars, Record MP4, Share Modal)                             |
|        12" PRIMITIVES (Box, Cylinder, Sphere, Cone, Torus, Prism, Polygon, Ellipse, Wedge, Tube) |
+---------------------------------------------------------------------------------------------------+
| ROW 2: TRANSFORM (Move..., Rotate..., Scale..., Duplicate..., Align...)                           |
|        DRAFT TOOLS (Line, Rectangle, Circle, Arc, Polyline, PolyDraft, EllipseDraft)              |
|        SNAP & SELECTION (Csnap Toggle, Select Part, Select Face, Select Edge, Select Vertex)      |
+---------------------------------------------------------------------------------------------------+
| ROW 3: FEATURES (Extrude..., Cross Sections..., Hole..., Revolve...)                              |
|        BOOLEAN (Union, Subtract, Intersect)                                                       |
|        MODIFY (Fillet..., Chamfer...)                                                             |
|        INSPECT & CNC (Measure, Mass Properties, LinuxCNC G-Code Digest, Python CAD Scripting)     |
+---------------------------------------------------------------------------------------------------+
```

---

## 6. AI Engineering Assistant & Vertex AI Cloud Integration

### 6.1 Vertex AI Gateway Configuration
* **Project ID:** `broadcasterfishmap`
* **Location:** `global`
* **Model:** `gemini-1.5-flash` / `gemini-1.5-pro`
* **Authentication:** Google Cloud Application Default Credentials (`google.auth`) with fallback to bearer token or direct REST API invocation.

### 6.2 Contextual Prompt Engineering
The engineering assistant receives real-time topological B-Rep context on every query:
* Active assembly part count, names, and UUIDs.
* Material designations, volume ($cm^3$), and calculated mass ($g$ / $kg$).
* Authoritative bounding box extents in canonical $mm$.
* Currently selected Face ID, Surface Type (Plane, Cylinder, Sphere), and outward unit normal vector.

### 6.3 UI Ergonomics
The assistant drawer is positioned at the bottom center of the workspace with a collapsible toggle button (`▲` to expand, `▼` to collapse), allowing interactive modeling queries without obstructing the 3D viewport.

---

## 7. Mathematical Verification & Test Matrix

| Test Suite | Target Sections | Verification Objective |
| :--- | :--- | :--- |
| `test_canonical_geometry.py` | Sections 1–30 | B-Rep data structure integrity, GeoTransform composition, adaptive tessellation derivation, representation selectors. |
| `test_cad_architecture.py` | Sections 1–60 | STEP AP203/214/242 structured import, unit conversion precision, finite coordinate validation, degenerate rejection. |
| `test_kernel_math.py` | Sections 1–25 | Box SDF golden equivalence, CSG scalar field booleans (union, intersection, difference), offset dilation. |
| `test_workstation_repair.py` | Sections 1–42 | Scale dimensionless invariance ($P_{\text{after}} == P_{\text{before}}$), XBF roundtrip, FCStd container decompression. |

--- 
*End of Master Architectural Specification.*
