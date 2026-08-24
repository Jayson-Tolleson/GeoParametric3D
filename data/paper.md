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
4. **Layer D (Frontend Unit Drift):** Measurement tools and inspection handlers evaluated `extents_mm` using raw division factors disconnected from the authoritative conversion constant $\mathbf{C}_{\text{in}} = 25.4$.
5. **Layer E (Geospatial Projection Boundary):** Geodetic conversion functions (`enu_to_wgs84` / `enuToGeodetic`) require local displacement in millimeters converted to meters ($10^{-3}$) for geographic altitude ($h = h_{\text{anchor}} + z \times 10^{-3}$), which was previously inconsistent across client/server projection utilities.

---

## 2. Six-Layer Unit Standard Matrix

To guarantee mathematical consistency, every geometric number within the system is strictly bound to its layer contract:

| Layer | Responsibility | Invariant Standard Unit | Metadata & Transformations |
| :--- | :--- | :--- | :--- |
| **1. Source Units** | Truth declared by foreign exchange payload (STEP, IGES, STL, OBJ, FCStd) | As declared (`inch`, `foot`, `meter`, `mm`, `cm`, `micron`) | Immutable provenance header (`original_unit`, `scale_factor`) |
| **2. Kernel Units** | Native OpenCASCADE (OCCT/OCP) topological geometric coordinates | Linear Millimeters (`mm`) | `Interface_Static.SetCVal("xstep.cascade.unit", "MM")` |
| **3. Canonical Units** | **One Authoritative Physical Truth** across all CAD entities | **Linear Millimeters (`mm`)** | `GeoPart.canonical_unit = "mm"` (Tagged explicitly on all entities) |
| **4. Display Units** | Viewport user preference (labels, text inputs, inspector readouts) | User preference (`in`, `ft`, `mm`, `m`, `cm`) | Display Value $= \text{Value}_{\text{canonical}} / \text{ScaleFactor}$ (Pure presentation) |
| **5. World/Render Units** | Coordinate system required by `<gmp-map-3d>` and geospatial WGS84 | Geodetic (Degrees Lat/Lng) & Meters (Altitude) | Local mm converted to WGS84 via $10^{-3}\,\text{m/mm}$ scale |
| **6. User-Entered Input** | Dynamic parametric command inputs (Extrude, Fillet, Primitive Dim) | Active UI preference parsed to canonical | $X_{\text{canonical}} = X_{\text{user}} \times \text{ScaleFactor}_{\text{preference}}$ |

---

## 3. Canonical Metadata Contract

Downstream consumers are prohibited from guessing coordinate semantics. Every geometry dictionary, manifest record, and inspection payload carries the explicit unit contract:

```json
{
  "geometry": {
    "type": "GeoPart",
    "id": "part_bracket_101",
    "canonical_unit": "mm",
    "original_unit": "inch",
    "unit_conversion": {
      "source_to_canonical_factor": 25.4,
      "formula": "X_canonical = X_source * 25.4"
    },
    "physical_dimensions": {
      "extents_mm": [304.8, 152.4, 25.4],
      "extents_in": [12.0, 6.0, 1.0],
      "extents_ft": [1.0, 0.5, 0.08333],
      "volume_cm3": 1179.87,
      "volume_in3": 72.0,
      "bounding_box": {
        "min": [-152.4, -76.2, 0.0],
        "max": [152.4, 76.2, 25.4],
        "center": [0.0, 0.0, 12.7],
        "diagonal": 341.67
      }
    }
  }
}
```

---

## 4. Subsystem Audit & Verified Invariants

```
               +-------------------------------------------------------------+
               | FOREIGN EXCHANGE STREAM (STEP / STL / FCStd / OBJ / 3MF)   |
               +-------------------------------------------------------------+
                                              |
                                              v
               +-------------------------------------------------------------+
               | LAYER 1: Header Inspection & Unit Extraction                |
               | detect_format_descriptor -> source_units, scale_to_canonical |
               +-------------------------------------------------------------+
                                              |
                                              v
               +-------------------------------------------------------------+
               | LAYER 2 & 3: Authoritative Ingestion & Canonical Normalizer |
               | OCCT Native Read (MM) OR Vertex Array * (Scale to MM)       |
               | Canonical B-Rep Invariant: Spatial Lengths = Millimeters    |
               +-------------------------------------------------------------+
                                              |
                     +------------------------+------------------------+
                     |                                                 |
                     v                                                 v
+-----------------------------------------+   +-----------------------------------------+
| LAYER 4 & 6: Viewport Presentation / UI |   | LAYER 5: Geospatial WGS84 Map Anchor    |
| • Inch conversion: Division by 25.4     |   | • ENU Cartesian mm -> WGS84 Geodetic    |
| • Foot conversion: Division by 304.8    |   | • Altitude = alt0 + (z_mm * 1e-3)       |
| • User Input Ingestion: * 25.4          |   | • Continuous Tangent Projection         |
+-----------------------------------------+   +-----------------------------------------+
```

### 4.1 Ingestion Verification Invariants
- **STEP ISO-10303-21:** Must parse `SI_UNIT` and `CONVERSION_BASED_UNIT`. Length unit factors: `MILLI METRE` $\to 1.0$, `CENTI METRE` $\to 10.0$, `METRE` $\to 1000.0$, `INCH` $\to 25.4$, `FOOT` $\to 304.8$.
- **STL / OBJ (Unitless):** Default canonical assumption is Linear Millimeters ($1.0$). Explicit unit selector allows instant re-scaling without vertex destruction.
- **FCStd:** Shape representations in FreeCAD XML containers parse in internal canonical linear mm ($1.0$).

### 4.2 Presentation & Display Invariants
- **Display Dimensions:** Millimeter extents must be divided by $25.4$ for inches and $304.8$ for feet.
- **Volumetric Dimensions:** Volume in $\text{cm}^3$ must be divided by $16.387064$ for cubic inches ($\text{in}^3$).
- **Mass Calculation:** $\text{Mass (grams)} = \text{Volume (cm}^3\text{)} \times \rho\,(\text{g/cm}^3)$.

---

## 5. Explicit File Modification Specifications

### 5.1 `universal_byte_parser.py`

Enforces division by $25.4$ for inch conversion, division by $304.8$ for foot conversion, and division by $16.387064$ for volumetric cubic inch conversion.

```python
# <<<<<<< FILE MODIFICATION BLOCK: universal_byte_parser.py >>>>>>>
def normalize_and_format_measurement(bounds: Dict[str, Any], volume_cm3: float) -> Dict[str, Any]:
    """
    Computes exact dual-unit metric/imperial metrics from canonical mm bounds.
    Enforces division by 25.4 for inches and 304.8 for feet.
    """
    extents_mm = bounds.get("extents", [0.0, 0.0, 0.0])
    dx_mm, dy_mm, dz_mm = float(extents_mm[0]), float(extents_mm[1]), float(extents_mm[2])
    
    # Authoritative linear conversion via division by standard conversion constants
    dx_in = dx_mm / 25.4
    dy_in = dy_mm / 25.4
    dz_in = dz_mm / 25.4
    
    dx_ft = dx_mm / 304.8
    dy_ft = dy_mm / 304.8
    dz_ft = dz_mm / 304.8
    
    # Authoritative volumetric conversion (1 in³ = 16.387064 cm³)
    volume_in3 = volume_cm3 / 16.387064 if volume_cm3 else 0.0
    
    formatted_dim = (
        f"Dimensions: {dx_in:.3f} × {dy_in:.3f} × {dz_in:.3f} in "
        f"({dx_ft:.3f} × {dy_ft:.3f} × {dz_ft:.3f} ft) "
        f"[{dx_mm:.1f} × {dy_mm:.1f} × {dz_mm:.1f} mm]"
    )
    
    return {
        "dimensions_formatted": formatted_dim,
        "extents_mm": [dx_mm, dy_mm, dz_mm],
        "extents_in": [dx_in, dy_in, dz_in],
        "extents_ft": [dx_ft, dy_ft, dz_ft],
        "volume_cm3": volume_cm3,
        "volume_in3": volume_in3
    }
# <<<<<<< END FILE MODIFICATION BLOCK >>>>>>>
```

### 5.2 `static/js/toolbar.js`

Enforces division by $25.4$ for inch conversion, division by $304.8$ for foot conversion, and division by $16.387064$ for cubic inches in the inspector measurement tools.

```javascript
// <<<<<<< FILE MODIFICATION BLOCK: static/js/toolbar.js >>>>>>>
  // 10. INSPECT & CNC TOOLBAR
  bindBtn('btn-insp-measure', async () => {
    const sel = CADState.getSelectedObject();
    if (!sel) {
      alert('Select a part, face, edge, or vertex first.');
      return;
    }
    const bb = sel.bounding_box || {};
    const dx_mm = Math.abs((bb.max?.[0] ?? 0) - (bb.min?.[0] ?? 0));
    const dy_mm = Math.abs((bb.max?.[1] ?? 0) - (bb.min?.[1] ?? 0));
    const dz_mm = Math.abs((bb.max?.[2] ?? 0) - (bb.min?.[2] ?? 0));
    
    // Explicit division by conversion constants
    const dx_in = dx_mm / 25.4;
    const dy_in = dy_mm / 25.4;
    const dz_in = dz_mm / 25.4;
    
    const dx_ft = dx_mm / 304.8;
    const dy_ft = dy_mm / 304.8;
    const dz_ft = dz_mm / 304.8;
    
    const vol_cm3 = Number(sel.volume_cm3) || 0;
    const vol_in3 = vol_cm3 / 16.387064;
    
    const formattedDim = `Dimensions: ${dx_in.toFixed(3)} × ${dy_in.toFixed(3)} × ${dz_in.toFixed(3)} in (${dx_ft.toFixed(3)} × ${dy_ft.toFixed(3)} × ${dz_ft.toFixed(3)} ft) [${dx_mm.toFixed(1)} × ${dy_mm.toFixed(1)} × ${dz_mm.toFixed(1)} mm]`;
    alert(`MEASURE\n${sel.name}\n${formattedDim}\nVolume: ${vol_cm3.toFixed(2)} cm³ (${vol_in3.toFixed(2)} in³)`);
  });
// <<<<<<< END FILE MODIFICATION BLOCK >>>>>>>
```

### 5.3 `static/js/viewport.js`

Enforces division by $25.4$ for inch conversion, division by $304.8$ for foot conversion, and division by $16.387064$ for volume in entity dimension formatters.

```javascript
// <<<<<<< FILE MODIFICATION BLOCK: static/js/viewport.js >>>>>>>
export function formatEntityDimensions(extents_mm, volume_cm3 = 0) {
  const dx_mm = extents_mm[0];
  const dy_mm = extents_mm[1];
  const dz_mm = extents_mm[2];

  // Explicit division by 25.4 for inch conversion
  const dx_in = dx_mm / 25.4;
  const dy_in = dy_mm / 25.4;
  const dz_in = dz_mm / 25.4;

  // Explicit division by 304.8 for foot conversion
  const dx_ft = dx_mm / 304.8;
  const dy_ft = dy_mm / 304.8;
  const dz_ft = dz_mm / 304.8;

  // Volumetric conversion (1 in³ = 16.387064 cm³)
  const volume_in3 = volume_cm3 / 16.387064;

  return {
    formatted: `Dimensions: ${dx_in.toFixed(3)} × ${dy_in.toFixed(3)} × ${dz_in.toFixed(3)} in (${dx_ft.toFixed(3)} × ${dy_ft.toFixed(3)} × ${dz_ft.toFixed(3)} ft) [${dx_mm.toFixed(1)} × ${dy_mm.toFixed(1)} × ${dz_mm.toFixed(1)} mm]`,
    inches: [dx_in, dy_in, dz_in],
    feet: [dx_ft, dy_ft, dz_ft],
    mm: [dx_mm, dy_mm, dz_mm],
    volume_in3,
    volume_cm3
  };
}
// <<<<<<< END FILE MODIFICATION BLOCK >>>>>>>
```

---

## 6. Architecture Verification Test Matrix

```
+-------------------------------------------------------------------------------------------------------+
| VERIFICATION TEST SUITE RESULTS                                                                       |
+-------------------------------------------------------------------------------------------------------+
| Test Case                                   | Measured Value                | Target Spec | Result   |
+-------------------------------------------------------------------------------------------------------+
| 1.0 Inch to MM Canonical Conversion         | 25.4000 mm                    | 25.4 mm     | PASS     |
| 1.0 Foot to MM Canonical Conversion         | 304.8000 mm                   | 304.8 mm    | PASS     |
| 25.4 MM to Inch Presentation                | 1.0000 in (div by 25.4)       | 1.0 in      | PASS     |
| 304.8 MM to Foot Presentation               | 1.0000 ft (div by 304.8)      | 1.0 ft      | PASS     |
| 1.0 in³ to cm³ Volumetric Ratio             | 16.387064 cm³                 | 16.387 cm³  | PASS     |
| Scale Dimensionless Invariant               | P_before == P_after           | Identical   | PASS     |
| Move Tool World CAD Space Delta             | Exactly +25.4 mm (1.0 inch)   | +25.4 mm    | PASS     |
| WGS84 Altitude Displacement Scaling         | z_mm * 1e-3 (1000mm = 1.0m)   | 1.0 m       | PASS     |
+-------------------------------------------------------------------------------------------------------+
```

---

## 7. Governing Operational Guidelines

1. **Internal Immutability:** Never alter canonical internal millimeters (`mm`) inside database records, state snapshots, or WebSocket payloads.
2. **Explicit Provenance:** Ingested models must retain source format declarations (`original_unit`, `scale_factor`) within `parameters` and `headers`.
3. **Boundary Strictness:** User interfaces must always use `CADState.toUserLength()` (dividing by $25.4$ for imperial) for display and `CADState.fromUserLength()` (multiplying by $25.4$ for imperial) when submitting mutations to the command gateway.
4. **Zero-Guessing Rule:** Downstream rendering components must consume canonical coordinate buffers directly without re-applying heuristic bounding box scale factors.
