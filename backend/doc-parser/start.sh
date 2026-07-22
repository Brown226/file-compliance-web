#!/bin/bash
# ============================================
# 文档解析服务 - 本地开发启动脚本
# 各格式使用独立增强解析器（原生 Python 库），不依赖 markitdown
# 用法: ./start.sh [端口号]
#   默认端口 8000，可自定义: ./start.sh 8001
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 端口配置：优先使用参数，其次环境变量 PORT，默认 8000
PORT="${1:-${PORT:-8000}}"

echo "============================================"
echo " 文档解析服务 - 开发模式"
echo "============================================"

# 检查 Python
if ! command -v python &> /dev/null; then
    echo "❌ 未找到 Python，请先安装 Python 3.10+"
    exit 1
fi

PYTHON_VERSION=$(python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "✅ Python $PYTHON_VERSION"

# 创建虚拟环境（如果不存在）
VENV_DIR="$SCRIPT_DIR/.venv"
if [ ! -d "$VENV_DIR" ]; then
    echo "📦 创建虚拟环境..."
    python -m venv "$VENV_DIR"
fi

# 激活虚拟环境
source "$VENV_DIR/bin/activate" 2>/dev/null || source "$VENV_DIR/Scripts/activate" 2>/dev/null

# 安装依赖
echo "📦 安装依赖..."
pip install --quiet -r "$SCRIPT_DIR/requirements.txt"

# 启动服务
echo ""
echo "🚀 启动服务 (http://localhost:${PORT}) ..."
echo "   API 文档: http://localhost:${PORT}/docs"
echo ""
export PORT
python "$SCRIPT_DIR/main.py"
