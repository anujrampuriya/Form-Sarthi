#!/usr/bin/env python3
import sys
import json
import os
import warnings
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Suppress PaddlePaddle warnings
os.environ["FLAGS_use_mkldnn"] = "0"
os.environ["GLOG_minloglevel"] = "3"
warnings.filterwarnings("ignore")

import logging
logging.disable(logging.WARNING)

# Load model ONCE in memory
try:
    from paddleocr import PaddleOCR
    # 'en' for English
    reader = PaddleOCR(use_angle_cls=True, lang='en')
except Exception as e:
    print(f"Error loading PaddleOCR: {e}")
    sys.exit(1)

class OCRHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)
        
        try:
            data = json.loads(post_data.decode('utf-8'))
            image_path = data.get('image_path')
            
            if not image_path or not os.path.exists(image_path):
                output = {"error": "Invalid or missing image_path"}
            else:
                result = reader.ocr(image_path)
                
                if not result or not result[0]:
                    output = {"text": "", "confidence": 0}
                else:
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
                    
                    output = {
                        "text": full_text,
                        "confidence": round(avg_confidence, 1)
                    }
        except Exception as e:
            output = {"error": str(e)}
            
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(output, ensure_ascii=False).encode('utf-8'))
        
    def log_message(self, format, *args):
        # Suppress default HTTP logging to keep console clean
        pass

if __name__ == "__main__":
    port = 8090
    server = ThreadingHTTPServer(('127.0.0.1', port), OCRHandler)
    print(f"PaddleOCR HTTP Server running on port {port}")
    sys.stdout.flush()
    server.serve_forever()
