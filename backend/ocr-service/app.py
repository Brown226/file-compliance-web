from fastapi import FastAPI, HTTPException
from paddleocr import PaddleOCR
import io, base64
ocr = PaddleOCR(use_angle_cls=True, lang="ch")
app = FastAPI()

@app.post("/api/ocr/base64")
async def ocr_base64(data:dict):
    b64 = data.get("image","")
    if "data:image/" in b64: b64 = b64.split(",",1)[1]
    fb = base64.b64decode(b64)
    result = ocr.ocr(fb)
    text = ""
    if result and isinstance(result, list):
        for page in result:
            if page and isinstance(page, list):
                for item in page:
                    if isinstance(item, list) and len(item) >= 2:
                        text += str(item[1][0]) + chr(10)
    return {"text": text.strip()}

@app.get("/health")
async def health():
    return {"status":"healthy","service":"PaddleOCR"}
