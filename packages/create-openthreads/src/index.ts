#!/usr/bin/env bun
/**
 * create-openthreads — scaffold a new OpenThreads deployment.
 *
 * Usage:
 *   bunx create-openthreads          → interactive mode
 *   bunx create-openthreads my-app   → create in ./my-app
 *   npx create-openthreads my-app    → same, via npm
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const OPENTHREADS_VERSION = '0.1.0';

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let projectName = args[0];

if (!projectName) {
  process.stdout.write('Project name: ');
  // Read from stdin synchronously (Bun supports this)
  const buf = Buffer.alloc(256);
  const n = require('fs').readSync(0, buf, 0, buf.length, null);
  projectName = buf.toString('utf8', 0, n).trim();
}

if (!projectName || projectName.startsWith('-')) {
  console.error('Usage: create-openthreads <project-name>');
  process.exit(1);
}

const targetDir = join(process.cwd(), projectName);

if (existsSync(targetDir)) {
  console.error(`Directory "${projectName}" already exists.`);
  process.exit(1);
}

// ─── Scaffold ─────────────────────────────────────────────────────────────────

console.log(`\nCreating OpenThreads project: ${projectName}\n`);

mkdirSync(targetDir, { recursive: true });

function write(relativePath: string, content: string): void {
  const fullPath = join(targetDir, relativePath);
  const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
  if (dir) mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
  console.log(`  created  ${relativePath}`);
}

// docker-compose.yml
write('docker-compose.yml', `version: '3.8'

services:
  mongodb:
    image: mongo:7.0
    container_name: ${projectName}-mongodb
    ports:
      - '27017:27017'
    environment:
      MONGO_INITDB_ROOT_USERNAME: openthreads
      MONGO_INITDB_ROOT_PASSWORD: openthreads
      MONGO_INITDB_DATABASE: openthreads
    volumes:
      - mongodb_data:/data/db
    healthcheck:
      test: ['CMD', 'mongosh', '--eval', "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
    restart: unless-stopped

  app:
    profiles: [production]
    image: ghcr.io/deepducks/openthreads:latest
    container_name: ${projectName}-app
    ports:
      - '\${PORT:-3000}:3000'
    environment:
      NODE_ENV: production
      MONGODB_URI: mongodb://openthreads:openthreads@mongodb:27017/openthreads
      JWT_SECRET: \${JWT_SECRET}
      OPENTHREADS_BASE_URL: \${OPENTHREADS_BASE_URL:-http://localhost:3000}
      LOG_LEVEL: \${LOG_LEVEL:-info}
      LOG_FORMAT: json
    depends_on:
      mongodb:
        condition: service_healthy
    restart: unless-stopped

volumes:
  mongodb_data:
    driver: local
`);

// .env
write('.env', `# OpenThreads configuration
# Copy this to .env and fill in your values.

PORT=3000
NODE_ENV=development

# MongoDB
MONGODB_URI=mongodb://openthreads:openthreads@localhost:27017/openthreads

# Security — CHANGE THESE IN PRODUCTION
JWT_SECRET=change-me-in-production
# MANAGEMENT_API_KEY=change-me-in-production

# Base URL (used to build replyTo URLs)
OPENTHREADS_BASE_URL=http://localhost:3000

# Logging
LOG_LEVEL=info
LOG_FORMAT=text

# Reply token TTL (seconds)
REPLY_TOKEN_TTL=86400

# Channel credentials (uncomment the ones you need)
# SLACK_BOT_TOKEN=xoxb-...
# SLACK_SIGNING_SECRET=...
# TELEGRAM_BOT_TOKEN=...
# DISCORD_BOT_TOKEN=...
# DISCORD_CLIENT_ID=...
`);

// .gitignore
write('.gitignore', `.env
.env.local
node_modules/
.next/
*.log
`);

// README.md
write('README.md', `# ${projectName}

OpenThreads deployment scaffolded with \`create-openthreads\`.

## Quick start

1. **Start MongoDB:**
   \`\`\`bash
   docker compose up -d mongodb
   \`\`\`

2. **Configure environment:**
   \`\`\`bash
   cp .env.example .env
   # Edit .env with your channel credentials and secrets
   \`\`\`

3. **Start the server:**
   \`\`\`bash
   docker compose --profile production up -d
   # or for development: cd into OpenThreads and run bun run dev
   \`\`\`

4. **Open the dashboard:**
   [http://localhost:3000](http://localhost:3000)

## Documentation

- [Self-hosting guide](https://github.com/deepducks/OpenThreads/blob/main/docs/self-hosting.md)
- [Channel setup guides](https://github.com/deepducks/OpenThreads/blob/main/docs/channels/)
- [API reference](http://localhost:3000/api/docs)
`);

console.log(`\nDone! Next steps:\n`);
console.log(`  cd ${projectName}`);
console.log(`  cp .env .env.local    # edit with your credentials`);
console.log(`  docker compose up -d mongodb`);
console.log(`  docker compose --profile production up -d`);
console.log(`\n  Dashboard: http://localhost:3000\n`);
