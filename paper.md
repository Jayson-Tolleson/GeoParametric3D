# MASTER ARCHITECTURAL SPECIFICATION: AUTHORITATIVE UNIT SUBSYSTEM & CANONICAL PIPELINE STANDARDIZATION

**System:** GeoParametric3D Authoritative Cloud CAD/CAM Workstation  
**Document Version:** 8.0.0-PROD-STANDARDIZATION  
**Status:** Mandatory Architectural Invariant  
**Classification:** Core Geometry, B-Rep Ingestion & Geospatial Coordinate Contract  

---

## 1. Executive Summary & Root-Cause Forensic Audit

A cross-subsystem forensic audit evaluated ingestion vectors, kernel transformations, B-Rep construction stages, rendering projections, and frontend serialization pathways to resolve unit scaling discrepancies and bridge desktop/cloud pipelines.

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
4. **Layer D (Frontend Unit Drift):** Measurement tools and inspection handlers evaluated `extents_mm` using arbitrary multiplication factors instead of strict single-point division by authoritative constants ($25.4$ for inches, $304.8$ for feet).

---

## 2. Standardized File Tree Strategy

```
.
├── README.md
├── requirements.txt
├── gen.py
└── src/
    ├── __init__.py
    ├── config.py             # UI Button Schemas, Gizmo States, Streaming Config
    ├── core/
    │   ├── __init__.py
    │   ├── header.py         # 64-Byte Magic Header Definition
    │   ├── protocol.py       # Wire Protocol & Binary Commands
    │   └── sdf.py            # Analytical N-Gon / Hole SDF Formulas
    ├── ui/
    │   ├── __init__.py
    │   ├── app_window.py     # Main Desktop Window Container
    │   ├── gizmo_sliders.py  # 3D Arrow-Slider Gizmo Event Handlers
    │   └── toolbar.py        # 70-80 CAD Operation Button Registration
    ├── importers/
    │   ├── __init__.py
    │   ├── base.py
    │   ├── occt_importer.py  # STEP/IGES CAD B-Rep Engine
    │   ├── trimesh_importer.py
    │   └── xbf_importer.py   # Native mmap Reader
    ├── server/
    │   ├── __init__.py
    │   ├── app.py            # FastAPI/Quart Binary WebSocket Streaming Server
    │   └── backpressure.py   # Frame Flow & Backpressure Control
    └── client/
        ├── index.html        # OGL / Maps 3D Viewport Interface
        └── js/
            └── stream_parser.js # ArrayBuffer Zero-Copy VBO Ingestion
```

---

## 3. Authoritative Unit Subsystem & Conversion Constants

Canonical internal length truth is strictly **Linear Millimeters ($\text{mm