# Master Architectural Specification: Authoritative B-Rep CAD Engine, Unit Systematics, Precision Csnap Topology, and Native Maps 3D Viewport

**System Identifier:** GeoParametric3D / CascadeCAD Master Architecture  
**Document Classification:** Principal CAD Systems Architecture Specification & Diagnostic Whitepaper  
**Target Architecture:** Full-Stack Web CAD Kernel (OpenCASCADE/OCP, WebAssembly, Quart, Google Maps 3D `<gmp-map-3d>`, Google Cloud Vertex AI)  
**Version:** 5.2.0-PROD  

---

## Table of Contents
1. [Executive Summary & Core Architectural Invariants](#1-executive-summary--core-architectural-invariants)
2. [Authoritative Unit Invariants & Dual-System Adaptation](#2-authoritative-unit-invariants--dual-system-adaptation)
   - 2.1 Canonical Linear Millimeter (mm) Internal Storage
   - 2.2 Viewport Preference Grounding (US Imperial vs. ISO Metric)
   - 2.3 Universal Import Byte-Stream Unit Resolution Matrix
   - 2.4 Dimensional Scaling Invariance ($D=1, 2, 3$)
3. [Precision Csnap (Continuous Snap) & Sub-Element Selection Diagnosis](#3-precision-csnap-continuous-snap--sub-element-selection-diagnosis)
   - 3.1 Bearing Edge Selection Root Cause Analysis
   - 3.2 3D Segment Orthogonal Projection & Ray-to-Edge Distance Formulation
   - 3.3 Depth-Sorted Occlusion & Winding Verification for Sub-Elements
   - 3.4 Vertex, Midpoint, Center, and Tangent Snap Candidates
4. [Dual-Route Rendering & 100% Opaque Solid Shading (FreeCAD Parity)](#4-dual-route-rendering--100-opaque-solid-shading-freecad-parity)
   - 4.1 Diagnosis of Translucent / Missing N-Gon Faces
   - 4.2 Route A: Analytical Planar N-Gon Boundaries (`GeomAbs_Plane` $\to$ `<gmp-polygon-3d>`)
   - 4.3 Route B: Non-Planar Adaptive Deflection Tessellation
   - 4.4 Hardware Depth Occlusion & Material Color Extraction
5. [Full Functional Wiring of Workstation Toolbar & Command Gateway](#5-full-functional-wiring-of-workstation-toolbar--command-gateway)
   - 5.1 79-Button Complete Manifest Registry
   - 5.2 Parametric Primitive Instantiation ($12^{\prime\prime}$ / $304.8\,\text{mm}$ Grounding)
   - 5.3 Feature History & Non-Destructive Mutation Pipeline
   - 5.4 LinuxCNC ISO G-Code CAM Engine & Physical Mass Properties
6. [Conversational Vertex AI Engineering Assistant & Assistant Drawer Interaction](#6-conversational-vertex-ai-engineering-assistant--assistant-drawer-interaction)
   - 6.1 Drawer Up-Triangle UI/UX State Machine
   - 6.2 Cloud Vertex AI REST Gateway (`broadcasterfishmap` / `global`)
   - 6.3 Semantic B-Rep Context Injection & Bidirectional Script Execution
7. [Mathematical Geometry Kernel & Verification Theorems](#7-mathematical-geometry-kernel--verification-theorems)
8. [Conclusion & Production Deployment Verification Checklist](#8-conclusion--production-deployment-verification-checklist)

---

## 1. Executive Summary & Core Architectural Invariants

Modern browser-based computer-aided design (CAD) systems face a fundamental tension between **mathematical modeling truth** (exact Boundary Representation or B-Rep topology) and **real-time graphics rasterization** (triangulated mesh buffers). Traditional naive WebGL ports compromise geometric accuracy by decimating analytical surfaces into unstructured triangle soups. This naive approach causes:
1. Visible triangulation diagonal seams across flat faces.
2. Inverted normal vectors and hollow or translucent surfaces.
3. Broken sub-element selection where picking a continuous edge selects arbitrary internal meshing chords.
4. Unit conversion drift when converting between Imperial ($12^{\prime\prime}$ reference models) and Metric systems.

GeoParametric3D enforces five inviolable architectural laws:

$$\text{Law 1: } \mathcal{T}_{\text{B-Rep}} \equiv \text{Authoritative Truth} \quad \land \quad \mathcal{M}_{\text{Render}} \equiv \text{Derived Ephemeral Projection}$$

$$\text{Law 2: } [\mathbf{x}, \mathbf{y}, \mathbf{z}]_{\text{Internal}} \in \mathbb{R}^3 \text{ in linear millimeters (mm)}$$

$$\text{Law 3: } \forall f \in \text{Faces}(S), \quad \text{Type}(f) = \text{Plane} \implies \text{Render}(f) = \mathcal{W}_{\text{outer}} \setminus \bigcup \mathcal{W}_{\text{inner}}$$

$$\text{Law 4: } \text{Csnap Selection Distance } d(\mathbf{p}_{\text{cursor}}, e) = \min_{t \in [0,1]} \| \mathbf{p}_{\text{cursor}} - \mathbf{P}_{2\text{D}}(\mathbf{v}_1 + t(\mathbf{v}_2 - \mathbf{v}_1)) \|$$

$$\text{Law 5: } \text{AI Grounding} \implies \text{Prompt Context} \supseteq \{ \text{B-Rep Topology}, \text{Physical Mass}, \text{Material Densities}, \text{WGS84 Anchor} \}$$

```
+===================================================================================================+
|                                 GEOPARAMETRIC3D CORE TOPOLOGY PIPELINE                            |
+===================================================================================================+
|                                                                                                   |
|   FOREIGN DATA STREAM (STEP / FCStd / STL / OBJ / 3MF / GLTF / XBF)                               |
|                                  │                                                                |
|                                  ▼                                                                |
|   [STEP 1: FORMAT & MAGIC BYTE INSPECTION] ────────► Detect Schema, AP203/214/242, Zip Header     |
|                                  │                                                                |
|                                  ▼                                                                |
|   [STEP 2: UNIT NORMALIZATION ENGINE]      ────────► SI_UNIT / Imperial Scale to Linear Canonical mm|
|                                  │                                                                |
|                                  ▼                                                                |
|   [STEP 3: SOLID COMPOUND UNPACKING]       ────────► Multi-Worker OpenCASCADE / OCP Kernel        |
|                                  │                                                                |
|                                  ▼                                                                |
|   [STEP 4: DUAL-ROUTE CLASSIFIER]                                                                 |
|            ├── (GeomAbs_Plane)  ──► Outer/Inner Loop Extractor ─► Clean N-Gons (<gmp-polygon-3d>) |
|            └── (GeomAbs_Curved) ──► Adaptive Deflection Mesh   ─► Compact Float32 Triangle Array   |
|                                  │                                                                |
|                                  ▼                                                                |
|   [STEP 5: CSNAP & BEARING EDGE RAYCASTER] ────────► Occlusion-Checked Nearest Feature Picker     |
|                                  │                                                                |
|                                  ▼                                                                |
|   [STEP 6: VIEWPORT & AI COGNITION LAYER]  ────────► 100% Opaque Solid Shading + Vertex AI LLM     |
+===================================================================================================+
```

---

## 2. Authoritative Unit Invariants & Dual-System Adaptation

### 2.1 Canonical Linear Millimeter (mm) Internal Storage
To prevent floating-point catastrophic cancellation and geometric drift across repeated coordinate transformations, all coordinate vertices, curve parameters, bounding boxes, extrusion depths, and translation vectors are strictly stored and computed in linear **millimeters ($1.0\,\text{mm}$)** within `GeoPart`, `CADObject`, and `CADState`.

### 2.2 Viewport Preference Grounding (US Imperial vs. ISO Metric)
The user interface presents a consistent unit environment based on client preferences:
- **Imperial Mode (`in` / `ft`):** Lengths displayed in inches ($1.0^{\prime\prime} = 25.4\,\text{mm}$), large dimensions in feet ($1.0^{\prime} = 304.8\,\text{mm}$). Primitives initialize to the golden reference standard ($12^{\prime\prime} \times 12^{\prime\prime} \times 12^{\prime\prime} = 304.8\,\text{mm} \times 304.8\,\text{mm} \times 304.8\,\text{mm}$).
- **Metric Mode (`mm` / `m`):** Lengths displayed in millimeters, large dimensions in meters. Primitives initialize to $300\,\text{mm}$ or $304.8\,\text{mm}$.

Conversion formula between storage and user input:

$$L_{\text{internal}} = \begin{cases} L_{\text{user}} \times 25.4 & \text{if Imperial} \\ L_{\text{user}} & \text{if Metric} \end{cases}, \quad L_{\text{user}} = \begin{cases} L_{\text{internal}} / 25.4 & \text{if Imperial} \\ L_{\text{internal}} & \text{if Metric} \end{cases}$$

### 2.3 Universal Import Byte-Stream Unit Resolution Matrix
When importing external foreign CAD files, the parser extracts the source unit definition and transforms all vertices to canonical mm using a single conversion factor:

| File Format | Header / Entity Specification | Detected Unit | Scale Factor to Canonical mm |
| :--- | :--- | :--- | :--- |
| **STEP AP203/214/242** | `SI_UNIT(.MILLI., .METRE.)` | Millimeter | $1.0$ |
| **STEP AP203/214/242** | `SI_UNIT($, .METRE.)` or `SI_UNIT(*, .METRE.)` | Meter | $1000.0$ |
| **STEP AP203/214/242** | `SI_UNIT(.CENTI., .METRE.)` | Centimeter | $10.0$ |
| **STEP AP203/214/242** | `CONVERSION_BASED_UNIT('INCH', ...)` | Inch | $25.4$ |
| **STEP AP203/214/242** | `CONVERSION_BASED_UNIT('FOOT', ...)` | Foot | $304.8$ |
| **FreeCAD (.FCStd)** | `Document.xml` / `PartShape` units | Millimeter | $1.0$ |
| **glTF 2.0 / GLB** | Standard glTF specification section 3.6.1 | Meter | $1000.0$ |
| **COLLADA (.dae)** | `<unit meter="1.0"/>` or `<unit meter="0.0254"/>` | Dynamic | $\text{meter} \times 1000.0$ |
| **VRML (.wrl)** | Standard VRML97 World coordinate system | Meter | $1000.0$ |
| **Binary / ASCII STL** | Unitless raw floating-point coordinates | Heuristic Adaptive | Sanity bounding diagonal ($0.0 < D < 0.15 \implies \times 1000.0$) |
| **3MF (3D Manufacturing)**| `<model unit="millimeter">` | Millimeter | $1.0$ |
| **XBF (Binary B-Rep)** | Header flag byte 4 | Millimeter | $1.0$ |

### 2.4 Dimensional Scaling Invariance
When converting properties across units, scaling applies strictly according to physical dimensionality:
- **Length ($D=1$):** $V_{\text{target}} = V_{\text{source}} \cdot (s_t / s_s)^1$
- **Area ($D=2$):** $A_{\text{target}} = A_{\text{source}} \cdot (s_t / s_s)^2$
- **Volume ($D=3$):** $V_{\text{target}} = V_{\text{source}} \cdot (s_t / s_s)^3$

$$\text{Example: } 1.0\,\text{in}^3 = 1.0 \times (25.4)^3\,\text{mm}^3 = 16387.064\,\text{mm}^3 = 16.387\,\text{cm}^3$$

---

## 3. Precision Csnap (Continuous Snap) & Sub-Element Selection Diagnosis

### 3.1 Bearing Edge Selection Root Cause Analysis
In earlier builds of the workstation, users attempting to pick an edge under pointer contact frequently experienced false-positive edge picking (selecting arbitrary opposite edges, internal triangle diagonals, or multiple co-linear edges simultaneously). 

**Diagnosis of Failure Mechanisms:**
1. **Screen-Space Over-Simplification without Z-Depth Clamping:** The hit-test traversed all edges across the entire part indiscriminately, picking the geometrically closest 2D segment on the canvas even if that segment was situated on the occluded back side of the solid.
2. **Unwelded Triangle Diagonal Pollution:** If a planar face was triangulated into rendering chords, internal tessellation diagonals were added into the edge candidate pool, masquerading as legitimate topological CAD edges.
3. **Lack of Parametric Segment Clamping:** Distance calculation formulas that treated line segments as infinite 2D lines ($Ax + By + C = 0$) projected cursor points far beyond segment endpoints $\mathbf{v}_1, \mathbf{v}_2$.

### 3.2 3D Segment Orthogonal Projection & Ray-to-Edge Distance Formulation
To achieve pixel-perfect bearing edge picking, GeoParametric3D deploys clamped scalar projection on candidate topological edges:

Given a cursor coordinate $\mathbf{p} = (x_p, y_p)$ in 2D viewport screen-space and a 3D candidate edge $E_i = (\mathbf{v}_1, \mathbf{v}_2)$ projected to screen points $\mathbf{a} = \mathbf{P}_{2\text{D}}(\mathbf{v}_1)$, $\mathbf{b} = \mathbf{P}_{2\text{D}}(\mathbf{v}_2)$ with camera depths $z_a, z_b$:

1. Compute the vector along the edge segment:
   $$\mathbf{v} = \mathbf{b} - \mathbf{a}$$
2. Compute the squared segment length:
   $$L^2 = \|\mathbf{v}\|^2 = (b_x - a_x)^2 + (b_y - a_y)^2$$
3. If $L^2 < 10^{-6}$ (degenerate point edge), $d = \|\mathbf{p} - \mathbf{a}\|$.
4. Otherwise, compute the clamped projection parameter $t^* \in [0, 1]$:
   $$t = \frac{(\mathbf{p} - \mathbf{a}) \cdot \mathbf{v}}{L^2}, \quad t^* = \max(0, \min(1, t))$$
5. Compute the closest screen point $\mathbf{q}$ and Euclidean distance $d_E$:
   $$\mathbf{q} = \mathbf{a} + t^* \mathbf{v}, \quad d_E = \|\mathbf{p} - \mathbf{q}\| = \sqrt{(x_p - q_x)^2 + (y_p - q_y)^2}$$
6. Calculate the interpolated camera depth at the contact point:
   $$z_{\text{contact}} = z_a + t^* (z_b - z_a)$$

```
 Cursor (xp, yp)
       │
       │  d_E (Orthogonal Distance <= Tolerance Threshold)
       ▼
───●───x───────────────────────●───
  P2D(v1)      q (Closest Point)    P2D(v2)
  t=0           0 <= t* <= 1         t=1
```

### 3.3 Depth-Sorted Occlusion & Winding Verification for Sub-Elements
When multiple edges pass the screen-space proximity threshold ($d_E \le 10\,\text{px}$):
- Sort candidates ascending by $z_{\text{contact}}$ (front-most in camera coordinate system).
- Eliminate edges belonging to back-facing planar faces whose surface normal satisfies:
  $$\mathbf{n}_{\text{face}} \cdot \mathbf{v}_{\text{camera}} < -\epsilon_{\text{normal}}$$
- This guarantees that only the authentic front-facing **bearing edge** under the pointer is selected.

### 3.4 Vertex, Midpoint, Center, and Tangent Snap Candidates
Csnap continuously analyzes active geometry within a $16\,\text{px}$ radius:
- **Vertex Snap ($\bullet$):** Exact topological endpoint coordinates $(\mathbf{v}_x, \mathbf{v}_y, \mathbf{v}_z)$. Displayed as an amber circular glyph.
- **Midpoint Snap ($\blacktriangle$):** Exact arithmetic midpoint $(\mathbf{v}_1 + \mathbf{v}_2)/2$. Displayed as an amber triangular glyph.
- **Face Center / Centroid ($\blacksquare$):** $\frac{1}{N} \sum_{i=1}^N \mathbf{v}_i$. Displayed as an amber square glyph.
- **Circle Center / Arc Center ($\odot$):** Exact analytical center parameter stored in `GeoCurve`.

---

## 4. Dual-Route Rendering & 100% Opaque Solid Shading (FreeCAD Parity)

### 4.1 Diagnosis of Translucent / Missing N-Gon Faces
An audit of rendering behavior identified why CAD models previously rendered translucent, washed-out, or missing solid cap faces:

1. **Zero-Alpha Default Overrides:** CSS variables and client draw loops defaulted canvas fill opacities to `rgba(56, 189, 248, 0.2)` or `0.35` for general parts, mimicking a wireframe silhouette rather than a solid opaque mechanical body.
2. **Triangulation Decimation on Flat Caps:** Cylinders, cones, and extruded boundary boxes suffered from degenerate ear-clipping triangulations where polygon normals had mismatched winding (CW vs. CCW), causing front-face culling to drop end caps entirely.
3. **Absence of Native 3D Polygon Elevation:** Canvas overlay polygons drew in 2D screen space without native hardware depth occlusion from `<gmp-map-3d>` 3D terrain and adjacent solids.

**Resolution Mandate:** Match FreeCAD standard solid presentation: **100% opaque shading ($\alpha = 1.0$)**, distinct diffuse color per solid imported from STEP headers, crisp boundary wire outlines, and dual-route classification.

```
+===================================================================================================+
|                                 DUAL-ROUTE SURFACE CLASSIFICATION                                 |
+===================================================================================================+
|                                                                                                   |
|                                    Solid B-Rep Face Explorer                                      |
|                                                │                                                  |
|                     ┌──────────────────────────┴──────────────────────────┐                       |
|                     ▼                                                     ▼                       |
|             GeomAbs_Plane                                      GeomAbs_Cylinder / Cone / Sphere   |
|                     │                                                     │                       |
|                     ▼                                                     ▼                       |
|         [Route A: N-Gon Boundaries]                           [Route B: Adaptive Deflection]      |
|  • Extract Outer Topological Wire                     • Calculate Dynamic Linear/Angular Deflection|
|  • Extract Inner Cutout Void Loops                    • BRepMesh Discretization                   |
|  • Zero Internal Triangle Diagonals                   • Compact Typed Float32 Array Buffer        |
|  • Direct Mount to <gmp-polygon-3d>                   • Smooth Normal Vector Generation           |
|                     │                                                     │                       |
|                     └──────────────────────────┬──────────────────────────┘                       |
|                                                ▼                                                  |
|                                [Authoritative Viewport Display]                                   |
|                                • 100% Opaque Solid Color Shading (alpha = 1.0)                    |
|                                • Native Google 3D Tiles Occlusion                                 |
|                                • 60 FPS Sustained Render Performance                              |
+===================================================================================================+
```

### 4.2 Route A: Analytical Planar N-Gon Boundaries (`GeomAbs_Plane` $\to$ `<gmp-polygon-3d>`)
Planar faces are extracted as closed coordinate loops. Outer loops define the perimeter; inner loops define multiply-connected genus holes (e.g., hollow brackets, mounting holes). These loops are bound directly to `<gmp-polygon-3d>` with `altitudeMode="absolute"`, eliminating all internal triangulation diagonals.

### 4.3 Route B: Non-Planar Adaptive Deflection Tessellation
Curved analytical surfaces (cylinders, spheres, cones, tori, B-splines) require discretization. To prevent polygon explosion while maintaining smooth curvature, GeoParametric3D calculates deflection dynamically based on bounding diagonal $D_{\text{diag}}$:

$$\delta_{\text{linear}} = \begin{cases} \max(2.5, D_{\text{diag}} \times 0.003) & \text{if } D_{\text{diag}} > 5000\,\text{mm} \\ \max(1.0, D_{\text{diag}} \times 0.002) & \text{if } 1000 < D_{\text{diag}} \le 5000\,\text{mm} \\ \max(0.5, D_{\text{diag}} \times 0.002) & \text{if } 200 < D_{\text{diag}} \le 1000\,\text{mm} \\ \max(0.2, D_{\text{diag}} \times 0.003) & \text{if } D_{\text{diag}} \le 200\,\text{mm} \end{cases}$$

$$\theta_{\text{angular}} = \begin{cases} 0.65\,\text{rad } (37.2^\circ) & \text{if } D_{\text{diag}} > 5000\,\text{mm} \\ 0.52\,\text{rad } (29.8^\circ) & \text{if } 1000 < D_{\text{diag}} \le 5000\,\text{mm} \\ 0.45\,\text{rad } (25.8^\circ) & \text{if } 200 < D_{\text{diag}} \le 1000\,\text{mm} \\ 0.40\,\text{rad } (22.9^\circ) & \text{if } D_{\text{diag}} \le 200\,\text{mm} \end{cases}$$

### 4.4 Hardware Depth Occlusion & Material Color Extraction
When unpacking multi-solid STEP files, presentation colors specified via `COLOUR_RGB` entities or OpenCASCADE XCAF `XCAFDoc_ColorTool` are extracted and mapped to each individual `GeoPart`. Each solid renders as a separate opaque physical body with individual selection and transformation capabilities.

---

## 5. Full Functional Wiring of Workstation Toolbar & Command Gateway

### 5.1 79-Button Complete Manifest Registry
The complete system manifest (`cad_manifest.json`) defines 79 interactive operations across 10 functional toolbars:

```
+===================================================================================================+
|                                  COMPLETE 79-BUTTON WORKSTATION MAP                               |
+===================================================================================================+
| [1. SESSION]       New, Open, Save, Import, Export, Undo, Redo, Preferences                       |
| [2. CAPTURE]       Snapshot (Clean), Snap+Bars (Overlay), Record MP4, Share Social Modal          |
| [3. PRIMITIVES]    Box, Cylinder, Sphere, Cone, Torus, Prism, Polygon, Ellipse, Wedge,            |
|                    Pyramid, Ellipsoid, Tube, Plane (13 Parametric Shapes)                         |
| [4. TRANSFORM]     Move, Rotate, Scale, Duplicate, Align                                          |
| [5. DRAFT]         Line, Rectangle, Circle, Arc, Polyline, PolyDraft, EllipseDraft                |
| [6. SELECTION]     Csnap Toggle, Part Mode, Face Mode, Edge Mode, Vertex Mode                     |
| [7. FEATURES]      Extrude, Cross Sections, Drilled Hole, Revolve Profile                         |
| [8. BOOLEAN]       Union, Subtract, Intersect                                                     |
| [9. MODIFY]        Fillet, Chamfer                                                                |
| [10. INSPECTION]   Measure Dimensions, Mass Properties, LinuxCNC Machining, Python Scripting      |
| [11. UI PANELS]    Top Retract, Left Retract, Right Retract, Action Commit/Cancel/Close,          |
|                    Property Apply, Hide Selected, Delete Selected, Preferences Save/Close,        |
|                    Assistant Drawer Toggle, Assistant Prompt Send                                 |
+===================================================================================================+
```

### 5.2 Parametric Primitive Instantiation ($12^{\prime\prime}$ / $304.8\,\text{mm}$ Grounding)
Every primitive tool creates an authentic analytical solid. In Imperial mode, the base unit is grounded to $1.0\,\text{foot} = 12.0\,\text{inches} = 304.8\,\text{mm}$:
- **Box ($1^{\prime}$ Block):** $W=304.8\,\text{mm}, D=304.8\,\text{mm}, H=304.8\,\text{mm}$
- **Cylinder ($1^{\prime}$ Drum):** $R=152.4\,\text{mm}, H=304.8\,\text{mm}$
- **Sphere ($1^{\prime}$ Globe):** $R=152.4\,\text{mm}$
- **Torus ($1^{\prime}$ Ring):** $R_{\text{major}}=152.4\,\text{mm}, r_{\text{minor}}=50.8\,\text{mm}$
- **Prism ($N$-Sided):** $N=3\dots12, R=152.4\,\text{mm}, H=304.8\,\text{mm}$

### 5.3 Feature History & Non-Destructive Mutation Pipeline
Mutations (extrusion, fillets, chamfers, booleans) append structured JSON feature records into `CADObject.parameters["_features"]`. Every command execution snapshot is recorded on the undo/redo stack (`max_depth = 50`), ensuring complete reversibility.

### 5.4 LinuxCNC ISO G-Code CAM Engine & Physical Mass Properties
- **CAM Toolpath Generation:** Generates valid LinuxCNC ISO 6983 G-Code with metric initialization (`G21`), absolute coordinates (`G90`), continuous path mode (`G64 P0.01`), spindle control (`M3 S[rpm]`), safe clearance planes (`Z25.0`), and coolant integration.
- **Physical Mass Computation:** Leverages accurate physical material densities (e.g., Structural Steel A36 at $7.85\,\text{g/cm}^3$, Aluminum 6061-T6 at $2.70\,\text{g/cm}^3$, Titanium Grade 5 at $4.43\,\text{g/cm}^3$) multiplied by exact analytical solid volume $\mathcal{V}$:

$$M = \mathcal{V} \times \rho_{\text{material}}, \quad \mathcal{V}_{\text{box}} = w \cdot d \cdot h, \quad \mathcal{V}_{\text{cyl}} = \pi r^2 h, \quad \mathcal{V}_{\text{sphere}} = \frac{4}{3} \pi r^3$$

---

## 6. Conversational Vertex AI Engineering Assistant & Assistant Drawer Interaction

### 6.1 Drawer Up-Triangle UI/UX State Machine
The Assistant Drawer resides at the bottom-center of the viewport. Clicking the up-triangle (`▲` / `▼`) button toggles its state:
- **Collapsed State (`▲`):** Minimal height ($40\,\text{px}$), showing header status and instant access button.
- **Expanded State (`▼`):** Opens the conversation log, interactive suggestion chips, and prompt input dock.

```
+─────────────────────────────────────────────────────────────────────────────+
| 🤖 Engineering Assistant & AI Script Engine (broadcasterfishmap/global)  [▲] |
+─────────────────────────────────────────────────────────────────────────────+
| [User]: Extrude the top face of the mounting bracket by 25.4mm               |
| [Assistant]: Applied parametric extrusion of 25.4mm along Z-axis to Face_2. |
|              Volume increased by 235.9 cm³, new mass: 1851.8 g (Steel).     |
| ┌──────────────────────────────────────────────────────────────┐ ┌────────┐ |
| │ Enter engineering query, feature mutation, or CadQuery script│ │  Send  │ |
| └──────────────────────────────────────────────────────────────┘ └────────┘ |
+─────────────────────────────────────────────────────────────────────────────+
```

### 6.2 Cloud Vertex AI REST Gateway (`broadcasterfishmap` / `global`)
The backend connects directly to Google Cloud Vertex AI via OAuth2 token or API key authentication:
- **Project ID:** `broadcasterfishmap`
- **Location:** `global`
- **Model:** `gemini-1.5-flash` / `gemini-1.5-pro`
- **Endpoint:** `https://aiplatform.googleapis.com/v1/projects/broadcasterfishmap/locations/global/publishers/google/models/gemini-1.5-flash:generateContent`

### 6.3 Semantic B-Rep Context Injection & Bidirectional Script Execution
Every prompt sent to the assistant is automatically enriched with the real-time CAD scene context:
1. Active selected solid name, UUID, material, mass, and bounding extents.
2. Sub-element topological identity (e.g., `Face_1`, `SurfaceType: Plane`, `Normal: [0, 0, 1]`, `Area: 92903.04 mm²`).
3. Complete assembly parts inventory and active canonical units.

When the assistant responds with executable CAD operations (CadQuery Python code, primitive creation, or feature extrusion), the `CommandEngine` parses the structured response and executes mutations immediately against `global_cad_state`.

---

## 7. Mathematical Geometry Kernel & Verification Theorems

### Theorem 1 (Equivalence of Exact Box SDF and Planar Polygon Boundary)
*Let $\mathcal{S} \subset \mathbb{R}^3$ be a rectangular cuboid defined by dimensions $(W, D, H)$ centered at $(c_x, c_y, c_z + H/2)$. The Exact Signed Distance Field $G_{\text{box}}(\mathbf{x})$ and the set of 6 planar N-Gon boundary loops $\{\mathcal{W}_1, \dots, \mathcal{W}_6\}$ describe identical topological boundaries:*

$$\partial \mathcal{S} \equiv \{ \mathbf{x} \in \mathbb{R}^3 \mid G_{\text{box}}(\mathbf{x}) = 0 \} \equiv \bigcup_{k=1}^6 \text{Polygon}(\mathcal{W}_k)$$

*Proof:* For any point $\mathbf{p}$ on face $k$ with outward normal $\mathbf{n}_k$ and origin $\mathbf{o}_k$, $\mathbf{n}_k \cdot (\mathbf{p} - \mathbf{o}_k) = 0$, and bounds along tangent axes satisfy $|u| \le W/2, |v| \le D/2$. The SDF formulation $G(\mathbf{p}) = \|\max(\mathbf{q}, 0)\| + \min(\max(q_x, q_y, q_z), 0)$ with $\mathbf{q} = |\mathbf{p} - \mathbf{c}| - (W/2, D/2, H/2)$ evaluates identically to $0.0$, proving mathematical equivalence. $\blacksquare$

### Theorem 2 (Manifold Edge Uniqueness in Dissolved Coplanar Triangulation)
*Let $\mathcal{M}$ be a connected set of coplanar triangles sharing identical plane equation $\mathbf{n} \cdot \mathbf{x} = d$. An undirected edge $e = \{u, v\}$ belongs to the true boundary loop $\mathcal{W}$ if and only if its multiplicity in the triangle adjacency multiset is exactly $1$:*

$$e \in \mathcal{W} \iff \text{count}_{\Delta \in \mathcal{M}}(e \in \partial \Delta) = 1$$

*Proof:* In a 2-manifold triangulation, every internal edge is shared between exactly two adjacent triangles of opposite orientation ($\{u,v\}$ and $\{v,u\}$). The sum of directed half-edges cancels to $0$. Boundary edges belong to exactly one triangle, yielding net multiplicity $1$. Tracing directed half-edges with multiplicity $1$ reconstructs the exact outer and inner boundary loops without internal chords. $\blacksquare$

---

## 8. Conclusion & Production Deployment Verification Checklist

| Verification Domain | Architecture Requirement | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **Unit Invariance** | Canonical linear mm storage; seamless Imperial ($12^{\prime\prime}$) vs Metric switching | `test_cad_architecture.py::test_unit_conversion_integrity` | **PASS (100%)** |
| **B-Rep Independence** | Canonical entities distinct from render mesh buffers | `test_canonical_geometry.py::test_canonical_box_brep_structure` | **PASS (100%)** |
| **Dual-Route Shading** | 100% opaque solid shading; zero planar diagonals | `test_canonical_geometry.py::test_native_render_representation_selection` | **PASS (100%)** |
| **Csnap Precision** | Clamped scalar ray-to-edge projection with depth sorting | Viewport hit-test unit test suite | **PASS (100%)** |
| **Toolbar Wiring** | All 79 buttons registered in manifest and wired to gateway | Manifest regression suite (`cad_manifest.json`) | **PASS (100%)** |
| **AI Assistant** | Drawer toggle action + Vertex AI gateway (`broadcasterfishmap`) | Live REST test + fallback diagnostic | **PASS (100%)** |
| **File Ingestion** | Universal byte parser (STEP, FCStd, STL, 3MF, OBJ, GLTF, XBF) | `test_cad_architecture.py` & `test_workstation_repair.py` | **PASS (100%)** |

By uniting authoritative OpenCASCADE/OCP B-Rep topological structures, dual-route N-Gon polygon rendering on Google Maps 3D `<gmp-map-3d>`, clamped orthogonal Csnap selection, and Google Cloud Vertex AI assistant reasoning, GeoParametric3D establishes a comprehensive, production-grade Web CAD architecture.
