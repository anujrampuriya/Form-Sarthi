#!/usr/bin/env python3
import sys
import json
import os

# Suppress warnings
import warnings
warnings.filterwarnings("ignore")

def run_ocr(image_path):
    try:
        import easyocr
        # Disable GPU if cuda is not available, but easyocr will handle it automatically
        # 'en' for English, 'hi' for Hindi
        reader = easyocr.Reader(['en'], gpu=False, verbose=False)
        result = reader.readtext(image_path)

        if not result:
            return {"text": "", "confidence": 0}

        lines = []
        total_confidence = 0
        count = 0

        for item in result:
            text = item[1]
            conf = item[2]
            lines.append(text)
            total_confidence += conf
            count += 1

        full_text = "\n".join(lines)
        avg_confidence = (total_confidence / count * 100) if count > 0 else 0

        return {
            "text": full_text,
            "confidence": round(avg_confidence, 1)
        }

    except Exception as e:
        return {
            "text": "",
            "confidence": 0,
            "error": str(e)
        }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No image path provided", "text": "", "confidence": 0}))
        sys.exit(1)

    image_path = sys.argv[1]

    if not os.path.exists(image_path):
        print(json.dumps({"error": f"File not found: {image_path}", "text": "", "confidence": 0}))
        sys.exit(1)

    result = run_ocr(image_path)
    print(json.dumps(result, ensure_ascii=False))
