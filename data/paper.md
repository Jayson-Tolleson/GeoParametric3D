# MASTER ARCHITECTURAL SPECIFICATION & SYSTEM AUDIT REPORT
**System:** GeoParametric3D Authoritative Cloud CAD/CAM Workstation  
**Document Version:** 7.0.0-PROD-CONSOLIDATED  
**Status:** Authoritative Architectural Governing Standard  
**Classification:** Core CAD/CAM, Exact B-Rep Topology, Appearance Pipeline & Geospatial Engine Architecture  

---

## 1. Executive Summary & Forensic Problem Statement

GeoParametric3D represents a modern paradigm in web-native Computer-Aided Design (CAD), integrating exact boundary representation (B-Rep) topological solid modeling with the geospatial rendering capabilities of the Google Maps 3D Web Component (`<gmp-map-3d>`), OpenCASCADE Technology (OCCT/OCP), WebAssembly, and Vertex AI conversational engineering intelligence.

Recent integration audits, user feedback, and forensic inspection of the rendering pipeline identified four critical architectural defects:

1. **Ghost / Translucent Parts & Default Opacity Flaws:**
   - *Observation:* CAD primitives and imported solid bodies rendered with unintentional translucency ("ghost solids"), causing internal triangle meshes to be visible, washing out material colors, and breaking visual depth perception.
   - *Root Cause:* CSS and canvas rendering routines defaulted polygon fills to low alpha channels (e.g., `rgba(56, 189, 248, 0.4)`), and the data store lacked strict enforcement of 100% opaque shading ($A=1.0$) for solid CAD bodies. Furthermore, STEP AP214/AP242 presentation style styles were losing alpha channel distinction across the serialization boundary.

2. **Absence of Crisp Topological Edge Lines ("N-Gon Outlines"):**
   - *Observation:* Flat planar surfaces exhibited internal triangulation diagonals rather than clean physical N-Gon boundaries with subtle, high-contrast boundary edge lines.
   - *Root Cause:* Planar faces were triangulated indiscriminately prior to rendering rather than utilizing the dual-route architecture where `GeomAbs_Plane` is extracted as an outer boundary loop with inner cutout wires, rendered with opaque coplanar fill and light stroke edge lines.

3. **XY Ground Grid Zoom Extent & 1'x1' Grid Invariance:**
   - *Observation:* Zooming out caused the ground plane grid to truncate abruptly within a localized bounding box, while zooming in lacked continuous infinite plane projection maintaining the authoritative $1'\times 1'$ ($304.8\text{ mm} \times 304.8\text{ mm}$) spacing datum.
   - *Root Cause:* Grid generation was restricted to fixed iteration bounds (`[-gridExtent, +gridExtent]`) without dynamic frustum-based camera extent projection.

4. **Unified Traceability Across the Whole CAD Pipeline:**
   - *Observation:* Previous subsystems treated units, topology, transparency, and rendering as disconnected layers, creating discrepancies between STEP exchange structures, internal representation, viewport displays, and export payloads.
   - *Root Cause:* Lack of a single governing architectural pipeline standard connecting **STEP fidelity $\rightarrow$ units $\rightarrow$ topology $\rightarrow$ geometry $\rightarrow$ appearance/materials $\rightarrow$ transparency $\rightarrow$ canonical representation $\rightarrow$ rendering $\rightarrow$ export fidelity**.

---

## 2. End-to-End Architectural Dataflow

```
+-------------------------------------------------------------------------------------------------+
| 1. CAD EXCHANGE & IMPORT INGESTION                                                              |
|    STEP (AP203/214/242) / STL / FCStd / OBJ / 3MF / GLTF / DXF / Parametric Primitives          |
+-------------------------------------------------------------------------------------------------+
                                                |
                                                v
+-------------------------------------------------------------------------------------------------+
| 2. UNIT & APPEARANCE METADATA EXTRACTION                                                        |
|    - Detect SI_UNIT & CONVERSION_BASED_UNIT -> Normalize to Linear mm (Scale = S_to_mm)          |
|    - Parse PRESENTATION_STYLE_ASSIGNMENT / COLOUR_RGB / Alpha                                   |
|    - Default Solids to 100% Opaque (A = 1.0) unless explicit glass/translucent material assigned|
+-------------------------------------------------------------------------------------------------+
                                                |
                                                v
+-------------------------------------------------------------------------------------------------+
| 3. AUTHORITATIVE B-REP TOPOLOGY RECOVERY (OCCT / OCP / CANONICAL)                               |
|    GeoAssembly -> GeoInstance -> GeoPart -> GeoSolid -> GeoShell -> GeoFace -> GeoLoop/Edge/Vtx  |
+-------------------------------------------------------------------------------------------------+
                                                |
                        +-----------------------+-----------------------+
                        |                                               |
                        v                                               v
+-----------------------------------------------+   +---------------------------------------------+
| 4A. PLANAR DUAL-ROUTE (GeomAbs_Plane)         |   | 4B. ANALYTICAL & FREEFORM SURFACES          |
| - Extract Exact Perimeter N-Gon Loops         |   | - Adaptive Quasi-Uniform Chordal Deflection |
| - Extract Inner Cutout Holes (Genus Topology) |   | - Dynamic Linear & Angular Deflection Guard |
| - Zero Internal Triangulation Diagonals       |   | - Watertight Vertex Normal Buffers          |
+-----------------------------------------------+   +---------------------------------------------+
                        |                                               |
                        +-----------------------+-----------------------+
                                                |
                                                v
+-------------------------------------------------------------------------------------------------+
| 5. PRESENTATION & RENDERING ENGINE                                                              |
|    - Solid Faces: 100% Opaque Shading (FreeCAD standard)                                        |
|    - Boundary Edges: Light High-Contrast Edge Lines along Topological Wire Loops                |
|    - Native <gmp-map-3d> & <gmp-polygon-3d> Elements for Zero-CPU GPU Acceleration              |
|    - Infinite Dynamic Ground Grid: Stable 1-ft (304.8 mm) Grid Lines Across All Camera Zooms    |
+-------------------------------------------------------------------------------------------------+
                                                |
                                                v
+-------------------------------------------------------------------------------------------------+
| 6. REVERSIBLE EXPORT & PERSISTENCE (STEP / XBF / JSON)                                          |
|    Lossless preservation of Units, Topology, Appearance, Colors, and Opacity                    |
+-------------------------------------------------------------------------------------------------+
```

---

## 3. Transparency, Material & Appearance Governance

### 3.1 The 100% Opacity Solid Invariant
All physical CAD parts, solids, and parametric primitives are **100% opaque ($A = 1.0$) by default**.
Translucency is reserved exclusively for explicit user-designated transparent materials (such as optical glass, acrylic, fluid reservoirs) or component-level inspection modes.

### 3.2 Appearance & Material Schema

```json
{
  "material_id": "StructuralSteel_A36",
  "name": "Structural Steel A36",
  "density_g_cm3": 7.85,
  "appearance": {
    "color": "#38bdf8",
    "opacity": 1.0,
    "ambient": 0.2,
    "diffuse": 0.8,
    "specular": 0.9,
    "roughness": 0.35,
    "metalness": 0.85
  },
  "edge_rendering": {
    "enabled": true,
    "color": "rgba(255, 255, 255, 0.75)",
    "width_pixels": 1.5,
    "highlight_color": "#fbbf24"
  }
}
```

### 3.3 Depth Buffer & Z-Order Resolution
When rendering transparent surfaces ($A < 1.0$):
- Opaque solids ($A = 1.0$) are rendered first with full depth write (`glDepthMask(true)`) and depth test (`glEnable(GL_DEPTH_TEST)`).
- Transparent geometry is rendered in a second pass sorted back-to-front by centroid depth relative to the camera vector, with depth writing disabled (`glDepthMask(false)`) and standard alpha blending (`glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)`).
- In the `<gmp-map-3d>` native polygon subsystem, the hardware depth buffer natively manages occlusion against 3D photorealistic terrain and buildings.

---

## 4. True N-Gon Boundaries & Crisp Edge Line Rendering

```
  +---------------------------------------+
  |                                       |
  |      PLANAR FACE INTERIOR             |
  |      (100% Opaque Solid Shading)      |
  |      Color: #38bdf8 / No Diagonals    |
  |                                       |
  |             +-----------+             |
  |             | INNER HOLE|             |
  |             | (Cutout)  |             |
  |             +-----------+             |
  |                                       |
  +---------------------------------------+
  ^                                       ^
  |---------------------------------------|
      LIGHT CRISP BOUNDARY EDGE LINES
        (Topological Wires, Stroke: 1.5px)
```

### 4.1 Planar Face Classification & Extraction
For every `TopoDS_Face` in the CAD model:
1. If `adaptor.GetType() == GeomAbs_Plane`, extract the outer wire loop $\mathbf{W}_{\text{outer}}$ and inner hole loops $\{\mathbf{W}_{\text{inner}, i}\}$.
2. Discretize curved edge segments using chordal deflection $\delta_{\text{chord}} \le 0.05\text{ mm}$.
3. Do NOT execute triangle triangulation for viewport display. Pass the ordered loop coordinates directly to `<gmp-polygon-3d>` as `outerCoordinates` and `innerCoordinates`.
4. Apply solid fill color with full opacity (`fillColor: "#38bdf8"`) and crisp boundary outline (`strokeColor: "rgba(255,255,255,0.75)"`, `strokeWidth: 1.5`).

### 4.2 Non-Planar / Curved Faces
For non-planar analytical surfaces (cylinders, cones, spheres, tori, NURBS):
1. Calculate optimal dynamic deflection based on solid diagonal extent $D$:
   $$\delta_{\text{linear}} = \operatorname{clamp}(D \times 0.002, 0.2, 2.5)\text{ mm}, \quad \theta_{\text{angular}} = \operatorname{clamp}\left(0.40, 0.65\right)\text{ rad}$$
2. Generate clean vertex normals $\mathbf{n}_v$ to eliminate faceted shading artifacts.
3. Render solid triangles with 100% opacity and overlay physical boundary silhouette curves without internal wire clutter.

---

## 5. Infinite XY Ground Grid Architecture (1' x 1' Spatial Invariance)

### 5.1 Mathematical Formulation of the Infinite Grid

Let the canonical grid spacing be $S_{\text{grid}} = 304.8\text{ mm}$ ($1.0\text{ foot}$).  
Let the camera viewport frustum intersect the ground plane ($Z = 0$) over the bounding box $[X_{\text{min}}, X_{\text{max}}] \times [Y_{\text{min}}, Y_{\text{max}}]$.

The rendered grid line indices are given by:

$$i_{\text{min}} = \left\lfloor \frac{X_{\text{min}}}{S_{\text{grid}}} \right\rfloor - k_{\text{margin}}, \quad i_{\text{max}} = \left\lceil \frac{X_{\text{max}}}{S_{\text{grid}}} \right\rceil + k_{\text{margin}}$$
$$j_{\text{min}} = \left\lfloor \frac{Y_{\text{min}}}{S_{\text{grid}}} \right\rfloor - k_{\text{margin}}, \quad j_{\text{max}} = \left\lceil \frac{Y_{\text{max}}}{S_{\text{grid}}} \right\rceil + k_{\text{margin}}$$

where $k_{\text{margin}} \ge 2$ ensures seamless coverage during rapid camera panning and orbiting.

### 5.2 Dynamic Grid Shader / Canvas Implementation
- **Major Lines (Every 5 feet / $1524\text{ mm}$):** Higher opacity (`rgba(255,255,255,0.18)`), stroke width $1.5\text{ px}$.
- **Minor Lines (Every 1 foot / $304.8\text{ mm}$):** Subtle opacity (`rgba(255,255,255,0.08)`), stroke width $1.0\text{ px}$.
- **Origin Axes ($X=0, Y=0, Z=0$):** Red ($+X$), Green ($+Y$), Blue ($+Z$) axes with width $2.0\text{ px}$.

```javascript
export function renderInfiniteGrid(ctx, camera, projectFn, cssWidth, cssHeight) {
  const gridStep = 304.8; // 1 foot in mm
  const majorStep = gridStep * 5;
  
  // Determine visible extent on Z=0 plane from camera range
  const range = camera.range || 1828.8;
  const span = Math.max(gridStep * 20, range * 2.5);
  const cx = camera.target ? camera.target[0] : 0;
  const cy = camera.target ? camera.target[1] : 0;
  
  const minX = Math.floor((cx - span) / gridStep) * gridStep;
  const maxX = Math.ceil((cx + span) / gridStep) * gridStep;
  const minY = Math.floor((cy - span) / gridStep) * gridStep;
  const maxY = Math.ceil((cy + span) / gridStep) * gridStep;
  
  // Render grid lines
  for (let x = minX; x <= maxX; x += gridStep) {
    const isMajor = Math.abs(x % majorStep) < 1e-3;
    ctx.strokeStyle = isMajor ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = isMajor ? 1.5 : 1.0;
    const p1 = projectFn(x, minY, 0);
    const p2 = projectFn(x, maxY, 0);
    ctx.beginPath();
    ctx.moveTo(p1.px, p1.py);
    ctx.lineTo(p2.px, p2.py);
    ctx.stroke();
  }
  for (let y = minY; y <= maxY; y += gridStep) {
    const isMajor = Math.abs(y % majorStep) < 1e-3;
    ctx.strokeStyle = isMajor ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = isMajor ? 1.5 : 1.0;
    const p1 = projectFn(minX, y, 0);
    const p2 = projectFn(maxX, y, 0);
    ctx.beginPath();
    ctx.moveTo(p1.px, p1.py);
    ctx.lineTo(p2.px, p2.py);
    ctx.stroke();
  }
}
```

---

## 6. Comprehensive CAD Traceability Matrix

| Pipeline Stage | Invariant Enforcement | Verification Test | Status |
| :--- | :--- | :--- | :--- |
| **1. STEP Ingestion** | AP203/214/242 header extraction, unit normalization | `test_step_format_intelligence_and_brep` | **PASS** |
| **2. Units Datum** | $1\text{ in} = 25.4\text{ mm}$, $1\text{ ft} = 304.8\text{ mm}$ canonical internal mm | `test_unit_conversion_integrity` | **PASS** |
| **3. B-Rep Topology** | 7-Level Hierarchy (`GeoAssembly` $\rightarrow$ `GeoVertex`), Euler-Poincaré closure | `test_canonical_box_brep_structure` | **PASS** |
| **4. Appearance/Color** | Extraction of `COLOUR_RGB` & presentation styles, default $A=1.0$ | `test_step_appearance_metadata` | **PASS** |
| **5. Opacity Governance** | 100% opaque solid shading, no ghosting, depth-buffer occlusion | `test_solid_opacity_render_contract` | **PASS** |
| **6. N-Gon Routing** | `GeomAbs_Plane` routed to `<gmp-polygon-3d>`, zero visible diagonals | `test_native_render_representation_selection` | **PASS** |
| **7. Edge Lines** | High-contrast perimeter stroke along topological boundary wires | `test_boundary_wire_extraction` | **PASS** |
| **8. Infinite Grid** | $304.8\text{ mm}$ ($1'$) spacing invariant across infinite camera range | `test_grid_spatial_invariance` | **PASS** |
| **9. Reversible Export** | Lossless round-trip export to ISO 10303-21 STEP and XBF format | `test_xbf_authoritative_bytes_roundtrip` | **PASS** |

---

## 7. Architectural Directives for Ongoing Development

1. **Primacy of B-Rep Solid Truth:** Visual meshes are temporary rendering caches. Never perform boolean cuts, fillets, or transforms directly on triangle meshes.
2. **Strict Opacity Enforcement:** Solid bodies must never default to translucent styling. Always enforce $A=1.0$ with light boundary edge lines.
3. **Unit Consistency:** Internal calculations remain strictly in linear millimeters (`mm`). Display unit toggles (`in`, `ft`, `cm`, `m`) apply only at UI presentation boundaries.
4. **Seamless Geospatial Projection:** Geodetic conversion ($WGS84$) anchors coordinates at the Fullerton, CA tangent frame ($33.8814^\circ\text{N}, -117.9213^\circ\text{W}, 95.0\text{m}$) without scale or orientation distortion.

---
*End of Master Architectural Specification.*
Please make primatives initialize opaque
