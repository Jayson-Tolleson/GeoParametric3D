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

## 2. Invariant Architecture Principles

1. **Primacy of B-Rep Geometry:** Exact topological representations (GeoPart, GeoSolid, GeoShell, GeoFace, GeoLoop, GeoEdge, GeoVertex) remain authoritative truth.
2. **Color Ingestion from STEP Header:** Extract exact `COLOUR_RGB` and `PRESENTATION_STYLE_ASSIGNMENT` attributes mapped directly to solids during parsing.
3. **Default 100% Opaque Rendering:** All solids and faces default to 1.0 opacity (`#RRGGBB` with no alpha blending) to enable hardware Z-buffering, eliminating back-to-front sorting bottlenecks and match FreeCAD presentation standards.
4. **Bidirectional Material & Property Synchronization:** Sidebar UI directly mutates live CADObject material, color, and opacity attributes and updates all active viewport overlays.
