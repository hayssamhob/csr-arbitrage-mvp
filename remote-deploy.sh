#!/bin/bash
set -e

# ==============================================================================
# Remote Deployment Script for Google Antigravity
# Deploys the Dockerized Event-Driven Architecture to Vultr
# ==============================================================================

# 1. Configuration - Defaults mapped to user provided info
SERVER_IP="45.32.186.34"
SERVER_USER="root"
SSH_KEY="${HOME}/.ssh/csr-arbitrage-key"
REMOTE_DIR="/root/csr-arbitrage-docker"
ENV_FILE="backend/.env"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting Deployment to ${SERVER_IP}...${NC}"

# 2. Check Prerequisites
if [ ! -f "$SSH_KEY" ]; then
    echo "❌ SSH Key not found at $SSH_KEY"
    echo "Please ensure the key exists or update the script."
    exit 1
fi

# 3. Prepare Environment Variables
# We need to extract RPC_URL from the remote .env if we don't have it locally,
# or we assume the user has a local .env.
# For safety, let's copy the remote .env from the legacy backend if strictly relevant,
# BUT we are adding new env vars (REDIS_URL).
# Strategy: We'll create a .env file for docker-compose based on what we know.

echo -e "${YELLOW}📥 Fetching existing .env for RPC_URL...${NC}"
# Try to grep RPC_URL from remote
RPC_URL=$(ssh -i "$SSH_KEY" $SERVER_USER@$SERVER_IP "grep ETH_RPC_URL /root/csr-arbitrage-mvp/backend/.env | cut -d '=' -f2")

if [ -z "$RPC_URL" ]; then
    echo "⚠️  Could not fetch ETH_RPC_URL from remote. Using default public RPC."
    RPC_URL="https://eth.llamarpc.com"
fi

# Generate Secure Passwords
REDIS_PASSWORD=$(openssl rand -hex 16)
DB_PASSWORD=$(openssl rand -hex 16)
CEX_SECRETS_KEY=$(openssl rand -hex 32)

echo -e "${YELLOW}🔐 Generated secure passwords for deployment...${NC}"

# Create a temporary .env for build
echo "RPC_URL=$RPC_URL" > .env.deploy
echo "LOG_LEVEL=info" >> .env.deploy
echo "REDIS_PASSWORD=$REDIS_PASSWORD" >> .env.deploy
echo "DB_PASSWORD=$DB_PASSWORD" >> .env.deploy
echo "CEX_SECRETS_KEY=$CEX_SECRETS_KEY" >> .env.deploy

echo -e "${YELLOW}📁 Creating remote directory...${NC}"
ssh -i "$SSH_KEY" $SERVER_USER@$SERVER_IP "mkdir -p $REMOTE_DIR"

# 5. Sync Files
echo -e "${YELLOW}📦 Syncing project files...${NC}"
# Exclude node_modules, .git, dist, and local db data
rsync -avz \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude 'dist' \
    --exclude 'redis_data' \
    --exclude 'timescaledb_data' \
    -e "ssh -i $SSH_KEY" \
    . "$SERVER_USER@$SERVER_IP:$REMOTE_DIR"

# Copy the generated .env
scp -i "$SSH_KEY" .env.deploy "$SERVER_USER@$SERVER_IP:$REMOTE_DIR/.env"
rm .env.deploy

# 6. Remote Operations
echo -e "${YELLOW}🎮 Executing remote commands...${NC}"
ssh -i "$SSH_KEY" $SERVER_USER@$SERVER_IP << 'EOF'
    set -e
    cd /root/csr-arbitrage-docker

    # A. Install Docker/Compose if missing
    if ! command -v docker &> /dev/null; then
        echo "Installing Docker..."
        curl -fsSL https://get.docker.com -o get-docker.sh
        sh get-docker.sh
    fi

    # B. Stop Legacy PM2 Services (to free up ports 3001, 3002, 3003, 3005, 3006)
    echo "🛑 Stopping legacy PM2 services..."
    pm2 stop lbank-gateway || true
    pm2 stop latoken-gateway || true
    pm2 stop strategy || true
    pm2 stop uniswap-sdk || true
    pm2 stop uniswap-scraper || true
    pm2 stop uniswap-quote-csr || true
    pm2 stop uniswap-quote-csr25 || true
    pm2 stop backend || true
    
    # C. Build and Start Docker Stack
    echo "🔨 Building Docker stack..."
    # Check if docker-compose (v1) or docker compose (v2) exists
    if command -v docker-compose &> /dev/null; then
        COMPOSE_CMD="docker-compose"
    else
        COMPOSE_CMD="docker compose"
    fi
    
    $COMPOSE_CMD -f docker-compose.yml build

    echo "⬆️  Starting Docker services..."
    $COMPOSE_CMD -f docker-compose.yml up -d

    # D. Validation
    echo "🏥 Health Checks..."
    sleep 10
    $COMPOSE_CMD ps
EOF

echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo "Verify endpoints:"
echo "Strategy: http://$SERVER_IP:3003/health"
echo "LBank:    http://$SERVER_IP:3001/health"
echo "Backend:  http://$SERVER_IP:8001/"
