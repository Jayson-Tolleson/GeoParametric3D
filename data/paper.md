# GeoParametric3D Engineering Architectural Specification
## Canonical Unit Invariance, Sub-Element Csnap Selection, Toolbar Gateway Protocols, and Vertex AI Conversational Assistant Architecture

**Author:** Principal CAD Systems Architect & Computational Geometry Governor  
**System Target:** GeoParametric3D Authoritative CAD Workstation  
**Document Version:** 5.2.0  
**Status:** Governing Master Architecture  

---

## Executive Summary & System Invariants

GeoParametric3D operates as an authoritative, high-performance web-native computer-aided design (CAD) workstation engineered atop exact Boundary Representation (B-Rep) topological definitions, an asynchronous command execution gateway, an adaptive dual-route rendering engine integrated with the Google Maps 3D Web Component (`<gmp-map-3d>`), and an autonomous Vertex AI Engineering Assistant.

To ensure flawless dimensional fidelity, sub-millimeter interaction precision, and zero-defect UI reactivity across engineering teams, this specification defines the consolidated architecture addressing four core workstation subsystems:

1. **Canonical Unit Invariant & Viewport Preference Authority:** All geometric entities, calculations, and kernel transformations maintain authoritative internal representation in **linear millimeters ($1.0\text{ mm}$)**. User interface preferences (US/Imperial `[in, ft]` vs. Metric `[mm, cm, m]`) act strictly as non-destructive view/input lenses. Universal byte importers (STEP AP203/214/242, FCStd, STL, GLTF/GLB, 3MF, OBJ, PLY, DAE, WRL, XBF) inspect foreign units and transform geometries into canonical millimeters at the entry boundary.
2. **Bearing Edge Pointer Contact & Csnap Sub-Element Selection:** Exact mathematical point-to-segment distance formulas and angular deflection filters eliminate mis-selection and bleed across adjacent edges. Spatial priority sorting guarantees that pointer contact selects only the specific bearing edge nearest the cursor ray.
3. **Complete 79-Button Toolbar Gateway & Parametric History:** Complete functional wiring and bidirectional command binding across all 79 toolbar actions, ensuring snapshot-backed undo/redo, modal dialog inputs, and real-time state mutation.
4. **Vertex AI Conversational Assistant Integration:** Architectural expansion of the collapsible assistant drawer (`#assistant-drawer`) and its up-triangle toggle (`#btn-toggle-assistant`), integrating bidirectional assembly B-Rep inspection with the Google Cloud Vertex AI REST gateway (`broadcasterfishmap`, location: `global`).

---

## Section 1: Canonical Unit Invariant & Dual-System Viewport Preferences

### 1.1 Mathematical Principle of the Canonical Unit Invariant
In multi-format CAD systems, mixing spatial representations leads to catastrophic scaling drift, catastrophic cancellation in geometric predicates, and degenerate boolean intersections. GeoParametric3D strictly enforces the **Canonical Linear Millimeter ($1.0\text{ mm}$)** internal invariant across the entire computational pipeline:

$$\mathbf{p}_{\text{canonical}} = \mathbf{p}_{\text{source}} \cdot s_{\text{source}\to\text{mm}}$$

$$\mathbf{p}_{\text{display}} = \mathbf{p}_{\text{canonical}} \cdot s_{\text{mm}\to\text{user}}$$

Where the scale factors $s$ are determined from explicit lookup tables and unit conversion calculus:

| Unit Identifier | Normalization Symbol | Linear Scale Factor to mm ($s_{\text{source}\to\text{mm}}$) | Area Factor ($s^2$) | Volume Factor ($s^3$) |
| :--- | :--- | :--- | :--- | :--- |
| **Millimeter** | `mm`, `millimetre` | $1.0$ | $1.0$ | $1.0$ |
| **Centimeter** | `cm`, `centimetre` | $10.0$ | $100.0$ | $1{,}000.0$ |
| **Meter** | `m`, `metre` | $1{,}000.0$ | $1{,}000{,}000.0$ | $1{,}000{,}000{,}000.0$ |
| **Micron / Micrometer** | `um`, `micron` | $0.001$ | $10^{-6}$ | $10^{-9}$ |
| **Inch** | `in`, `inch`, `"` | $25.4$ | $645.16$ | $16{,}387.064$ |
| **Foot** | `ft`, `foot`, `'` | $304.8$ | $92{,}903.04$ | $28{,}316{,}846.592$ |
| **Yard** | `yd`, `yard` | $914.4$ | $836{,}127.36$ | $764{,}554{,}857.984$ |

### 1.2 Viewport Preference Setting & UI Tone
The user preference stored in `CADState.state.preferences.units` (`'imperial'` vs `'metric'`) controls:
- **Grid Line Spacing:** Ground plane grid adapts to $12\text{ in}$ ($304.8\text{ mm}$) squares in US/Imperial mode vs $300.0\text{ mm}$ or $100.0\text{ mm}$ in Metric mode.
- **Toolbar Section Labels:** Dynamic label `#label-primitives-section` displays `12" PRIMITIVES` or `300mm PRIMITIVES`.
- **Inspector & Action Panel Labels:** Position, extents, bounding dimensions, slice thickness, and draft extrusion parameters dynamically format with unit suffixes `(in)` or `(mm)`.
- **Lossless Value Roundtripping:** Conversion functions `toUserLength(mmVal)` and `fromUserLength(userVal)` prevent compounding floating-point drift by performing single-conversion projections on demand.

---

## Section 2: Universal Import Unit Analysis & Ingestion Normalization

```
 FOREIGN BYTE STREAM (Binary, Mesh, Solid B-Rep)
       |
       +--> [PHASE 1: MAGIC BYTE & SCHEMA IDENTIFIER]
       |    - STEP: ISO-10303-21 header, AP203/214/242 detection
       |    - FCStd: PK0304 ZIP container with Document.xml
       |    - STL: 80-byte binary header vs ASCII 'solid' token
       |    - GLTF/GLB: 'glTF' chunk layout, asset.unit = meter
       |    - 3MF / OBJ / PLY / DAE / WRL / XBF
       |
       +--> [PHASE 2: UNIT & COLOR METADATA EXTRACTION]
       |    - STEP: SI_UNIT(.MILLI., .METRE.) vs CONVERSION_BASED_UNIT('INCH')
       |    - GLTF/GLB/DAE/WRL: Meter-to-mm scaling (1000.0x)
       |    - STEP CAF / XCAF: Color mapping (COLOUR_RGB -> hex)
       |
       +--> [PHASE 3: OUT-OF-SCALE GEOMETRIC ADAPTATION]
       |    - Diagonal extent sanity: D < 0.15 -> 1000x | D > 5e7 -> 0.001x
       |
       +--> [PHASE 4: TOPOLOGY NORMALIZATION & MESH COMPACTION]
       |    - Validate finite vertices: isnan() / isinf() rejection
       |    - Welded vertex indexing & degenerate facet elimination
       |
       +--> [PHASE 5: CANONICAL GEOPART & GEOASSEMBLY PROJECTION]
            - GeoAssembly tree construction -> Native <gmp-map-3d> Viewport
```

### 2.1 File Format Ingestion Matrix

| Format | Header / Entity Signature | Unit Resolution Rule | Default Scale Factor to Canonical (mm) |
| :--- | :--- | :--- | :--- |
| **STEP (AP203/214/242)** | `ISO-10303-21;` | `SI_UNIT($, .METRE.)` $\to 1000.0$<br>`SI_UNIT(.MILLI., .METRE.)` $\to 1.0$<br>`CONVERSION_BASED_UNIT('INCH', ...)` $\to 25.4$ | Analytical header entity detection; fallback $1.0$ |
| **FreeCAD (.FCStd)** | `PK\x03\x04` containing `Document.xml` & `.brp` | XML properties & embedded OpenCASCADE Brep records | Native FreeCAD canonical mm ($1.0$) |
| **Binary STL** | 80-byte header + `uint32` triangle count | Unitless mesh header $\to$ Extent inspection | $1.0$ (adapted if extents $< 0.15$ mm) |
| **ASCII STL** | `solid <name>` $\dots$ `endsolid` | Unitless text $\to$ Extent inspection | $1.0$ (adapted if extents $< 0.15$ mm) |
| **GLTF / GLB** | `glTF` magic (`0x46546C67`) or JSON `"asset"` | GLTF specification standard unit is **Meter** | **$1000.0$** |
| **COLLADA (.dae)** | `<COLLADA>` ... `<asset><unit meter="...">` | `<unit meter="x"/>` $\to x \cdot 1000.0$ | XML meter attribute; fallback $1000.0$ |
| **VRML (.wrl)** | `#VRML V2.0 utf8` | Standard VRML unit is **Meter** | **$1000.0$** |
| **3D Manufacturing (.3mf)** | `PK\x03\x04` with `3D/3dmodel.model` | XML unit attribute (`unit="millimeter"`, `"inch"`) | XML unit mapping; default $1.0$ |
| **Wavefront (.obj)** | `v x y z` vertex lists | Unitless coordinate arrays $\to$ Extent inspection | $1.0$ |
| **Polygon File (.ply)** | `ply
format binary_little_endian` | Unitless coordinate arrays $\to$ Extent inspection | $1.0$ |
| **CascadeCAD Binary (.xbf)** | `XBF1`, `XBF2`, `XBFA` magic bytes | Native B-Rep serialization container | Direct canonical mm ($1.0$) |

---

## Section 3: Bearing Edge Selection & Precise Csnap Architecture

### 3.1 Edge Selection Diagnostic & Pointer Bearing Point Calculus
In legacy implementations, sub-element edge selection exhibited cursor bleed—selecting arbitrary back-edges or adjacent non-bearing segments. The root cause was unweighted 2D projected distance evaluation without ray-distance depth sorting or bearing segment alignment.

To ensure that clicking on or near an edge selects exclusively the bearing edge of pointer contact, the selection pipeline applies a two-stage geometric filter:

#### Stage 1: Point-to-Segment Orthogonal Projection
For a mouse cursor position $\mathbf{p}_m = (x_m, y_m)$ and a projected 2D edge segment bounded by $\mathbf{a} = (x_1, y_1)$ and $\mathbf{b} = (x_2, y_2)$:

$$\mathbf{v} = \mathbf{b} - \mathbf{a}, \quad l^2 = \|\mathbf{v}\|^2$$

$$t = \mathrm{clamp}\left( \frac{(\mathbf{p}_m - \mathbf{a}) \cdot \mathbf{v}}{l^2}, 0.0, 1.0 \right)$$

$$\mathbf{p}_{\text{proj}} = \mathbf{a} + t \mathbf{v}$$

$$d_{\text{pixel}} = \|\mathbf{p}_m - \mathbf{p}_{\text{proj}}\|$$

#### Stage 2: Depth-Weighted Bearing Score
When multiple edges fall within the hit threshold ($d_{\text{pixel}} < 10\text{ px}$), candidate edges are scored by combining orthogonal pixel distance and camera depth $z_{\text{depth}}$:

$$S_{\text{bearing}} = d_{\text{pixel}} + \alpha \cdot \left( \frac{z_{\text{depth}} - z_{\text{min}}}{z_{\text{max}} - z_{\text{min}} + \epsilon} \right)$$

Where $\alpha = 4.0\text{ px}$. The edge segment with the minimum score $S_{\text{bearing}}$ is uniquely selected as the authoritative bearing edge.

### 3.2 Csnap Spatial Priority Hierarchy
Object snapping (Csnap) operates across three distinct topological feature classes evaluated in strict order of geometric precedence:

```
 1. VERTEX SNAP (Circle Marker, Radius 8px, Tol = 14px)  [HIGHEST PRIORITY]
       |
       v (if no vertex in tolerance)
 2. EDGE MIDPOINT SNAP (Square Marker, 12x12px, Tol = 12px)
       |
       v (if no midpoint in tolerance)
 3. CONTINUOUS EDGE BEARING SNAP (Orthogonal Projection, Tol = 10px)
```

---

## Section 4: 79-Button Toolbar Gateway & Parametric History

The GeoParametric3D user interface contains exactly 79 functionally wired buttons partitioned into clear operational sections, all bound through `static/js/toolbar.js`, `static/js/ui.js`, and `command_engine.py`:

```
+-------------------------------------------------------------------------------------------------------+
|                                        CAD TOOLBAR (79 BUTTONS)                                       |
+-------------------+--------------------+--------------------+--------------------+--------------------+
| 1. SESSION (8)    | 2. SHARE (4)       | 3. PRIMITIVES (13) | 4. TRANSFORM (5)   | 5. DRAFT (7)       |
| - toolbar-new     | - btn-share-snap   | - btn-add-box      | - toolbar-move     | - btn-draft-line   |
| - toolbar-open    | - btn-share-all    | - btn-add-cylinder | - toolbar-rotate   | - btn-draft-rect   |
| - toolbar-save    | - btn-share-rec    | - btn-add-sphere   | - toolbar-scale    | - btn-draft-circle |
| - toolbar-import  | - btn-open-share   | - btn-add-cone     | - toolbar-duplicate| - btn-draft-arc    |
| - toolbar-export  |                    | - btn-add-torus    | - toolbar-align    | - btn-draft-pline  |
| - toolbar-undo    |                    | - btn-add-prism    |                    | - btn-draft-poly   |
| - toolbar-redo    |                    | - btn-add-polygon  |                    | - btn-draft-ellip  |
| - toolbar-prefs   |                    | - btn-add-ellipse  |                    |                    |
|                   |                    | - btn-add-wedge    |                    |                    |
|                   |                    | - btn-add-pyramid  |                    |                    |
|                   |                    | - btn-add-ellip    |                    |                    |
|                   |                    | - btn-add-tube     |                    |                    |
|                   |                    | - btn-add-plane    |                    |                    |
+-------------------+--------------------+--------------------+--------------------+--------------------+
| 6. SELECTION (5)  | 7. FEATURES (4)    | 8. BOOLEAN (3)     | 9. MODIFY (2)      | 10. INSPECT/CNC (4)|
| - btn-toggle-csnap| - btn-feat-extrude | - btn-bool-union   | - btn-mod-fillet   | - btn-insp-measure |
| - btn-sel-part    | - btn-feat-xsect   | - btn-bool-sub     | - btn-mod-chamfer  | - btn-insp-mass    |
| - btn-sel-face    | - btn-feat-hole    | - btn-bool-inter   |                    | - btn-tool-cnc     |
| - btn-sel-edge    | - btn-feat-revolve |                    |                    | - btn-tool-script  |
| - btn-sel-vertex  |                    |                    |                    |                    |
+-------------------+--------------------+--------------------+--------------------+--------------------+
| 11. MODALS & UI PANELS (24 Buttons: Retract, Preferences, Social Share, Mass, CNC, Script, Assistant) |
+-------------------------------------------------------------------------------------------------------+
```

### 4.1 Command Execution Protocol
Every mutating operation creates an undo snapshot before execution. Snapshots store complete deep copies of `CADState.objects`, `assemblyTree`, and document metadata in memory, enabling full single-step undo (`Ctrl+Z`) and redo (`Ctrl+Y`).

---

## Section 5: Conversational Engineering Assistant Architecture

### 5.1 Drawer UI & Toggle Kinematics
The Engineering Assistant dock (`#assistant-drawer`) is anchored at the bottom-center of the viewport. Its toggle button (`#btn-toggle-assistant`) contains a directional triangle indicator that dynamically updates:
- **Collapsed State:** Drawer body is hidden (`.collapsed`), toggle icon displays `▲` (up triangle).
- **Expanded State:** Drawer body displays live chat history and prompt input, toggle icon displays `▼` (down triangle).

### 5.2 Vertex AI Gateway Payload & Context Injection
Assistant queries invoke the backend `/api/assistant/chat`, `/cad/api/assistant/chat`, or `/api/generate` endpoints, which connect to Google Cloud Vertex AI under project `broadcasterfishmap` and location `global`.

The system context automatically injects the live assembly B-Rep state:

```json
{
  "contents": [
    {
      "parts": [
        {
          "text": "You are the dedicated Engineering Assistant for GeoParametric3D (Project: broadcasterfishmap, Location: global).\
Provide substantive, technically precise engineering reasoning, CAD/CAM/CAE guidance, mechanical/structural analysis, B-Rep topological insight, material selection, and mathematical derivations.\
B-Rep geometry is authoritative; render meshes are derived representations.\
\
Current Active Assembly Scene (1 bodies, canonical unit: mm): 1-Foot Reference Block (ID: obj_box_1, Material: Steel, Faces: 6, Volume: 28316.85 cm³)\
\
User Query: Calculate principal moment of inertia and generate CNC facing path."
        }
      ]
    }
  ]
}
```

---

## Section 6: Dual-Route B-Rep & Native `<gmp-map-3d>` Viewport Rendering

```
            +--------------------------------------------------+
            |           CAD TOPOLOGICAL FACE SEPARATION        |
            +-------------------------+------------------------+
                                      |
             +------------------------+------------------------+
             |                                                 |
             v (GeomAbs_Plane)                                 v (Curved Surface)
+------------------------------------------+      +------------------------------------------+
|     N-GON PLANAR POLYGON ROUTE           |      |      ADAPTIVE DEFLECTION MESH ROUTE      |
|  \u2022 Extract outer & inner boundary loops   |      |  \u2022 Compute optimal chordal deflection    |
|  \u2022 Zero internal triangulation diagonals  |      |  \u2022 Discretize quad/triangle meshes       |
|  \u2022 Direct <gmp-polygon-3d> DOM component |      |  \u2022 Contiguous ArrayBuffer / WebGL shader |
+--------------------+---------------------+      +--------------------+---------------------+
                     |                                                 |
                     +------------------------+------------------------+
                                              |
                                              v
                        +------------------------------------------+
                        |  100% OPAQUE SHADING & DEPTH BUFFERING   |
                        |  \u2022 FreeCAD-standard solid opacity (1.0)  |
                        |  \u2022 Authoritative STEP header hex colors  |
                        |  \u2022 Full hardware occlusion in <gmp-map-3d>|
                        +------------------------------------------+
```

### 6.1 Planar Face Rendering via `<gmp-polygon-3d>`
Planar CAD faces (`GeomAbs_Plane`) bypass triangulation and instantiate native `<gmp-polygon-3d>` elements with exact outer and inner hole coordinates. This delivers zero diagonal artifacts and direct hardware acceleration in the 3D map environment.

### 6.2 Curved Surface Adaptive Tessellation
Non-planar faces (Cylinders, Cones, Spheres, Toroids, NURBS) undergo curvature-adaptive deflection. The chordal deflection $\delta$ and angular tolerance $\theta$ scale dynamically with the bounding diagonal $D_{\text{diag}}$:

$$\delta = \max\left(0.2\text{ mm}, D_{\text{diag}} \cdot 0.002\right), \quad \theta = 0.45\text{ rad} \approx 25.8^\circ$$

---

## Section 7: System Verification Matrix

| Verification Dimension | Governing Test Suite | Acceptance Criteria | Status |
| :--- | :--- | :--- | :--- |
| **Unit Conversion Invariance** | `test_cad_architecture.py` | Exact single-conversion calculations across in, ft, cm, m, mm; zero compounding drift. | **PASS** |
| **STEP B-Rep Hierarchy** | `test_cad_architecture.py` | Complete topology recovery (Solid $\to$ Shell $\to$ Face $\to$ Loop $\to$ Edge $\to$ Vertex). | **PASS** |
| **Vertex Mesh Compaction** | `test_cad_architecture.py` | Strict finite coordinate validation, remapping out-of-bounds indices, degenerate rejection. | **PASS** |
| **Canonical Part Independence** | `test_canonical_geometry.py` | B-Rep data model remains unmodified during adaptive rendering tessellation passes. | **PASS** |
| **Scale Dimensionless Invariance** | `test_workstation_repair.py` | `transform_object` scale never shifts world coordinates ($x_{\text{after}} = x_{\text{before}}$). | **PASS** |
| **Binary XBF & FCStd Ingestion** | `test_workstation_repair.py` | Lossless roundtrip byte import/export across proprietary and FreeCAD containers. | **PASS** |
| **Mathematical Golden Equivalence** | `test_kernel_math.py` | Box SDF distance field aligns with analytic volume ($V = w \cdot d \cdot h$). | **PASS** |

---

## Architectural Sign-Off

This consolidated specification establishes the definitive standard for unit handling, sub-element picking, command gateway routing, and AI assistance within the GeoParametric3D workstation.

**Signed,**  
*Principal CAD Systems Architect & Computational Geometry Governor*
