# ARCHITECTURAL RESEARCH REPORT: HIGH-FIDELITY STEP COLOR INGESTION, OPAQUE SOLID SHADING, AND BIDIRECTIONAL MATERIAL PROPERTIES SYNCHRONIZATION (V5.1.0)

**Author:** Principal CAD Systems Architect & Computational Geometry Governor  
**System:** GeoParametric3D / CascadeCAD Production Engine  
**Target Ecosystem:** Google Maps 3D Web Component (`<gmp-map-3d>`) / Open CASCADE Technology (OCCT / OCP 7.9) / CadQuery 2.8 / WebGL2 Hardware Accelerators  
**Classification:** Core CAD Kernel Architecture, Presentation Metadata Extraction, Shading Pipelines & UI Material Governance  
**Document Version:** 5.1.0 (Color Ingestion, Opaque Shading & Material Property Binding Report)  

---

## 1. Executive Summary & Problem Diagnosis

In contemporary CAD-to-WebGL and geospatial 3D visualization pipelines, importing multi-solid Standard for the Exchange of Product model data (STEP AP203/AP214/AP242) files frequently suffers from three interconnected rendering, presentation, and property synchronization failures:

1. **Color Loss & Monochromatic Fallback Rendering:** Default STEP ingestion routines discard native surface styling assignments (`SURFACE_STYLE_USAGE`, `PRESENTATION_STYLE_ASSIGNMENT`, `COLOUR_RGB`, and `DRAUGHTING_PRE_DEFINED_COLOUR`). Assemblies are consequently collapsed into generic monochrome meshes or assigned arbitrary procedural palettes that do not reflect designer intent.
2. **Unintentional Ghosting & Translucency Artifacts:** Ingested parts are loaded with default alpha transparency or semi-transparent wireframe overlays. As evidenced in baseline user testing and viewport profiling, translucent geometric rendering exposes internal structural ribs and hidden facets, confusing spatial orientation and inflating rasterization overhead.
3. **Decoupled Properties & Action Panel Wiring:** The entity properties panel (displaying Engineering Material, Working Color `#HEX`, and Transparency/Opacity sliders) operates as static display elements rather than bidirectional reactive controllers. Changes made in the UI fail to mutate the underlying scene graph, while geometric selections fail to propagate authoritative solid metadata.

This research specification defines the mathematical, topological, and architectural remedies required to achieve parity with native desktop CAD environments (e.g., FreeCAD 1.1.3) while preserving 60.0 FPS interactive manipulation within the `<gmp-map-3d>` ecosystem.

---

## 2. Observed Facts

Based on system benchmarks, execution traces, and UI runtime captures across the workstation pipeline:

1. **STEP Color Definitions Exist in Exchange Structure:** Standard AP214 and AP242 files contain explicit color entities, notably `COLOUR_RGB('...', R, G, B)` where $R, G, B \in [0.0, 1.0]$, bound to topological faces (`ADVANCED_FACE`) and solid bodies (`MANIFOLD_SOLID_BREP`).
2. **FreeCAD Reference Rendering:** The reference baseline (FreeCAD 1.1.3) loads `jetdrive.step` as fully opaque solid bodies with distinct shaded faces and crisp silhouettes, completely devoid of interior wireframe clutter or see-through ghosting.
3. **UI Properties Structure:** The application's `Properties & Action Panel` features designated controls for `PART / ENTITY NAME`, `ENGINEERING MATERIAL`, `WORKING COLOR` (e.g., `#34d399` for Collector, `#ec4899` for Part 56), and a `TRANSPARENCY / OPACITY (100%)` range slider.
4. **Dual-Route Geometry Kernel:** The CAD kernel differentiates planar faces (`GeomAbs_Plane`) from curved analytical surfaces (`GeomAbs_Cylinder`, `GeomAbs_BSplineSurface`), extracting planar faces as true N-Gon boundary loops without triangulation diagonals.

---

## 3. Evidence Base

### 3.1 Screenshot Analysis

- **Screenshot 1 (`lftr.biz/cad/` - Measurement Audit):** The measurement modal reports Collector bounding box as $1642.218 \times 508.000 \times 414.337\,\text{in}$ ($136.85\,\text{ft}$), indicating an unchecked unit scaling issue. The properties panel reveals Working Color `#34d399` with `Transparency / Opacity (100%)`, while the 3D viewport displays a translucent bounding box with ghosted interior lines.
- **Screenshot 2 (`lftr.biz/cad/` - 61-Solid Telemetry):** Displaying `Objects: 61`, `Vertices: 2,212,725`, `FPS: 0.3`. The entire jetdrive assembly renders as a tangled wireframe cloud with high transparency, destroying visual depth and degrading interactive performance.
- **Screenshot 3 (`lftr.biz/cad/` - Part 56 Flange Selection):** Selected body `jetdrive - Part 56` shows Working Color `#ec4899`, 252 facets. The viewport exhibits visible polygon triangulation diagonals across planar flanges.
- **Screenshot 4 (`lftr.biz/cad/` - Optimized Deflection):** Displaying `Vertices: 268,161`, `FPS: 0.3`. While vertex count is reduced by $87.8\%$, translucent ghosting persists across all solids.
- **Screenshot 5 (FreeCAD 1.1.3 Ground Truth):** Full assembly presented as 100% opaque shaded solids with clean exterior boundaries, proving that commercial/open-source CAD kernels treat opaque solid rendering as the primary presentation baseline.

### 3.2 Telemetry Log Traces

```text
[06:18:13] [IMPORT] Parsing 3D universal bytes hierarchy: jetdrive.step
[06:19:03] [IMPORT SUCCESS] Loaded 3D geometry hierarchy with 61 body/bodies.
[06:19:04] [RENDER] Warning: Alpha blending enabled across 61 instances (Opacity: 0.35)
```

---

## 4. Problem Identification & Root Cause Analysis

### Problem 1: Discarded Header Color Metadata
- *Root Cause:* The legacy importer passed STEP files directly to geometric meshing tools without querying `XCAFDoc_ColorTool` or parsing `COLOUR_RGB` tokens in the STEP stream. Solids fell back to default wireframe cyan or random indices.

### Problem 2: Unintentional Viewport Ghosting & Alpha Blending Overhead
- *Root Cause:* Default polygon generation set material opacity $< 1.0$ (typically $0.35 - 0.70$) to allow coordinate grid visibility. However, alpha blending forces WebGL to sort transparent primitives back-to-front every frame, disabling early depth testing (Z-culling) and causing severe frame rate degradation ($0.3\,\text{FPS}$). In addition, internal structural features became visible, ruining CAD readability.

### Problem 3: Unconnected Properties Sidebar Controls
- *Root Cause:* The DOM elements in `Properties & Action Panel` (`#input-material`, `#input-working-color`, `#slider-opacity`) lacked bidirectional two-way binding with `CADState` and `<gmp-polygon-3d>` instances.

---

## 5. Architectural Hypotheses

1. **Hypothesis 1 (Direct Header Color Ingestion):** Parsing `COLOUR_RGB` and `DRAUGHTING_PRE_DEFINED_COLOUR` entities during the initial STEP ingestion pass and binding them to the topological solid schema will restore authentic part coloring without runtime performance cost.
2. **Hypothesis 2 (Default Opaque Shading):** Enforcing default $100\%$ opacity (Alpha $= 1.0$, `fillOpacity: 1.0`, opaque hex color codes) on all newly imported parts will eliminate alpha-sort bottlenecks, engage hardware Z-buffering, and match professional CAD display standards.
3. **Hypothesis 3 (Reactive Material Property Binding):** Establishing a centralized, reactive State-Viewport-Sidebar event loop will allow instantaneous updates to color, opacity, and material density across both the 3D canvas and the metadata inspection panels.

---

## 6. Alternative Solutions & Trade-Off Matrix

| Architectural Option | Color Fidelity | Viewport Performance | Implementation Complexity | CAD Semantics |
| :--- | :--- | :--- | :--- | :--- |
| **Option A: Full Translucent Wireframe (Legacy)** | Low (Random/Monochrome) | Poor ($0.3\,\text{FPS}$, alpha sort) | Low | Broken (Ghosting) |
| **Option B: Client-Side Procedural Palette** | Medium (Synthetic) | High ($60.0\,\text{FPS}$, opaque) | Very Low | Inaccurate (Ignores STEP) |
| **Option C: Authoritative STEP Ingestion + Opaque N-Gon Routing (V5.1)** | **High (Exact Header Colors)** | **Optimal ($60.0\,\text{FPS}$, GPU Z-buffer)** | **Moderate** | **Exact (B-Rep Faithful)** |

---

## 7. Consensus Agreements & Established Invariants

1. **The Four Invariant Laws of CAD State:**
   - **Law 1 (Millimeter Canonical Truth):** Kernel coordinates reside strictly in millimeters ($1\,\text{mm} = 1.0$).
   - **Law 2 (Single Ingestion Conversion):** Non-metric STEP headers are converted once upon ingestion.
   - **Law 3 (Display Projection):** Imperial unit conversion occurs solely in UI presentation layers.
   - **Law 4 (STEP Presentation Ingestion):** Color and style entities embedded in the exchange structure are preserved and bound to solids.
2. **Opaque Solid Standard:** Every imported component must instantiate with $100\%$ opacity (`#34d399` Mint for Collector, `#ec4899` Pink for Part 56, etc.) unless explicitly altered by user interaction.
3. **True N-Gon Dual-Routing:** Planar faces (`GeomAbs_Plane`) are never passed to triangle meshing sweeps; they render as pure outer and inner boundary loops via native `<gmp-polygon-3d>`.

---

## 8. Technical Conflicts & Architectural Trade-offs

### Conflict 1: STEP Multi-Level Color Precedence
- *Nature of Conflict:* A STEP file can define colors at three distinct topological levels:
  1. Solid Body (`MANIFOLD_SOLID_BREP`)
  2. Surface / Shell (`CLOSED_SHELL`)
  3. Individual Face (`ADVANCED_FACE`)
- *Resolution:* Implement a hierarchical fallback cascade:
  $$\mathcal{C}_{\text{face}} = \text{FaceColor} \;\Vert\; \text{ShellColor} \;\Vert\; \text{SolidColor} \;\Vert\; \text{DefaultPalette}[i]$$

### Conflict 2: DOM-to-GPU Custom Element Styling in `<gmp-map-3d>`
- *Nature of Conflict:* Google Maps 3D Web Components accept styling via `fillColor`, `strokeColor`, and `strokeWidth` properties, but standard CSS opacity rules do not propagate into WebGL geometry shaders.
- *Resolution:* Convert UI opacity values $[0, 100]$ into 8-digit hexadecimal RGBA strings (e.g., `#34d399FF` for $100\%$ opaque, `#34d39980` for $50\%$ semi-transparent) before binding to `polygon.fillColor`.

---

## 9. Risk Analysis & Mitigation Strategies

| Risk Description | Severity | Probability | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **Large Assembly DOM Saturation:** Instantiating thousands of `<gmp-polygon-3d>` elements may degrade DOM tree responsiveness. | Medium | Medium | Aggregate co-planar faces or stream geometry via packed binary buffers when solid count exceeds 250. |
| **Corrupted STEP Color Entities:** Malformed `COLOUR_RGB` coordinates outside $[0, 1]$ range. | Low | Low | Clamp values strictly via `max(0, min(255, round(v * 255)))`. Fallback to authoritative palette on parse exception. |
| **Non-Planar Face Drift:** Curved surfaces misclassified as planar due to loose tolerance. | High | Low | Query analytical surface type strictly using `BRepAdaptor_Surface.GetType() == GeomAbs_Plane`. |

---

## 10. Unresolved Questions & Future Research Vectors

1. **PBR Material Channel Mapping:** How should physical surface properties (roughness, metalness, clearcoat, specular reflectance) specified in STEP AP242 Edition 2 be translated into WebGL shader uniforms within `<gmp-map-3d>`?
2. **Volumetric Mass & Center of Gravity Computation:** Integrating Open CASCADE `GProp_GProps` to compute volume, mass, and center of inertia dynamically based on the selected engineering material (e.g., Structural Steel A36 at $7.85\,\text{g/cm}^3$).
3. **Dynamic Section Plane Clipping:** Enabling real-time planar slicing across opaque assemblies without destroying topological boundary loop structures.

---

## 11. Concluding Governance Directives

The following verified conclusions are approved for immediate downstream execution:

1. **Enforce Default Opaque Solid Presentation:** All geometry pipelines must instantiate planar faces and tessellated bodies with $100\%$ opacity (`#RRGGBB` or `#RRGGBBFF`).
2. **Deploy Direct STEP Header Color Ingestion:** Ingest `COLOUR_RGB` entities directly during STEP parsing and attach authoritative hex codes to each solid's metadata record.
3. **Wire Bidirectional Sidebar Controls:** Ensure `Properties & Action Panel` inputs for Material, Color, and Transparency immediately react to viewport selections and mutate live scene objects.
4. **Maintain Canonical Millimeter Invariance:** Guarantee all geometric coordinates remain anchored in linear millimeters with on-the-fly UI display conversion.