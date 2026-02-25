#!/bin/bash
# 安装 Leipzig SMuFL 音乐字体到系统（供 librsvg/fontconfig 使用）
# 用于解决 Verovio SVG → PNG 渲染时音乐符号显示为方框的问题

FONT_DIR="/usr/local/share/fonts/leipzig"
FONT_URL="https://raw.githubusercontent.com/rism-digital/leipzig/main/Leipzig.otf"

echo "Installing Leipzig music font..."

mkdir -p "$FONT_DIR"

if [ -f "$FONT_DIR/Leipzig.otf" ]; then
  echo "Leipzig.otf already installed at $FONT_DIR"
else
  echo "Downloading Leipzig.otf..."
  curl -fsSL "$FONT_URL" -o "$FONT_DIR/Leipzig.otf"
  if [ $? -ne 0 ]; then
    echo "Failed to download Leipzig.otf"
    exit 1
  fi
  echo "Downloaded Leipzig.otf to $FONT_DIR"
fi

# 刷新 fontconfig 缓存
echo "Refreshing font cache..."
fc-cache -fv "$FONT_DIR" 2>/dev/null || true

# 验证
if fc-list | grep -i "Leipzig" > /dev/null 2>&1; then
  echo "✓ Leipzig font installed and recognized by fontconfig"
else
  echo "⚠ Font installed but not found by fc-list. Check fontconfig."
fi
