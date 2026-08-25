# MASTER TECHNICAL ARCHITECTURAL SPECIFICATION: GEOPARAMETRIC3D V8.0
**Author:** Lead Systems Architect, GeoParametric3D  
**Classification:** Core Kernel, B-Rep Topology, Zero-Copy Binary Protocol & Geospatial Engine  
**Status:** Authoritative Production Standard  

---

## 1. System Topology & Standardized File Tree Strategy

GeoParametric3D separates mathematical B-Rep topology (authoritative truth) from GPU render buffers (derived approximations). The system deploys as a hybrid architecture: a high-throughput Python CAD kernel (OpenCASCADE / VisPy / NumPy) driving client-side rendering (`<gmp-map-3d>` / WebGL2 / OGL) via low-latency binary streams.

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

## 2. Universal 64-Byte Magic Header & Binary Wire Protocol

All geometric payloads, on-disk caches (`.xbf`), and network frames adhere to a fixed 64-byte aligned header. The client parses only the first 64 bytes to establish memory offsets and GPU allocations.

### 2.1 64-Byte Binary Header Memory Map

| Byte Offset | Data Type | Field Name | Description |
| :--- | :--- | :--- | :--- |
| `0x00 - 0x07` | `char[8]` | `magic_signature` | `"XBF_STRM"` (ASCII validation) |
| `0x08 - 0x0B` | `uint32` | `format_type` | `0x00`: Native XBF, `0x01`: STEP B-Rep, `0x02`: Mesh, `0x03`: SDF Quad |
| `0x0C - 0x0F` | `uint32` | `schema_version` | Engine schema revision (`0x00000008`) |
| `0x10 - 0x17` | `uint64` | `vertex_count` | Total vertex count $N$ |
| `0x18 - 0x1F` | `uint64` | `index_count` | Total index count $M$ (or 0 for point cloud/SDF) |
| `0x20 - 0x23` | `uint32` | `interleaved_stride`| Byte stride per vertex (e.g., `32` for `[Pos(12B), Norm(12B), UV(8B)]`) |
| `0x24 - 0x27` | `uint32` | `command_id` | `0x01`: Full Sync, `0x02`: VBO SubData, `0x03`: Matrix Update, `0x04`: Delete |
| `0x28 - 0x3F` | `uint8[24]` | `attribute_mask` | Bitfield flags (Bit 0: Pos, 1: Norm, 2: UV, 3: Color, 4: FaceID, 5: Tangents) |

### 2.2 Interleaved Vertex Layout (32-Byte Stride)
To prevent GPU memory bus stalls and ensure direct `Float32Array` zero-copy transfer:
* **`Offset 0x00` (12 Bytes):** `Position_XYZ` (3 $\times$ `Float32`)
* **`Offset 0x0C` (12 Bytes):** `Normal_XYZ` (3 $\times$ `Float32`)
* **`Offset 0x18` (8 Bytes):** `TexCoord_UV` / `Feature_ID` (2 $\times$ `Float32` / `UInt32`)

---

## 3. Authoritative Unit Subsystem & Dimensionless Mathematical Scaling

Canonical internal length truth is strictly **Linear Millimeters ($\text{mm