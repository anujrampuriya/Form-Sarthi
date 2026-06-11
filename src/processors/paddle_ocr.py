#!/usr/bin/env python3
"""
src/processors/paddle_ocr.py
PaddleOCR wrapper script.

Called from Node.js via child_process.
Reads an image file, runs PaddleOCR, outputs JSON to stdout.

Usage:
    python paddle_ocr.py <image_path>

Output (JSON):
    { "text": "...", "confidence": 95.5 }
"""

import sys
import json
import os

# Suppress PaddlePaddle warnings
os.environ["FLAGS_use_mkldnn"] = "0"
os.environ["GLOG_minloglevel"] = "3"

import warnings
warnings.filterwarnings("ignore")

import logging
logging.disable(logging.WARNING)


def run_ocr(image_path):
    try:
        from paddleocr import PaddleOCR

        # Initialize PaddleOCR
        # use_angle_cls=True for rotated text detection
        # lang='en' for English (also supports 'hi' for Hindi)
        ocr = PaddleOCR(
            use_angle_cls=True,
            lang='en'
        )

        # Run OCR
        result = ocr.ocr(image_path)

        if not result or not result[0]:
            return {"text": "", "confidence": 0}

        # Extract text and confidence
        lines = []
        total_confidence = 0
        count = 0

        for line_data in result[0]:
            if line_data and len(line_data) >= 2:
                text_info = line_data[1]
                if text_info and len(text_info) >= 2:
                    text = text_info[0]
                    conf = text_info[1]
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
