from fastapi import FastAPI, File, UploadFile, HTTPException
from paddleocr import PaddleOCR
import io
import base64

ocr = PaddleOCR(
    use_angle_cls=True,
    lang='ch'
)

app = FastAPI(title="PaddleOCR Service", version="1.0")

def extract_text_from_result(result):
    text = ""
    if result and isinstance(result, list) and len(result) > 0:
        for page in result:
            if page and isinstance(page, list):
                for item in page:
                    if isinstance(item, list) and len(item) >= 2:
                        text += str(item[1][0]) + "\n"
    return text.strip()

def log_to_file(message):
    with open('/app/ocr_logs.txt', 'a', encoding='utf-8') as f:
        f.write(message + '\n')

@app.post("/api/ocr")
async def ocr_image(file: UploadFile = File(...)):
    contents = await file.read()
    
    try:
        result = ocr.ocr(contents)
        log_to_file(f"OCR result type: {type(result)}")
        log_to_file(f"OCR result repr: {repr(result)[:2000]}")
        
        text = extract_text_from_result(result)
        log_to_file(f"Extracted text length: {len(text)}")
        log_to_file(f"Extracted text: {text[:1000]}")
        return {"text": text}
    except Exception as e:
        log_to_file(f"Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/ocr/base64")
async def ocr_base64(data: dict):
    base64_data = data.get("image", "")
    if not base64_data:
        raise HTTPException(status_code=400, detail="缺少图片数据")
    
    try:
        if 'data:image/' in base64_data:
            base64_data = base64_data.split(',')[1]
        
        image_data = base64.b64decode(base64_data)
        result = ocr.ocr(image_data)
        text = extract_text_from_result(result)
        return {"text": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "PaddleOCR"}

@app.get("/models")
async def get_models():
    return {"models": ["PaddleOCR-v3.3.1 (ch)"]}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
