#!/usr/bin/env bash
# 本地静态服务器 + 自动开浏览器。chmod +x serve.sh 后双击或在终端运行。
# 实际工作委托给 serve.py（它带端口重试）。
set -e
cd "$(dirname "$0")"
if   command -v python3 >/dev/null 2>&1; then exec python3 "./serve.py" "$@"
elif command -v python  >/dev/null 2>&1; then exec python  "./serve.py" "$@"
else echo "need python3/python"; exit 1
fi
