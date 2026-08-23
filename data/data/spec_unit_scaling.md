# TECHNICAL SPECIFICATION: STEP/IMPORT INCH-MM UNIT SCALING & INVARIANCE LAWS

**Document ID:** GP3D-SPEC-UNIT-003  
**Classification:** Unit Subsystem & Physical Scale Standardization  
**Status:** Approved for Production Implementation  
**Version:** 3.2.0  

---

## 1. Defect Audit: The 136-Foot vs. 8-Foot Collector Flange Incident

Inspection of the `Collector` body from the `jetdrive.step` assembly revealed corrupted dimensions:

$$\text{Reported Bounding Box: } 1642.218\,\text{in} \times 508.000\,\text{in} \times 414.337\,\text{in} \quad (\approx 136.85\,\text{ft})$$

### 1.1 Root Cause
1. **Unchecked Millimeter Passage:** The source CAD file was modeled in millimeters ($1642.218\,\text{mm} \approx 64.654\,\text{in} \approx 5.38\,\text{ft}$, totaling $8\,\text{ft}$ for the entire physical jetdrive assembly).
2. **Double Conversion / Missing Header Query:** The legacy parser assumed unstated units were inches, or read millimeter values and appended an `"in"` label without applying the linear scale conversion $\frac{1}{25.4}$.
3. **Visual Corruption:** The 17x scale inflation distorted camera framing, pushed bounding boxes beyond the ground grid, and led to severe clipping.

---

## 2. Invariant Laws of the GeoParametric3D Unit Subsystem

### Law 1: Canonical Internal Millimeter Invariance
All internal coordinates, vertex buffers, edge curves, analytical surface definitions, and spatial indices **must** reside in authoritative linear millimeters (`mm`):

$$\mathcal{U}_{\text{internal}} \equiv \text{mm}$$

### Law 2: Single Ingestion Conversion
Geometry is converted exactly once at the ingestion boundary:

$$\mathbf{p}_{\text{canonical}} = \mathbf{p}_{\text{source}} \times S_{\text{source}\to\text{mm}}$$

### Law 3: UI-Only Display Projection
Imperial values displayed in the UI (e.g. Properties panel, measurement alerts) are computed on-the-fly from canonical millimeters:

$$L_{\text{display\_inches}} = \frac{L_{\text{canonical\_mm}}}{25.4}$$

---

## 3. Authoritative STEP Header Unit Extraction Engine

Every STEP file AP203/AP214/AP242 must be inspected for `SI_UNIT` and `CONVERSION_BASED_UNIT` entities before processing:

```python
import re
from typing import Tuple

def detect_step_units(header_text: str) -> Tuple[str, float]:
    """
    Inspects STEP exchange structure to resolve source unit and linear scale factor to mm.
    """
    # 1. Millimeters (.MILLI., .METRE.)
    if re.search(r"SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)", header_text, re.IGNORECASE) or \
       re.search(r"\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)", header_text, re.IGNORECASE):
        return "mm", 1.0
    
    # 2. Centimeters (.CENTI., .METRE.)
    if re.search(r"SI_UNIT\s*\(\s*\.CENTI\.\s*,\s*\.METRE\.\s*\)", header_text, re.IGNORECASE):
        return "cm", 10.0
    
    # 3. Meters ($, .METRE.) or (*, .METRE.)
    if re.search(r"SI_UNIT\s*\(\s*\$\s*,\s*\.METRE\.\s*\)", header_text, re.IGNORECASE) or \
       re.search(r"SI_UNIT\s*\(\s*\*\s*,\s*\.METRE\.\s*\)", header_text, re.IGNORECASE):
        return "meter", 1000.0
    
    # 4. Inches (CONVERSION_BASED_UNIT('INCH', ...))
    if re.search(r"CONVERSION_BASED_UNIT\s*\(\s*'INCH'", header_text, re.IGNORECASE) or \
       re.search(r"LENGTH_MEASURE_WITH_UNIT\s*\(\s*LENGTH_MEASURE\s*\(\s*25\.4", header_text, re.IGNORECASE) or \
       re.search(r"'INCH'", header_text, re.IGNORECASE):
        return "inch", 25.4
    
    # 5. Feet (CONVERSION_BASED_UNIT('FOOT', ...))
    if re.search(r"CONVERSION_BASED_UNIT\s*\(\s*'FOOT'", header_text, re.IGNORECASE) or \
       re.search(r"'FOOT'", header_text, re.IGNORECASE):
        return "foot", 304.8
    
    # 6. Default to standard metric mm if unspecified
    return "mm", 1.0
```

---

## 4. Measurement & Inspection Standardization

In UI controllers (`toolbar.js`, `ui.js`), dimension measurements must consistently multiply by the unit conversion factor:

```javascript
const bb = sel.bounding_box || {};
const dims = [
  Math.abs((bb.max?.[0] ?? 0) - (bb.min?.[0] ?? 0)),
  Math.abs((bb.max?.[1] ?? 0) - (bb.min?.[1] ?? 0)),
  Math.abs((bb.max?.[2] ?? 0) - (bb.min?.[2] ?? 0))
];
const isImp = CADState.isImperial();
const conv = isImp ? (1.0 / 25.4) : 1.0;
const unitStr = isImp ? 'in' : 'mm';

// Correctly formatted output for Collector:
// 64.654 × 20.000 × 16.312 in (5.38 ft intake collector, 8 ft total assembly)
const formattedDims = dims.map(d => (d * conv).toFixed(3)).join(' × ');
```
