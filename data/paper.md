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
2. **Unintentional Ghosting & Translucency Artifacts:** Ingested parts are loaded with default alpha transparency or semi-transparent wireframe overlays. As evidenced in baseline user testing and viewport profiling, translucent geometric rendering exposes internal structural ribs and hidden facets, confusing spatial orientation, disabling hardware early-Z occlusion culling, and inflating rasterization overhead.
3. **Decoupled Properties & Action Panel Wiring:** The entity properties panel (displaying Engineering Material, Working Color `#HEX`, and Transparency/Opacity sliders) operates as static display elements rather than bidirectional reactive controllers. Changes made in the UI fail to mutate the underlying scene graph, while geometric selections fail to propagate authoritative solid metadata.

Version 5.1.0 establishes **STEP Header Presentation Style & Color Extraction**, **100% Opaque Solid Shading Baseline (FreeCAD Standard Parity)**, and **Bidirectional UI-State-Viewport Property Synchronization**.

---

## 2. Invariant Laws of CAD Presentation & Property Governance

### 2.1 The Four Invariant Laws of CAD State

1. **Law 1 (Millimeter Canonical Truth):** Kernel coordinates reside strictly in millimeters ($1\,\text{mm} = 1.0$) across all internal topological buffers.
2. **Law 2 (Single Ingestion Scale Commitment):** Non-metric STEP headers are evaluated once at ingestion and converted definitively into canonical linear millimeters.
3. **Law 3 (Display Projection Invariance):** Imperial unit conversions occur solely on-the-fly during UI rendering without mutating internal geometric definitions.
4. **Law 4 (Authoritative Presentation & Opaque Standard):** Color and presentation styles defined in STEP exchange headers (`COLOUR_RGB`) are extracted at ingestion, bound to solids/faces, and rendered with default $100\%$ opacity (Alpha $= 1.0$), engaging GPU hardware depth buffering (Z-culling) to eliminate ghosting and sustain $60.0\,\text{FPS}$.

---

## 3. Implementation Blueprint

### 3.1 Header Color Extraction Pipeline
During byte ingestion in `universal_byte_parser.py`, regex and XCAF scanners capture `COLOUR_RGB` definitions and map them in order of subpart traversal:

```python
def extract_step_colors_from_header(header_text: str) -> List[str]:
    color_matches = re.findall(
        r"COLOUR_RGB\s*\(\s*(?:'[^']*')?\s*,\s*([\-+]?\d*\.?\d+(?:[eE][\-+]?\d+)?)\s*,\s*([\-+]?\d*\.?\d+(?:[eE][\-+]?\d+)?)\s*,\s*([\-+]?\d*\.?\d+(?:[eE][\-+]?\d+)?)\s*\)",
        header_text,
        re.IGNORECASE
    )
    # Normalizes float RGB in [0, 1] to 6-digit hex format #RRGGBB
    return [rgb_to_hex(float(r), float(g), float(b)) for r, g, b in color_matches]
```

### 3.2 Bidirectional Reactive Properties Binding
In `ui.js`, `viewport.js`, and `state.js`, property panel inputs (`#prop-material`, `#prop-color`, `#prop-opacity`) immediately write to `CADState.getSelectedObject()`, trigger native `<gmp-polygon-3d>` attribute synchronization, invalidate the overlay canvas cache, and dispatch authoritative `set_property` commands to the backend gateway.
