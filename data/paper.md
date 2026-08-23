# MASTER ARCHITECTURAL SPECIFICATION & SYSTEM AUDIT REPORT
**System:** GeoParametric3D Authoritative Cloud CAD/CAM Workstation  
**Document Version:** 7.0.0-PROD-SPEC  
**Status:** Authoritative Architectural Governing Standard  
**Classification:** Core CAD/CAM & Geospatial Engine Architecture  

---

## 1. Executive Summary & Forensic Problem Statement

GeoParametric3D fuses exact boundary representation (B-Rep) solid geometry with geospatial rendering in Google Maps 3D Web Component (`<gmp-map-3d>`) and Vertex AI generative engineering intelligence (`broadcasterfishmap` / `global`). Recent user inspection and validation audits identified three high-impact visual and spatial rendering defects:

1. **Ghost / Translucent Artifacts on Parts and Primitives:**
   - *Observation:* Instantiated primitives (Box, Cylinder, Sphere, Cone, Torus, Prism, Wedge, Tube) and imported CAD bodies rendered in a semi-transparent, ghost-like appearance where rear faces, hidden vertices, and background terrain bled through foreground geometry.
   - *Root Cause:* Visual opacity fallbacks defaulting to fractional alpha values ($0.15$ to $0.45$), canvas blend mode overlap without hardware depth testing, and premature alpha-blending in `<gmp-polygon-3d>` markup without explicit $1.0$ opacity RGBA / Hex assignments.

2. **Triangulation Diagonal Pollution & Absence of Clean N-Gon Edges:**
   - *Observation:* Flat planar surfaces exhibited spurious internal triangular diagonals across quad, circular, and polygonal faces instead of true N-gon perimeters with subtle, distinct boundary lines.
   - *Root Cause:* Direct pipeline feeding of raw incremental mesh triangle topologies to 2D canvas drawing routines rather than extracting authoritative closed boundary loops (`GeomAbs_Plane` outer and inner wires) with dedicated subtle edge stroke outlines.

3. **Ground Grid Boundary Clipping at High Zoom Levels:**
   - *Observation:* The ground construction grid had a fixed finite extent ($\pm 10$ squares), causing it to terminate abruptly when panning or zooming out, losing spatial reference.
   - *Root Cause:* Hardcoded loop ranges for grid generation rather than an adaptive, camera-frustum-driven infinite grid projector that dynamically evaluates visible ground plane extents while maintaining exact $1' \times 1'$ ($304.8\text{ mm} \times 304.8\text{ mm}$) spacing.

This specification establishes the authoritative mathematical, topological, and visual rendering standards to resolve these issues across the entire GeoParametric3D stack.

---

## 2. Solid B-Rep Opaque Rendering & Edge Rendering Architecture

```
+-------------------------------------------------------------------------------------------------+
|                                   CANONICAL GEOMETRY ENGINE                                     |
|   GeoPart / CADObject -> GeoSolid -> GeoShell -> GeoFace -> GeoSurface                         |
+-------------------------------------------------------------------------------------------------+
                                                |
                                                v
+-------------------------------------------------------------------------------------------------+
|                                 DUAL-ROUTE SURFACE CLASSIFIER                                   |
+-------------------------------------------------------------------------------------------------+
                        |                                               |
       [SurfaceType == PLANE / N-Gon]                   [SurfaceType == CURVED / NURBS]
                        |                                               |
                        v                                               v
+-----------------------------------------------+   +---------------------------------------------+
|      PLANAR N-GON BOUNDARY EXTRACTION         |   |         ADAPTIVE TESSELLATOR ENGINE         |
|  - Outer perimeter wire loop (N vertices)     |   |  - Quasi-uniform chordal deflection         |
|  - Inner cutout void loops (genus > 0)        |   |  - Smooth vertex normal generation          |
|  - ZERO internal triangulation diagonals      |   |  - Watertight vertex welding                |
+-----------------------------------------------+   +---------------------------------------------+
                        |                                               |
                        +-----------------------+-----------------------+
                                                |
                                                v
+-------------------------------------------------------------------------------------------------+
|                            100% OPAQUE SHADING & DEPTH BUFFERING                                |
|  - Solid faces: Hex/RGB Color with Alpha = 1.0 (No transparency bleeding)                       |
|  - Painter's Algorithm Depth Sorting (Back-to-Front on Canvas) + Native GPU Depth Buffer        |
|  - Subtle Boundary Edge Line Stroke: #ffffff / rgba(255,255,255,0.7) at 1.0px                   |
+-------------------------------------------------------------------------------------------------+
```

### 2.1 Full Opacity Enforcement & Shading Invariant
All solid bodies and parametric primitives in GeoParametric3D must default to $100\%$ opacity (alpha $= 1.0$). Ghost rendering is eliminated by strictly enforcing:

1. **Material Fill Invariant:** Face fill colors must be pure hexadecimal (`#38bdf8`, `#34d399`, `#ec4899`, etc.) or opaque RGBA (`rgba(r, g, b, 1.0)`).
2. **Depth Buffer Occlusion:** When projecting to WebGL canvas or `<gmp-map-3d>`, faces are depth-tested against the scene z-buffer so front-facing solid surfaces completely occlude rear-facing surfaces and internal features.
3. **Subtle Light Edge Lines:** Every N-gon face perimeter is outlined with a subtle, light boundary edge stroke ($1.0\text{px}$ width, stroke color `rgba(255, 255, 255, 0.75)` or `#ffffff` under selection) providing crisp engineering contrast without visual clutter.

### 2.2 Mathematical Definition of Clean N-Gon Boundaries

For any planar face $\mathbf{F}_i$ embedded on plane $\Pi: \mathbf{n} \cdot \mathbf{x} + d = 0$, the face boundary is defined by an ordered sequence of coplanar boundary points:

$$\mathbf{P}_{\text{outer}} = \left[ \mathbf{v}_1, \mathbf{v}_2, \dots, \mathbf{v}_N \right], \quad \mathbf{v}_k \in \mathbb{R}^3, \; \mathbf{n} \cdot \mathbf{v}_k + d = 0$$

accompanied by $M$ interior cutout boundary loops $\mathbf{P}_{\text{inner}, m}$ ($m \in \{1, \dots, M\}$).

When rendering to `<gmp-polygon-3d>` or canvas paths, the outer ring is traversed as a closed polygonal boundary without internal chordal decomposition, guaranteeing zero visible triangulation diagonals.

---

## 3. Infinite Ground Grid Architecture ($1' \times 1'$ Foot Spacing)

```
                          [Camera State: Heading, Tilt, Range, Pan]
                                             |
                                             v
                          [Unproject Viewport Viewport Frustum]
                        Raycast Screen Corners -> Ground Plane (Z = 0)
                                             |
                                             v
                          [Visible Ground Bounding Box (ENU mm)]
                             [X_min, Y_min] to [X_max, Y_max]
                                             |
                                             v
                          [Align Bounds to 1-Foot Grid Grid Units]
                        i_min = floor(X_min / 304.8), i_max = ceil(X_max / 304.8)
                        j_min = floor(Y_min / 304.8), j_max = ceil(Y_max / 304.8)
                                             |
                                             v
                          [Render Infinite Grid Lines on Ground]
                             - Primary Grid: Step = 304.8 mm (1 foot)
                             - Accent Origin Axes: X (Red), Y (Green), Z (Blue)
```

### 3.1 Mathematical Formulation of Infinite 1'x1' Grid

1. **Grid Unit Datum:** The grid spacing is strictly constant in canonical linear millimeters:

$$\Delta_{\text{grid}} = 304.8\text{ mm} \equiv 1.0\text{ foot} \equiv 12.0\text{ inches}$$

2. **Frustum-Ground Intersection:** Given viewport width $W$ and height $H$, the 4 viewport corners $(0, 0), (W, 0), (W, H), (0, H)$ are unprojected to the ground plane $Z = 0$ via camera inverse transformation $\mathbf{M}_{\text{view}}^{-1} \mathbf{M}_{\text{proj}}^{-1}$ yielding bounding coordinates:

$$X_{\text{min}} = \min_{k} x_k, \quad X_{\text{max}} = \max_{k} x_k, \quad Y_{\text{min}} = \min_{k} y_k, \quad Y_{\text{max}} = \max_{k} y_k$$

3. **Integer Index Extents:** To guarantee infinite continuity without boundary clipping, lines are drawn over the dynamic range:

$$i \in \left[ \left\lfloor \frac{X_{\text{min}} - M}{\Delta_{\text{grid}}} \right\rfloor, \; \left\lceil \frac{X_{\text{max}} + M}{\Delta_{\text{grid}}} \right\rceil \right], \quad j \in \left[ \left\lfloor \frac{Y_{\text{min}} - M}{\Delta_{\text{grid}}} \right\rfloor, \; \left\lceil \frac{Y_{\text{max}} + M}{\Delta_{\text{grid}}} \right\rceil \right]$$

where $M$ is a safety margin buffer ($20 \times \Delta_{\text{grid}}$).

4. **Scale-Invariant Visual Clarity:** Even when zooming from a single $1''$ bolt up to a $1000\text{ ft}$ industrial facility, the grid lines maintain exact $1' \times 1'$ unit spacing, providing a steady physical datum.

---

## 4. Subsystem Integration & Verification Matrix

| Subsystem | Requirement | Implementation Standard | Verification | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Solid Rendering** | Full Opacity (No ghosting) | Alpha = 1.0, depth-sorted N-gon fills | Direct visual opacity inspection | **ENFORCED** |
| **Face Geometry** | True N-Gon Boundaries | Extract outer/inner wire loops; zero diagonals | `test_canonical_box_brep_structure` | **ENFORCED** |
| **Edge Rendering** | Subtle Light Edge Lines | $1\text{px}$ crisp stroke line (`#ffffff` / `rgba(255,255,255,0.7)`) | Overlay rendering queue test | **ENFORCED** |
| **Ground Grid** | Infinite 1'x1' Datum | Dynamic frustum ground unprojection; $\Delta = 304.8\text{ mm}$ | `test_scale_dimensionless_invariant` | **ENFORCED** |
| **Units & Math** | Authoritative Linear mm | Internal datum $= 1.0\text{ mm}$; conversions at UI boundary | `test_unit_conversion_integrity` | **ENFORCED** |
| **AI Assistant** | Domain CAD Grounding | Vertex AI (`broadcasterfishmap`/`global`) with B-Rep context | `test_cad_architecture.py` | **ENFORCED** |

---

## 5. Architectural Governing Directives

1. **No Semi-Transparent Primitive Instantiations:** All primitive solids (Box, Cylinder, Sphere, etc.) and imported CAD bodies must be added to the state with `opacity: 1.0` and rendered as fully opaque geometric solids.
2. **Preserve N-Gon Topology at All Render Boundaries:** When planar CAD faces are rendered, internal triangulation must never be displayed. The outer perimeter and inner cutout loops must be drawn as coherent N-gon polygons with subtle boundary strokes.
3. **Maintain Strict 1-Foot Grid Spacing:** The ground grid must remain fixed at $304.8\text{ mm} \times 304.8\text{ mm}$ ($1' \times 1'$) across all zoom levels and pan coordinates indefinitely.

---  
*End of Master Architectural Specification.*
