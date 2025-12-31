FROM node:18-alpine

WORKDIR /app

# Copy shared modules first (for caching)
COPY packages/shared/package.json ./packages/shared/
COPY services/uniswap-quote/package.json ./services/uniswap-quote/

# Install dependencies
WORKDIR /app/packages/shared
RUN npm install
WORKDIR /app/services/uniswap-quote
RUN npm install --legacy-peer-deps --omit=dev && npm install -g typescript && npm install --save-dev @types/node

# Copy source code
COPY packages/shared /app/packages/shared
COPY services/uniswap-quote /app/services/uniswap-quote

# Build
WORKDIR /app/services/uniswap-quote
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build

EXPOSE 3002

# Output will be in dist/services/uniswap-quote/src/index.js due to rootDir adjustment
CMD ["node", "dist/services/uniswap-quote/src/index.js"]
