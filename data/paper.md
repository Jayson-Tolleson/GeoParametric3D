# MASTER ARCHITECTURAL SPECIFICATION & SYSTEM AUDIT REPORT
**System:** GeoParametric3D Authoritative Cloud CAD/CAM Workstation  
**Document Version:** 6.1.0-PROD-GOVERNANCE  
**Status:** Authoritative Architectural Governing Standard  
**Classification:** Core CAD/CAM, B-Rep Kernel & Geospatial Engine Architecture  

---

## 1. Executive Summary & Problem Formulation

GeoParametric3D represents an advanced paradigm in browser-native Computer-Aided Design (CAD), fusing exact boundary representation (B-Rep) topological solid modeling with the geospatial rendering engine of the Google Maps 3D Web Component (`<gmp-map-3d>`), WebGL canvas overlays, and Vertex AI conversational engineering intelligence (`broadcasterfishmap` / `global`).

Recent integration audits and forensic engineering analyses identified core rendering and spatial presentation mandates:

1. **Full-Opacity Solid Shading with True N-Gon Planar Faces & Light Edge Outlines:**
   - *Requirement:* Render solid CAD faces with **100% full opacity** (FreeCAD / STEP standard) to guarantee visual solid volume integrity, eliminate transparent triangle clutter, and ensure hardware depth buffer occlusion.
   - *N-Gon Rule:* Planar CAD faces (`GeomAbs_Plane`) must be rendered as clean N-Gon polygonal boundary loops (`<gmp-polygon-3d>`), completely eliminating internal triangulation diagonals.
   - *Edge Outlines:* Surface boundaries must be delineated by clean, light edge lines (stroke styling: `rgba(255, 255, 255, 0.45)` or `#ffffff` with $1.0\text{px}$ -- $1.5\text{px}$ width) to provide crisp CAD boundary definition without visual weight.

2. **Infinite 1' $\times$ 1' (12-Inch / 304.8 mm) XY Plane Reference Grid:**
   - *Requirement:* The ground plane reference grid on the $Z=0$ datum must extend seamlessly to the visual horizon (infinite grid projection) calibrated to exact $1' \times 1'$ ($12" \times 12"$ or $304.8\text{ mm} \times 304.8\text{ mm}$) major/minor subdivisions with distinct coordinate axes ($X=$ Red, $Y=$ Green, $Z=$ Blue).

3. **Authoritative Dimensional Invariance & Single-Conversion Unit Pipeline:**
   - *Requirement:* All spatial coordinates, curve parameters, and topological geometry reside in canonical internal linear millimeters (`CANONICAL_INTERNAL_UNIT = 'mm'`). Transformations (Scale, Rotation, Translation) maintain dimensionless scale factors without mutating global position datums.

4. **Coordinate Snapping (CSnap) Bearing Edge Isolation:**
   - *Requirement:* Screen-space raycasting isolates the primary bearing edge under cursor contact via face-normal occlusion testing and camera view-angle weighting, preventing false multi-edge captures across adjacent coplanar boundaries.

---

## 2. True N-Gon Planar Topology vs. Adaptive Curved Surface Route

```
+-------------------------------------------------------------------------------------------------+
|                                 EXACT CANONICAL GEOMETRY (GeoPart)                              |
|         GeoAssembly -> GeoInstance -> GeoPart -> GeoSolid -> GeoShell -> GeoFace -> GeoSurface |
+------------------------------------------------+------------------------------------------------+
                                                 |
                                                 v
                                  [Surface Type Classification]
                                                 |
                   +-----------------------------+-----------------------------+
                   |                                                           |
                   v (GeomAbs_Plane / SurfaceType.PLANE)                       v (Curved / Freeform / NURBS)
+-------------------------------------------------+         +-------------------------------------------------+
|        PLANAR BOUNDARY EXTRACTOR (N-Gon)        |         |          ADAPTIVE TESSELLATION PIPELINE         |
|  - Extract Outer Boundary Wires                 |         |  - Quasi-Uniform Chordal Deflection             |
|  - Extract Inner Hole Cutout Wires              |         |  - Adaptive Angular Deflection Scaling          |
|  - Zero Internal Triangulation Diagonals        |         |  - Compact Float32 / Uint32 Render Buffers      |
+------------------------+------------------------+         +------------------------+------------------------+
                         |                                                           |
                         v                                                           v
+-------------------------------------------------+         +-------------------------------------------------+
|            NATIVE <gmp-polygon-3d>              |         |           WATERTIGHT RENDER MESH                |
|  - 100% Full Opacity Solid Shading              |         |  - 100% Full Opacity Shading                    |
|  - Light Boundary Edge Outlines (1.0 - 1.5px)   |         |  - Light Silhouette & Feature Edge Lines        |
|  - Hardware Depth Occlusion on Maps 3D Engine   |         |  - Direct GPU Shading Buffers                   |
+-------------------------------------------------+         +-------------------------------------------------+
```

### 2.1 The N-Gon Extraction Pipeline
For every face in a solid body, the underlying surface adaptor is queried:

1. **Analytical Plane Extraction:** If `surface_type == GeomAbs_Plane`, the boundary loops are extracted as ordered $3\text{D}$ coordinate rings via `BRepTools_WireExplorer` or canonical `GeoLoop` traversal.
2. **Outer Perimeter & Inner Voids:**
   - `outerCoordinates`: Points defining the outer closed boundary polygon.
   - `innerCoordinates`: Array of coordinate loops defining internal cutouts/holes.
3. **Full Opacity & Edge Stroke Contract:**
   - `fillColor`: Solid opaque hex/RGB color (opacity $\alpha = 1.0$).
   - `strokeColor`: Light subtle edge stroke (`rgba(255, 255, 255, 0.45)` for unselected parts, `#ffffff` for selected parts, `#fbbf24` gold for active selection).
   - `strokeWidth`: $1.0\text{px}$ to $1.5\text{px}$ ($2.0\text{px}$ on selected bodies).

---

## 3. Infinite 1' $\times$ 1' (304.8 mm) XY Plane Reference Grid Architecture

### 3.1 Mathematical Projection of the Infinite Grid
The ground reference grid is generated dynamically on the $Z=0$ Local Tangent Plane (ENU Cartesian datum). Given viewport camera parameters (center $[\text{lat}_0, \text{lng}_0, \text{alt}_0]$, heading $\theta_{\text{hdg}}$, tilt $\theta_{\text{tilt}}$, range $R$, pan offsets $[\Delta x, \Delta y]$):

$$\text{Grid Step } \Delta_{\text{grid}} = 304.8\text{ mm} \equiv 1.0\text{ foot (12 inches)}$$

$$\text{Minor Subdivisions } = 25.4\text{ mm} \equiv 1.0\text{ inch} \quad (\text{enabled during high-zoom inspection})$$

### 3.2 Dynamic Horizon Extension
To achieve the visual perception of an infinite ground plane:
1. The camera frustum unprojects viewport bounding corners to the ground plane $Z=0$.
2. Grid lines are rendered across the visible bounding rectangle with a dynamic radial fade factor $\kappa(r)$:

$$\kappa(r) = \operatorname{clamp}\left(1.0 - \frac{r - R_{\text{fade\_start}}}{R_{\text{horizon}} - R_{\text{fade\_start}}}, 0.0, 1.0\right)$$

3. Coordinate axes at $(0, 0, 0)$ are rendered with authoritative engineering colors:
   - $+X$ Axis (East): Red (`#ef4444`)
   - $+Y$ Axis (North): Green (`#10b981`)
   - $+Z$ Axis (Up): Blue (`#3b82f6`)

---

## 4. Dimensional Invariants & Authoritative Unit Pipeline

| Unit Dimension | Canonical Datum | Imperial Equivalent | Scale Ratio to Canonical (mm) |
| :--- | :--- | :--- | :--- |
| **Linear Length ($L$)** | $1.0\text{ mm}$ | $\frac{1}{25.4}\text{ in} \approx 0.03937\text{ in}$ | $1.0$ |
| **1-Foot Standard Block** | $304.8\text{ mm}$ | $12.0\text{ in} = 1.0\text{ ft}$ | $304.8$ |
| **Area ($L^2$)** | $1.0\text{ mm}^2$ | $\frac{1}{645.16}\text{ in}^2$ | $1.0$ |
| **Volume ($L^3$)** | $1.0\text{ mm}^3 = 0.001\text{ cm}^3$ | $\frac{1}{16387.064}\text{ in}^3$ | $1.0$ |
| **Standard Mass Density** | $7.85\text{ g/cm}^3$ | Structural Steel A36 | -- |

### 4.1 Invariant Rules
1. **Internal Linear Millimeters:** All B-Rep vertices, wire loops, NURBS control points, and bounding extents are evaluated and stored in millimeters.
2. **Single Conversion Boundary:** User display preferences (`in` vs `mm`) only modify label formatting and numeric input parsing in the UI. Geometry inside shaders, WebGL, and `<gmp-map-3d>` remains in canonical mm.
3. **Scale Transformation Invariance:** Scaling an object mutates its dimension multiplier $\mathbf{S} = [s_x, s_y, s_z]$ without shifting its position $\mathbf{P} = [p_x, p_y, p_z]$ in world space:

$$\mathbf{P}_{\text{after}} \equiv \mathbf{P}_{\text{before}}$$

---

## 5. Coordinate Snapping (CSnap) Bearing Edge Selection

### 5.1 Disambiguation Algorithm
When the user hovers near geometry in CSnap mode:
1. **Screen-Space Projection:** All 3D topological edges are projected to 2D screen coordinates $\mathbf{s}_1, \mathbf{s}_2$.
2. **Euclidean Distance:** The shortest 2D distance $d_{2\text{D}}$ to the pointer $[u, v]$ is computed.
3. **Bearing Weight Scoring:**

$$w(\mathbf{E}_k) = \frac{1}{\max(d_{2\text{D}}, 1.0)} \cdot \left(\mathbf{n}_{\text{face}} \cdot \mathbf{v}_{\text{cam}}\right)$$

4. **Occlusion & Back-Face Culling:** Edges belonging to occluded or back-facing faces ($\mathbf{n}_{\text{face}} \cdot \mathbf{v}_{\text{cam}} \le 0$) are rejected, isolating the single true visible bearing edge.

---

## 6. Comprehensive Verification Matrix

| Subsystem | Verification Suite | Target Requirement | Status |
| :--- | :--- | :--- | :--- |
| **N-Gon Planar Extraction** | `test_canonical_geometry.py` | Zero triangulation diagonals on plane faces; outer & inner loops intact | **PASS** |
| **Full Opacity Solid Shading** | `test_cad_architecture.py` | 100% opaque surface fills with hardware depth buffering | **PASS** |
| **Infinite 1'x1' Grid** | `test_kernel_math.py` | $304.8\text{ mm}$ grid step with XYZ origin axes | **PASS** |
| **Unit Scale Precision** | `test_cad_architecture.py` | $1' = 304.8\text{ mm}$, $1" = 25.4\text{ mm}$, single-conversion integrity | **PASS** |
| **Scale Invariance** | `test_workstation_repair.py` | $\mathbf{P}_{\text{before}} = \mathbf{P}_{\text{after}}$ under scale transforms | **PASS** |
| **STEP B-Rep Ingestion** | `test_cad_architecture.py` | Direct AP203/AP214/AP242 topological parsing | **PASS** |
| **Vertex AI Assistant** | `app.py` / `command_engine.py` | Google Cloud Vertex AI integration (`broadcasterfishmap` / `global`) | **PASS** |

---

## 7. Architectural Governance Directives

1. **B-Rep Primacy:** The exact topological model (`GeoPart`, `GeoFace`, `GeoEdge`) is authoritative; render polygons and tessellated meshes are derived representations.
2. **Solid Shading Default:** All CAD solid parts must render at $1.0$ opacity with light boundary edge lines to maintain FreeCAD-grade CAD solid definition.
3. **Infinite Grid Consistency:** The XY reference datum grid must remain calibrated to $1' \times 1'$ ($304.8\text{ mm}$) to serve as an intuitive dimensional grounding plane.
4. **Dual-Route Rendering:** Never triangulate planar faces when native N-gon polygons (`<gmp-polygon-3d>`) can be dispatched directly to the graphics engine.

---  
*End of Master Architectural Summary Specification.*
