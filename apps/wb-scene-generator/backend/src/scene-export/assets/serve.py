#!/usr/bin/env python3
"""本地静态服务器 + 自动开浏览器。
双击或 `python3 serve.py [port]` 运行。
不指定端口时自动在若干候选端口里挑一个能用的
（Windows 上 Hyper-V/WSL 会保留一部分端口，单端口绑定容易失败）。
"""
import http.server, socketserver, webbrowser, os, sys, functools, socket, errno
os.chdir(os.path.dirname(os.path.abspath(__file__)))
class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

Handler = functools.partial(NoCacheHandler, directory=os.getcwd())

# 若命令行给了端口就只试这个；否则遍历候选端口（避开常见保留）
if len(sys.argv) > 1:
    candidates = [int(sys.argv[1])]
else:
    candidates = [8765, 18765, 28765, 38765, 48765, 50765, 58765, 63765]

httpd, chosen = None, None
for p in candidates:
    try:
        httpd = socketserver.TCPServer(("127.0.0.1", p), Handler)
        chosen = p
        break
    except OSError as e:
        # WinError 10013/10048 (EACCES/EADDRINUSE)、EADDRINUSE
        if e.errno in (errno.EACCES, errno.EADDRINUSE, 10013, 10048):
            print(f"  port {p} unavailable ({e}); try next")
            continue
        raise

if httpd is None:
    # 兜底：让 OS 分配一个临时端口（port=0）
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    chosen = httpd.server_address[1]

with httpd:
    url = f"http://127.0.0.1:{chosen}/viewer.html"
    print(f"Serving at {url}  (Ctrl+C to stop)")
    try: webbrowser.open(url)
    except Exception: pass
    try: httpd.serve_forever()
    except KeyboardInterrupt: print("\nbye")
