"""GeoParametric3D Core Geometry & Protocol Module."""
from .header import XBFHeader, XBF_SIGNATURE, XBF_HEADER_SIZE
from .protocol import BinaryCommandID, FormatType, AttributeMask
from .sdf import regular_ngon_sdf, csg_hole_subtraction