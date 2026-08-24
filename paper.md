# MASTER ARCHITECTURAL SPECIFICATION: AUTHORITATIVE UNIT SUBSYSTEM & CANONICAL PIPELINE STANDARDIZATION

**System:** GeoParametric3D Authoritative Cloud CAD/CAM Workstation  
**Document Version:** 7.0.0-PROD-STANDARDIZATION  
**Status:** Mandatory Architectural Invariant  
**Classification:** Core Geometry, B-Rep Ingestion & Geospatial Coordinate Contract  

---

## 1. Executive Summary & Root-Cause Forensic Audit

A rigorous cross-subsystem audit evaluated every ingestion vector, kernel transformation, B-Rep construction stage, rendering projection, and frontend serialization pathway to resolve scale discrepancies across imports and native modeling primitives.

```
+-------------------------------------------------------------------------------------------------------+
|                                  INSPECTION & INGESTION TAXONOMY                                      |
+-------------------------------------------------------------------------------------------------------+
| A. STEP Reader Scale Fault     | TopoDS_Shape length units mismatched with declared exchange scale     |
| B. Canonical Distortion        | Ingestion pipeline applied redundant conversion multipliers          |
| C. Tessellation Scaling Fault  | Chordal deflection evaluated in disparate unit space                  |
| D. Viewport Adapter Corruption | UI layer scaled underlying geometries instead of presentation values |
| E. Geodetic Projection Error   | Local mm -> WGS84 Geodetic conversion double-scaled meter altitudes  |
+-------------------------------------------------------------------------------------------------------+
```

### Forensic Diagnosis Across Architecture Layers

1. **Layer A (STEP Header vs Kernel Read):** `STEPControl_Reader` without explicit unit static configuration defaulted coordinates to millimeter assumptions regardless of whether `CONVERSION_BASED_UNIT('INCH', ...)` or `LENGTH_UNIT()` was declared in the STEP schema.
2. **Layer B (Canonical Transformation Multiplication):** The parser extracted `scale_to_canonical` from header tokens, yet simultaneously accepted OCCT coordinates where internal scaling had already been executed, causing $(25.4)^2$ double-scaling on inch models.
3. **Layer C (Tessellation Metric):** Linear deflection was hardcoded to scalar constants ($0.1$) without adjusting for bounding box diagonal metrics expressed in canonical millimeters.
4. **Layer D (Frontend Unit Drift):** Measurement tools and inspection handlers evaluated `extents_mm` using raw division factors disconnected from the authoritative conversion constant $\mathbf{C