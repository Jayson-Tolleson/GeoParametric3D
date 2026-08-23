# GeoParametric3D: Architectural Specification & Systems Design
**Governing Technical Architecture Document**
**Document Version:** 10.0.0-PROD  
**Target Runtime:** Google Maps 3D Web Component (`<gmp-map-3d>`), OpenCASCADE (OCCT/OCP), WebAssembly, Vertex AI

---

## 1. Executive Summary

GeoParametric3D is an engineering-grade Computer-Aided Design (CAD) workstation operating directly within a photorealistic geospatial environment. The system couples an exact Boundary Representation (B-Rep) solid modeling kernel with a dual-route rendering pipeline that maps analytical CAD topology to native Google Maps 3D custom elements (`<gmp-map-3d>`, `<gmp-polygon-3d>`, `<gmp-polyline-3d>`).

```
+---------------------------------------------------------------------------------------------------+
|                                  AUTHORITATIVE B-REP KERNEL                                       |
|  GeoAssembly -> GeoInstance -> GeoPart -> GeoSolid -> GeoShell -> GeoFace -> GeoLoop -> GeoEdge   |
+-------------------------------------------------+-------------------------------------------------+
                                                  |
                                                  v
                                    [Surface Classification]
                                                  |
                 +--------------------------------+--------------------------------+
                 |                                                                 |
                 v (GeomAbs_Plane)                                                 v (Analytical / Freeform)
+-------------------------------------------------+             +-----------------------------------+
|         PLANAR N-GON WIRE EXTRACTOR             |             |        ADAPTIVE TESSELLATOR       |
|  - Exact Outer & Inner Boundary Loops           |             |  - Chordal Deflection: δ ≤ 0.05mm  |
|  - Zero Internal Meshing Diagonals              |             |  - Angular Deflection: θ ≤ 12.0°  |
|  - WGS84 Geodetic Loop Normalization            |             |  - Compact Vertex/Normal Buffers  |
+------------------------+------------------------+             +-----------------+-----------------+
                         |                                                        |
                         +------------------------+-------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                CLIENT-SIDE HYBRID RENDER ENGINE                                   |
|  - Native <gmp-map-3d> & <gmp-polygon-3d> Hardware Shading (100% Opaque Solid)                   |
|  - Fullscreen Canvas Overlay for CSnap, Drag-Transformation Gizmos & Sub-element Selection        |
|  - Spherical Trackball Navigation & Real-Time Bi-directional Telemetry Synchronization           |
+---------------------------------------------------------------------------------------------------+
```

### 1.1 Core Architectural Invariants
* **Source Geometry $\neq$ Render Mesh:** Analytical B-Rep definitions remain authoritative. Triangular meshes are ephemeral, derived representations evaluated on demand.
* **Internal Canonical Millimeter Unit:** All linear dimensions, coordinates, and transformation matrices are normalized to standard millimeters ($1\text{ mm} = 1.0$) upon ingestion.
* **Geodetic Tangent Plane Anchorage:** Local Cartesian East-North-Up (ENU) coordinates are projected to WGS84 coordinates relative to the Fullerton Geodetic Origin Anchor ($33.8704^\circ\text{ N}, -117.9242^\circ\text{ W}, 1609.34\text{ m MSL}$).
* **Dual-Route Visual Pipeline:** Planar topological faces bypass triangulation sweeps entirely to eliminate diagonal visual artifacts and preserve true N-Gon boundaries.

---

## 2. Viewport & Grid Assembly

The client rendering surface is hosted by the `<gmp-map-3d>` custom element, supplemented by a synchronized 2D/WebGL canvas overlay.

```
+---------------------------------------------------------------------------------------------+
| Viewport Container (#viewport-container)                                                    |
|                                                                                             |
|  +---------------------------------------------------------------------------------------+  |
|  | <gmp-map-3d id="boatscreen">                                                          |  |
|  |   - Photorealistic 3D Tiles & Atmospheric Lighting                                     |  |
|  |   - <gmp-polygon-3d> Elements (100% Opaque Planar Faces & Cutout Holes)               |  |
|  |   - Altitude Mode: "absolute" / "relative-to-mesh"                                    |  |
|  +---------------------------------------------------------------------------------------+  |
|                                                                                             |
|  +---------------------------------------------------------------------------------------+  |
|  | <canvas id="viewport-overlay-canvas">                                                 |  |
|  |   - 2,000-ft Ground Grid (1-ft increments, dynamic level-of-detail stride)            |  |
|  |   - XYZ Coordinate Axes (Red=+X, Green=+Y, Blue=+Z)                                    |  |
|  |   - Continuous Edge & Sub-element Highlight Rendering                                 |  |
|  |   - CSnap Midpoint & Vertex Snapping Glyph Overlays                                   |  |
|  |   - Box-Selection Marquee & Dynamic Dimension Rubber-bands                             |  |
|  +---------------------------------------------------------------------------------------+  |
|                                                                                             |
|  +--------------------------------------------------+                                       |
|  | Spherical Trackball Gizmo (#viewcube-wrapper)     |                                       |
|  |   - Viridian Gradient Core with Cyan Glow Ring    |                                       |
|  |   - Direct Orthographic Axis Snapping (FIT/ISO)  |                                       |
|  +--------------------------------------------------+                                       |
+---------------------------------------------------------------------------------------------+
```

### 2.1 Coordinate Frame Transformations

The transformation between local ENU Cartesian coordinates $\mathbf{P}_{\text{ENU}} = [x, y, z]^T$ (in mm) and geodetic coordinates $[\phi, \lambda, h]^T$ (Latitude, Longitude, Altitude in meters MSL) uses the WGS84 reference ellipsoid parameters:
* Semi-major axis: $a = 6,378,137.0\text{ m}$
* Reciprocal flattening: $1/f = 298.257223563$
* First eccentricity squared: $e^2 = 2f - f^2 = 0.00669437999014$

$$\begin{aligned}
N(\phi_0) &= \frac{a}{\sqrt{1 - e^2 \sin^2 \phi_0}}, \quad
M(\phi_0) = \frac{a(1 - e^2)}{(1 - e^2 \sin^2 \phi_0)^{3/2}} \\
\phi &= \phi_0 + \left(\frac{y / 1000}{M(\phi_0) + h_0}\right) \cdot \frac{180}{\pi} \\
\lambda &= \lambda_0 + \left(\frac{x / 1000}{(N(\phi_0) + h_0)\cos \phi_0}\right) \cdot \frac{180}{\pi} \\
h &= h_0 + \frac{z}{1000}
\end{aligned}$$

### 2.2 Camera Projection & Screen Transformation
The client-side orthographic/perspective camera projects ENU points $[x, y, z]^T$ onto 2D screen coordinates $[p_x, p_y]^T$:

$$\begin{bmatrix} r_x \\ r_y \\ r_z \end{bmatrix} = \mathbf{R}_z(-\theta_H) \begin{bmatrix} x \\ y \\ z \end{bmatrix}, \quad
\begin{bmatrix} p_x' \\ p_y' \\ d \end{bmatrix} = \begin{bmatrix} r_x \\ -(r_y \cos \theta_T + r_z \sin \theta_T) \\ r_y \sin \theta_T - r_z \cos \theta_T \end{bmatrix}$$

$$p_x = \frac{W}{2} + \text{pan}_x + p_x' \cdot S_{\text{zoom}}, \quad p_y = \frac{H}{2} + \text{pan}_y + p_y' \cdot S_{\text{zoom}}$$

Where $\theta_H$ is camera heading, $\theta_T$ is tilt angle, $S_{\text{zoom}} = \frac{3000}{R_{\text{range}}} \cdot 3.5$, and $[W, H]$ are viewport dimensions.

### 2.3 CSnap Intelligent Snapping & Disambiguation
CSnap computes candidate points from active geometry:
1. **Vertex Snaps:** Evaluated directly from topological `GeoVertex` nodes.
2. **Midpoint Snaps:** Evaluated along bounding edge segments: $\mathbf{M} = \frac{\mathbf{v}_1 + \mathbf{v}_2}{2}$.
3. **Normal-Weighted Selection Filter:** Resolves edge/vertex occlusions using the camera view vector $\mathbf{V}_{\text{cam}}$:

$$W_{\text{snap}} = \frac{1}{\|\mathbf{P}_{\text{screen}} - \mathbf{M}_{\text{screen}}\| + \epsilon} \cdot \left(|\mathbf{N}_{\text{face}} \cdot \mathbf{V}_{\text{cam}}| + 0.1\right)$$

Candidates with $(\mathbf{N}_{\text{face}} \cdot \mathbf{V}_{\text{cam}}) > 0.05$ (back-facing) are culled.

---

## 3. Kernel & B-Rep Translation

The geometric backend integrates OpenCASCADE (OCCT) with a pure-Python semantic B-Rep graph and signed distance field (SDF) evaluators.

### 3.1 Authoritative B-Rep Topological Hierarchy

| Entity Type | Mathematical Definition | Child References | Schema Role |
| :--- | :--- | :--- | :--- |
| `GeoAssembly` | Root scenegraph container | `GeoInstance[]`, `GeoPart[]` | Hierarchical assembly tree |
| `GeoInstance` | Rigid placement: $\mathbf{T} \in \text{SE}(3)$ (4x4 matrix) | `GeoPart.id` | Lightweight instancing |
| `GeoPart` | Manifold part definition | `GeoSolid[]`, `GeoShell[]` | Geometric container |
| `GeoSolid` | Closed volume: $\partial V = \sum \text{Shell}_i$ | `GeoShell` (outer, voids) | 3D solid entity |
| `GeoShell` | Connected 2-manifold surface | `GeoFace[]` | Topological skin |
| `GeoFace` | Trimmed surface patch $S(u,v)$ | `GeoSurface`, `GeoLoop[]` | Authoritative face |
| `GeoLoop` | Closed boundary loop $L = \sum \mathbf{e}_i$ | `GeoEdge[]` (ordered) | Outer/inner wire |
| `GeoEdge` | 1D curve segment $C(t), t \in [t_0, t_1]$ | `GeoCurve`, `GeoVertex[2]`| Bounding curve |
| `GeoVertex` | 0D point $\mathbf{P} \in \mathbb{R}^3$ | None | Point coordinate |

```
                +-------------------------+
                |       GeoAssembly       |
                +------------+------------+
                             | 1..*
                +------------v------------+
                |       GeoInstance       |  (Stores 4x4 Affine Transform Matrix)
                +------------+------------+
                             | References
                +------------v------------+
                |         GeoPart         |
                +------------+------------+
                             | 1..*
                +------------v------------+
                |        GeoSolid         |
                +------------+------------+
                             | 1 (Outer Shell) + 0..* (Void Shells)
                +------------v------------+
                |        GeoShell         |
                +------------+------------+
                             | 1..*
                +------------v------------+
                |         GeoFace         |  (Bound to Analytic GeoSurface)
                +------------+------------+
                             | 1 (Outer Loop) + 0..* (Inner Loops)
                +------------v------------+
                |         GeoLoop         |
                +------------+------------+
                             | 1..* (Ordered & Oriented)
                +------------v------------+
                |         GeoEdge         |  (Bound to Analytic GeoCurve)
                +------------+------------+
                             | 2 (Start & End)
                +------------v------------+
                |        GeoVertex        |  (Exact Cartesian Coordinates [X, Y, Z])
                +-------------------------+
```

### 3.2 Dual-Route Classification & Tessellation Engine

Every topological face in an imported or constructed shape is classified:

```python
# occ_kernel.py face classification logic
def route_cad_faces(shape, scale=1.0, linear_deflection=0.5):
    planar_faces = []
    curved_faces = []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        occ_face = TopoDS_Face_Cast(explorer.Current())
        adaptor = BRepAdaptor_Surface(occ_face)
        if adaptor.GetType() == GeomAbs_Plane:
            wire_data = extract_clean_planar_wires(occ_face, scale, linear_deflection)
            planar_faces.append(wire_data)
        else:
            curved_faces.append(occ_face)
        explorer.Next()
    return planar_faces, curved_faces
```

#### Deflection Scaling Function
To balance visual fidelity against polygon counts on curved surfaces, deflection values are dynamically scaled based on the bounding box diagonal $D_{\text{diag}}$:

$$\delta_{\text{linear}} = \begin{cases} 
\max(2.5, D_{\text{diag}} \cdot 0.003) & D_{\text{diag}} > 5000\text{ mm} \\
\max(1.0, D_{\text{diag}} \cdot 0.002) & 1000 < D_{\text{diag}} \le 5000\text{ mm} \\
\max(0.5, D_{\text{diag}} \cdot 0.002) & 200 < D_{\text{diag}} \le 1000\text{ mm} \\
\max(0.2, D_{\text{diag}} \cdot 0.003) & D_{\text{diag}} \le 200\text{ mm}
\end{cases}, \quad
\theta_{\text{angular}} = \begin{cases}
0.65\text{ rad} & D_{\text{diag}} > 5000\text{ mm} \\
0.52\text{ rad} & 1000 < D_{\text{diag}} \le 5000\text{ mm} \\
0.45\text{ rad} & 200 < D_{\text{diag}} \le 1000\text{ mm} \\
0.40\text{ rad} & D_{\text{diag}} \le 200\text{ mm}
\end{cases}$$

### 3.3 Universal Ingestion Normalization & Unit Parsing

The import gateway (`universal_byte_parser.py`) provides structured ingestion across 10 file formats:

| Format / Schema | Magic Bytes / Header Signature | Parser Routing | Color & Material Ingestion |
| :--- | :--- | :--- | :--- |
| **STEP (AP203/214/242)** | `ISO-10303-21;`, `HEADER;` | `parse_step_with_occt` | `COLOUR_RGB`, `XCAFDoc_ColorTool` |
| **FreeCAD (.FCStd)** | `PK\x03\x04` + `Document.xml` | `parse_fcstd` | Per-object XML presentation |
| **XBF (Binary B-Rep)** | `XBF1`, `XBF2`, `XBFA` | `parse_xbf` | Direct RGBA 32-bit float record |
| **Binary STL** | 80-byte header + `uint32` count | `parse_stl_with_topology` | Fallback component palette |
| **ASCII STL** | `solid <name>` ... `facet normal`| `parse_stl_with_topology` | Reconstructed manifold topology |
| **Wavefront (.OBJ)** | `v `, `vn `, `f ` | `parse_obj` | Sub-mesh grouping / MTL bindings |
| **glTF / GLB** | `glTF\x02\x00\x00\x00` | `parse_gltf_glb` | PBR material metallic-roughness |
| **3D Manufacturing (.3MF)**| `PK\x03\x04` + `3dmodel.model` | `parse_3mf` | XML mesh color attributes |
| **Polygon File (.PLY)** | `ply\nformat (ascii\|binary)` | `parse_ply` | Custom element float properties |
| **COLLADA (.DAE)** | `<?xml` + `<COLLADA>` | `parse_dae` | Phong / Lambert color profiles |

#### Unit Normalization Factors
Unit strings detected in STEP headers (`LENGTH_UNIT`, `SI_UNIT`, `CONVERSION_BASED_UNIT`) are converted to canonical internal millimeters:

$$s_{\text{unit}} = \begin{cases}
1.0 & \text{"mm", "millimeter"} \\
10.0 & \text{"cm", "centimeter"} \\
1000.0 & \text{"m", "meter"} \\
25.4 & \text{"in", "inch"} \\
304.8 & \text{"ft", "foot"} \\
914.4 & \text{"yd", "yard"} \\
0.001 & \text{"um", "micron"}
\end{cases}, \quad \mathbf{P}_{\text{canonical}} = \mathbf{P}_{\text{raw}} \cdot s_{\text{unit}}$$

---

## 4. UI & Assistant Components

The interface employs a three-sided retracting panel architecture centered around the CAD viewport.

```
+----------------------------------------------------------------------------------------------------+
| TOP PANEL: Retractable Session, 12" Primitives, Transform, Draft, Features & Inspect Toolbars      |
| [New] [Open] [Save] [Import] [Export] | [Box] [Cylinder] [Sphere] [Prism] | [Move] [Rotate] [Scale] |
+----------------------------------------------------------------------------------------------------+
| LEFT PANEL:                    | MAIN 3D VIEWPORT:                             | RIGHT PANEL:      |
| Assembly Scenegraph            |                                               | Properties & Info |
|                                |   <gmp-map-3d> Photorealistic Terrain         |                   |
| 📁 Assembly                    |   + Native <gmp-polygon-3d> Solids            | Name: Bracket_01  |
|   └── ⚙️ Part_1                |   + 2,000-ft Local Ground Grid                | Mat: Steel A36    |
|       └── 🛡️ Shell_1           |   + Sub-element Selection Canvas              | Pos: [0, 0, 0] mm |
|           ├── ▱ Face_1         |   + Spherical Trackball ViewCube              | Vol: 28316.85 cm³ |
|           └── ▱ Face_2         |                                               | Mass: 222.28 kg   |
|                                |                                               |                   |
|                                |                                               | [Action Form]     |
+--------------------------------+-----------------------------------------------+-------------------+
| BOTTOM DRAWER: Vertex AI Engineering Assistant & LinuxCNC ISO G-Code Engine                        |
| [Prompt: "Extrude face 3 by 25.4mm and generate toolpath"] [Send Prompt]                          |
+----------------------------------------------------------------------------------------------------+
```

### 4.1 Master Button Matrix (79 Registered Hardware Actions)

| Subsystem | Count | Action Identifiers | Primary Contract |
| :--- | :--- | :--- | :--- |
| **Session & File I/O** | 8 | `toolbar-new`, `toolbar-open`, `toolbar-save`, `toolbar-import`, `toolbar-export`, `toolbar-undo`, `toolbar-redo`, `toolbar-prefs` | Document serialization, storage snapshot restore, modal preferences |
| **Capture & Social** | 4 | `btn-share-snapshot`, `btn-share-snapshot-all`, `btn-share-record`, `btn-open-share-modal` | Offscreen viewport PNG render, 60s MediaRecorder WebM/MP4 capture |
| **Primitives (12")** | 13 | `btn-add-box`, `btn-add-cylinder`, `btn-add-sphere`, `btn-add-cone`, `btn-add-torus`, `btn-add-prism`, `btn-add-polygon`, `btn-add-ellipse`, `btn-add-wedge`, `btn-add-pyramid`, `btn-add-ellipsoid`, `btn-add-tube`, `btn-add-plane` | Parametric primitive instantiation ($304.8\text{ mm}$ default) |
| **Transform** | 5 | `toolbar-move`, `toolbar-rotate`, `toolbar-scale`, `toolbar-duplicate`, `toolbar-align` | Matrix multiplication, delta translation, scale invariants |
| **2D Drafting** | 7 | `btn-draft-line`, `btn-draft-rect`, `btn-draft-circle`, `btn-draft-arc`, `btn-draft-polyline`, `btn-draft-polygon`, `btn-draft-ellipse` | Coordinate unprojection on construction planes, rubber-band preview |
| **Selection Modes** | 5 | `btn-toggle-csnap`, `btn-sel-part`, `btn-sel-face`, `btn-sel-edge`, `btn-sel-vertex` | Topology hit testing, CSnap glyph targeting, ray-polygon tests |
| **Solid Features** | 4 | `btn-feat-extrude`, `btn-feat-cross-sections`, `btn-feat-hole`, `btn-feat-revolve` | Feature history records, parametric distance extrusions |
| **Booleans** | 3 | `btn-bool-union`, `btn-bool-sub`, `btn-bool-intersect` | CSG boolean operations, tool body subtraction |
| **Modifications** | 2 | `btn-mod-fillet`, `btn-mod-chamfer` | Edge blending and chamfer history attachment |
| **Inspection & CAM** | 4 | `btn-insp-measure`, `btn-insp-mass`, `btn-tool-cnc`, `btn-tool-script` | Physical properties, mass matrix, LinuxCNC G-Code, CadQuery runner |
| **Panel Sliders** | 3 | `btn-top-retract`, `btn-left-retract`, `btn-right-retract` | Accordion CSS transforms, layout lock state |
| **Modal Controls** | 19 | `btn-close-*`, `btn-commit-*`, `btn-save-*`, `btn-digest-cnc`, `btn-run-script`, `btn-download-gcode` | Dialog dispatchers, script runtime hooks, file builders |
| **AI Assistant** | 2 | `btn-toggle-assistant`, `btn-send-assistant` | Cloud Vertex AI Gemini chat endpoint gateway |

### 4.2 Vertex AI Engineering Assistant Integration
The Assistant establishes bi-directional context between conversational prompts and CAD state:
* **Host Project:** `broadcasterfishmap`
* **Location:** `global`
* **Model:** `gemini-1.5-flash`
* **Context Payload:** Serialized `GeoAssembly` hierarchy, bounding extents, surface classifications, material specs, and active selection tokens.
* **Execution Pathway:** Structured JSON action intents (`create_primitive`, `feature_extrude`, `execute_script`) are returned from the assistant and executed by the client `CommandDispatcher`.

### 4.3 CNC Toolpath & G-Code Post-Processor
The manufacturing subsystem emits standard LinuxCNC ISO 6983 G-code directly from geometric boundaries:

```gcode
(LinuxCNC ISO G-Code — Generated for Workpiece_01)
G21 G90 G64 P0.01 (Metric mm, Absolute Distance, Path Contouring)
G17 (XY Circular Interpolation Plane)
M3 S12000 (Spindle On CW)
G0 Z35.00 (Rapid to Clearance Plane)
G0 X-152.40 Y-152.40
G1 Z0.00 F600.0 (Feed Plunge)
G1 X152.40 Y-152.40 F1200.0 (Linear Contour Cut)
G1 X152.40 Y152.40
G1 X-152.40 Y152.40
G1 X-152.40 Y-152.40
G0 Z35.00
M5 (Spindle Off)
M30 (Program End)
```

---

## 5. System Telemetry

GeoParametric3D maintains runtime metrics across geometric processing, network serialization, and rendering subsystems.

```
+------------------------------------------------------------------------------------+
|                              SYSTEM TELEMETRY ENGINE                               |
+--------------------------+--------------------------+------------------------------+
| Memory & Topology Stats  | Performance Metrics      | Geospatial Verification      |
| - Total Parts: 1         | - Viewport FPS: 60       | - Status: SYNCHRONIZED       |
| - Total Vertices: 24     | - Latency: 1.2ms         | - Anchor: Fullerton (Mile 1) |
| - Planar N-Gons: 6       | - Heap Slices: Zero-Copy | - Datum: WGS84 Geoid         |
+--------------------------+--------------------------+------------------------------+
```

### 5.1 Telemetry Reporting Schema

```json
{
  "system": "GeoParametric3D Workstation",
  "version": "10.0.0-PROD",
  "status": "READY",
  "fps": 60,
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
  "vertices": 24,
  "shading": {
    "mode": "100% Opaque Solid",
    "default_opacity": 1.0,
    "depth_test": true
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

### 5.2 Numerical Validation & Quality Assurance Thresholds

```
[Raw Byte Payload] 
       │
       ▼
[Finite Coordinates Validation] ──(NaN / ±Inf Detected)──► [GeometryPipelineException::CANONICALIZATION]
       │ (PASS)
       ▼
[Degenerate Triangle Filter] ────(Area < 1e-9 mm²)──────► [Prune Triangle & Log Diagnostic]
       │ (PASS)
       ▼
[Winding Determinant Check] ─────(Det(M) < 0)───────────► [Invert Triangle Vertex Index Remap: (0, 2, 1)]
       │ (PASS)
       ▼
[Geodetic Projection Buffer] ───(Offset > 100km)────────► [Geospatial Precision Warning]
       │ (PASS)
       ▼
[<gmp-polygon-3d> Assembly]
```

* **Maximum Permissible Chord Error ($\epsilon_{\text{chord}}$):** $0.05\text{ mm}$
* **Planar Normal Grouping Tolerance ($\epsilon_{\text{normal}}$):** $10^{-4}\text{ rad}$
* **Manifold Face Area Floor ($\epsilon_{\text{area}}$):** $10^{-9}\text{ mm}^2$
* **Matrix Inversion Invariance:** For any $\mathbf{T} \in \text{SE}(3)$, $\det(\mathbf{T}) = 1.0 \pm 10^{-6}$. Inversions with $\det(\mathbf{T}) < 0$ trigger winding re-orientation $(v_0, v_1, v_2) \to (v_0, v_2, v_1)$ to guarantee counter-clockwise face normals.
* **Coordinate Sanity Bound ($M_{\text{coord}}$):** Values $|x|, |y|, |z| > 10^{10}\text{ mm}$ are rejected to prevent camera frustum clipping degradation.
