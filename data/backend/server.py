from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
import uvicorn
import os
from backend.cad_kernel import CADKernelPipeline, SITE_ANCHOR

app = FastAPI(title="GeoParametric3D CAD & WebGL Pipeline Server", version="5.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pipeline = CADKernelPipeline()
LATEST_ASSEMBLY_DATA = None

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "version": "5.0.0",
        "site_anchor": SITE_ANCHOR,
        "engine": "OpenCASCADE / GeoParametric3D"
    }

@app.get("/api/telemetry")
async def get_telemetry():
    log_path = "sys_telemetry.log"
    if not os.path.exists(log_path):
        return {"lines": []}
    try:
        with open(log_path, "r", encoding="utf-8") as f:
            lines = f.readlines()[-100:]
        return {"lines": [line.strip() for line in lines]}
    except Exception as e:
        return {"lines": [f"Error reading telemetry: {str(e)}"]}

@app.post("/api/import/step")
async def import_step_file(file: UploadFile = File(...)):
    global LATEST_ASSEMBLY_DATA
    try:
        content = await file.read()
        result = pipeline.parse_step_data(content, filename=file.filename)
        LATEST_ASSEMBLY_DATA = result
        return result
    except Exception as e:
        pipeline.log(f"[IMPORT ERROR] Failure parsing {file.filename}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/assembly/current")
async def get_current_assembly():
    if not LATEST_ASSEMBLY_DATA:
        # Return default loaded demo
        default_demo = pipeline.parse_step_data(b"ISO-10303-21; ( .MILLI. , .METRE. );", "jetdrive_collector.step")
        return default_demo
    return LATEST_ASSEMBLY_DATA

if __name__ == "__main__":
    uvicorn.run("backend.server:app", host="0.0.0.0", port=8000, reload=True)
