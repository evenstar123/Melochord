#!/bin/bash
# MeloChord 服务器部署脚本
# 在 Ubuntu 服务器上执行：bash deploy-server.sh
set -e

echo "========================================="
echo "  MeloChord Server Deployment"
echo "========================================="

# --- 1. System update & base packages ---
echo ""
echo "[1/7] Installing system packages..."
apt update -y
apt install -y curl git build-essential libvips-dev tesseract-ocr unzip wget

# --- 2. Node.js 22 ---
echo ""
echo "[2/7] Installing Node.js 22..."
if command -v node &> /dev/null; then
    echo "Node.js already installed: $(node -v)"
else
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt install -y nodejs
    echo "Node.js installed: $(node -v)"
fi

# --- 3. Java 17 (Audiveris dependency) ---
echo ""
echo "[3/7] Installing Java 17..."
if command -v java &> /dev/null; then
    echo "Java already installed: $(java -version 2>&1 | head -1)"
else
    apt install -y openjdk-17-jre-headless
    echo "Java installed: $(java -version 2>&1 | head -1)"
fi

# --- 4. Audiveris ---
echo ""
echo "[4/7] Installing Audiveris 5.9.0..."
if [ -d "/opt/audiveris" ]; then
    echo "Audiveris already exists at /opt/audiveris"
else
    cd /opt
    # Audiveris doesn't provide prebuilt Linux binaries in releases.
    # We'll build from source or use the flatpak/snap approach.
    # For now, clone and build:
    apt install -y gradle
    git clone --depth 1 --branch 5.9.0 https://github.com/Audiveris/audiveris.git /opt/audiveris || \
    git clone --depth 1 https://github.com/Audiveris/audiveris.git /opt/audiveris
    cd /opt/audiveris
    # Build Audiveris
    ./gradlew build -x test 2>&1 | tail -5
    echo "Audiveris built at /opt/audiveris"
    cd ~
fi

# Find the Audiveris run script or jar
AUDIVERIS_PATH=""
if [ -f "/opt/audiveris/build/distributions/Audiveris/bin/Audiveris" ]; then
    AUDIVERIS_PATH="/opt/audiveris/build/distributions/Audiveris/bin/Audiveris"
    chmod +x "$AUDIVERIS_PATH"
elif [ -f "/opt/audiveris/app/build/libs/Audiveris.jar" ]; then
    # Create a wrapper script
    cat > /usr/local/bin/audiveris << 'WRAPPER'
#!/bin/bash
java -jar /opt/audiveris/app/build/libs/Audiveris.jar "$@"
WRAPPER
    chmod +x /usr/local/bin/audiveris
    AUDIVERIS_PATH="/usr/local/bin/audiveris"
fi
echo "Audiveris path: ${AUDIVERIS_PATH:-'(will need manual config)'}"

# --- 5. Clone repository ---
echo ""
echo "[5/7] Cloning MeloChord repository..."
cd ~
if [ -d "melochord" ]; then
    echo "Directory ~/melochord already exists, pulling latest..."
    cd melochord
    git pull
else
    # 需要手动输入 GitHub 凭据，或使用 SSH key
    git clone https://github.com/evenstar123/Molochrod.git melochord
    cd melochord
fi

# --- 6. Install dependencies ---
echo ""
echo "[6/7] Installing npm dependencies..."
npm install

# --- 7. Create .env.local ---
echo ""
echo "[7/7] Creating .env.local..."
if [ ! -f .env.local ]; then
    echo "请手动创建 .env.local 文件并填入 API 密钥："
    echo "  DASHSCOPE_API_KEY=<your-key>"
    echo "  AUDIVERIS_PATH=${AUDIVERIS_PATH}"
    echo "  PORT=4000"
else
    echo ".env.local already exists, skipping"
fi

# --- 8. Install pm2 ---
echo ""
echo "[Bonus] Installing pm2..."
npm install -g pm2

# --- Summary ---
echo ""
echo "========================================="
echo "  Deployment complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. Upload data files from your local machine:"
echo "     scp data/phrase_meta_*.json data/phrase_embeddings_*.bin root@152.42.255.180:~/melochord/data/"
echo ""
echo "  2. Start the server:"
echo "     cd ~/melochord"
echo "     pm2 start 'npm run start:server' --name melochord"
echo ""
echo "  3. Open firewall port 4000:"
echo "     ufw allow 4000"
echo "     ufw allow 22"
echo "     ufw enable"
echo ""
echo "  4. Test:"
echo "     curl http://localhost:4000/api/health"
echo "     Then visit http://152.42.255.180:4000 in browser"
echo ""
