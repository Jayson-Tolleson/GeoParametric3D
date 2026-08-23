"""GeoParametric3D workstation configuration."""
import os
import pathlib

BASE_DIR = pathlib.Path(__file__).parent.resolve()
STORAGE_ROOT = os.environ.get("GEOPARAMETRIC3D_STORAGE_ROOT", str(BASE_DIR / "data" / "projects"))
TEMP_STORAGE = os.environ.get("GEOPARAMETRIC3D_TEMP_DIR", str(BASE_DIR / "data" / "tmp"))

os.makedirs(STORAGE_ROOT, exist_ok=True)
os.makedirs(TEMP_STORAGE, exist_ok=True)

HOST = os.environ.get("GEOPARAMETRIC3D_HOST", "0.0.0.0")
PORT = int(os.environ.get("GEOPARAMETRIC3D_PORT", 5000))
DEBUG = os.environ.get("GEOPARAMETRIC3D_DEBUG", "False").lower() in ("true", "1", "t")
WORKER_POOL_SIZE = int(os.environ.get("GEOPARAMETRIC3D_WORKERS", 4))

def validate_safe_path(target_path: str, base_directory: str = None) -> str:
    """Validate path to prevent directory traversal outside configured storage."""
    if base_directory is None:
        base_directory = STORAGE_ROOT
    
    resolved_base = pathlib.Path(base_directory).resolve()
    resolved_target = pathlib.Path(target_path).resolve()
    
    try:
        resolved_target.relative_to(resolved_base)
    except ValueError:
        raise SecurityError(f"Path access violation: {target_path} is outside allowed root {base_directory}")
    
    return str(resolved_target)

class SecurityError(Exception):
    pass
