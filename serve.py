"""Local web server for the Toy Kingdom site.

Usage:  python serve.py            (http://localhost:8080 and http://<Wi-Fi IP>:8080)
        python serve.py 9000       (another port)

Same as `python -m http.server`, but tells browsers to re-check files on every load
(Cache-Control: no-cache), so edits show up immediately instead of from an old cached copy.
"""
import http.server, socket, sys, os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1)); return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()

if __name__ == '__main__':
    ip = lan_ip()
    print(f'Toy Kingdom is running:\n  this PC:        http://localhost:{PORT}')
    if ip: print(f'  same Wi-Fi:     http://{ip}:{PORT}')
    print('Press Ctrl+C to stop.', flush=True)
    http.server.ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
