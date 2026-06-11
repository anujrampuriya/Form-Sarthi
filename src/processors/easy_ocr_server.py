#!/usr/bin/env python3
import sys
import json
import os
import warnings
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

warnings.filterwarnings("ignore")

# Load model ONCE in memory
try:
    import easyocr
    # 'en' for English
    reader = easyocr.Reader(['en'], gpu=False, verbose=False)
except Exception as e:
    print(f"Error loading EasyOCR: {e}")
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
                result = reader.readtext(image_path)
                
                if not result:
                    output = {"text": "", "confidence": 0}
                else:
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
    port = 8089
    server = ThreadingHTTPServer(('127.0.0.1', port), OCRHandler)
    print(f"EasyOCR HTTP Server running on port {port}")
    sys.stdout.flush()
    server.serve_forever()
