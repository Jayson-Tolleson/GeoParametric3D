"""
GeoParametric3D 64-Byte Universal Magic Header
Section 2: Universal 64-Byte Magic Header & Binary Wire Protocol.
"""
import struct
from typing import Dict, Any, Optional

XBF_SIGNATURE = b"XBF_STRM"
XBF_HEADER_SIZE = 64

class XBFHeader:
    """
    64-Byte Binary Header Definition
    0x00 - 0x07: char[8] magic_signature ("XBF_STRM")
    0x08 - 0x0B: uint32  format_type (0x00=Native, 0x01=STEP, 0x02=Mesh, 0x03=SDF)
    0x0C - 0x0F: uint32  schema_version (0x00000008)
    0x10 - 0x17: uint64  vertex_count
    0x18 - 0x1F: uint64  index_count
    0x20 - 0x23: uint32  interleaved_stride (32 bytes default)
    0x24 - 0x27: uint32  command_id (0x01=Full Sync, 0x02=VBO SubData, 0x03=Matrix, 0x04=Delete)
    0x28 - 0x3F: uint8[24] attribute_mask / reserved
    """
    def __init__(
        self,
        format_type: int = 0,
        schema_version: int = 8,
        vertex_count: int = 0,
        index_count: int = 0,
        interleaved_stride: int = 32,
        command_id: int = 1,
        attribute_mask: bytes = b'\x00' * 24
    ):
        self.signature = XBF_SIGNATURE
        self.format_type = format_type
        self.schema_version = schema_version
        self.vertex_count = vertex_count
        self.index_count = index_count
        self.interleaved_stride = interleaved_stride
        self.command_id = command_id
        self.attribute_mask = attribute_mask.ljust(24, b'\x00')[:24]

    def pack(self) -> bytes:
        hdr = struct.pack(
            '<8sIIQQII24s',
            self.signature,
            self.format_type,
            self.schema_version,
            self.vertex_count,
            self.index_count,
            self.interleaved_stride,
            self.command_id,
            self.attribute_mask
        )
        assert len(hdr) == XBF_HEADER_SIZE, f"Header size must be exactly 64 bytes, got {len(hdr)