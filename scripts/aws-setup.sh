#!/bin/bash
set -e

# One-click setup script to run on the EC2 instance
# This is called by deploy-aws.sh but can also be run manually

echo "=== LLM Gateway Quick Setup ==="

# Check if we're in the right directory
if [ ! -f "docker-compose.yml" ]; then
    echo "Error: docker-compose.yml not found. Run this from the project root."
    exit 1
fi

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env file..."
    openssl rand -hex 32 > ENCRYPTION_KEY
    echo "ENCRYPTION_KEY=$(cat ENCRYPTION_KEY)" > .env
    echo "PORT=3001" >> .env
    echo "DASHBOARD_ORIGINS=*" >> .env
    echo ".env file created"
    echo "WARNING: Save your ENCRYPTION_KEY - it cannot be recovered!"
fi

# Build and start
echo "Building and starting LLM Gateway..."
docker compose up -d --build

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Access the dashboard at:"
echo "  http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):3001"
echo ""
echo "View logs: docker logs -f llmgateway_llmgateway_1"
echo "Stop: docker compose down"
echo "Restart: docker compose restart"
