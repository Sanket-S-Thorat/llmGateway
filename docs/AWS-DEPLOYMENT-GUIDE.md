# LLM Gateway - AWS EC2 Deployment (Step-by-Step)

This guide walks you through deploying LLM Gateway to AWS EC2 in **5 simple steps**.

---

## Prerequisites

Before you start, make sure you have:

1. **AWS Account** with billing enabled
2. **AWS CLI installed** and configured
3. **SSH key pair** created in AWS
4. **Docker installed** locally (optional, for local testing)

### Check AWS CLI Setup

```bash
aws configure
# Enter your Access Key ID, Secret Access Key, default region, and output format
```

### Create SSH Key Pair (if you don't have one)

```bash
# Generate a new SSH key pair in AWS
aws ec2 create-key-pair \
  --region ap-southeast-1 \
  --key-name llmgateway-key \
  --query 'KeyMaterial' \
  --output text > ~/.ssh/llmgateway-key.pem

# Secure the private key
chmod 400 ~/.ssh/llmgateway-key.pem
```

---

## Step 1: Prepare Your Environment

### Option A: Use the Automated Script (Recommended)

Run the deployment script from your local machine:

```bash
# Make the script executable
chmod +x scripts/deploy-aws.sh

# Deploy with your SSH key name
./scripts/deploy-aws.sh --key-name llmgateway-key
```

**What this does automatically:**
- ✅ Creates EC2 instance (t2.micro, free tier eligible)
- ✅ Sets up security group (ports 22, 3001)
- ✅ Allocates Elastic IP
- ✅ Clones repo and builds Docker image
- ✅ Starts the service
- ✅ Shows you the dashboard URL

---

## Step 1 (Alternative): Manual Deployment

If you prefer to do it manually, follow these steps:

### 1.1 Create Security Group

```bash
# Create security group
SG_ID=$(aws ec2 create-security-group \
  --region ap-southeast-1 \
  --group-name llmgateway-sg \
  --description "LLM Gateway" \
  --output text)

echo "Security Group ID: $SG_ID"

# Allow SSH (port 22)
aws ec2 authorize-security-group-ingress \
  --region ap-southeast-1 \
  --group-id $SG_ID \
  --protocol tcp \
  --port 22 \
  --cidr 0.0.0.0/0

# Allow LLM Gateway (port 3001)
aws ec2 authorize-security-group-ingress \
  --region ap-southeast-1 \
  --group-id $SG_ID \
  --protocol tcp \
  --port 3001 \
  --cidr 0.0.0.0/0
```

### 1.2 Launch EC2 Instance

```bash
# Get latest Ubuntu 22.04 AMI
AMI_ID=$(aws ec2 describe-images \
  --region ap-southeast-1 \
  --owners 099720109477 \
  --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" \
  --query "sort_by(Images, &CreationDate)[-1].ImageId" \
  --output text)

echo "Using AMI: $AMI_ID"

# Launch instance
INSTANCE_ID=$(aws ec2 run-instances \
  --region ap-southeast-1 \
  --image-id $AMI_ID \
  --instance-type t2.micro \
  --key-name llmgateway-key \
  --security-group-ids $SG_ID \
  --count 1 \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=llmgateway}]" \
  --output text --query 'Instances[0].InstanceId')

echo "Instance ID: $INSTANCE_ID"
```

### 1.3 Allocate Elastic IP

```bash
# Allocate Elastic IP
EIP_OUTPUT=$(aws ec2 allocate-address \
  --region ap-southeast-1 \
  --domain vpc)

EIP=$(echo $EIP_OUTPUT | jq -r '.PublicIp')
ASSOCIATION_ID=$(echo $EIP_OUTPUT | jq -r '.AssociationId')

echo "Elastic IP: $EIP"

# Associate with instance
aws ec2 associate-address \
  --region ap-southeast-1 \
  --instance-id $INSTANCE_ID \
  --public-ip $EIP

echo "Elastic IP associated with instance"
```

### 1.4 Wait for Instance to Start

```bash
# Wait until instance is running
aws ec2 wait instance-running \
  --region ap-southeast-1 \
  --instance-ids $INSTANCE_ID

echo "Instance is running!"
```

---

## Step 2: Connect to Your Instance

```bash
# SSH into the instance
ssh -i ~/.ssh/llmgateway-key.pem ubuntu@<YOUR_ELASTIC_IP>
```

Example:
```bash
ssh -i ~/.ssh/llmgateway-key.pem ubuntu@54.169.123.45
```

---

## Step 3: Set Up the Server

Once connected, run the setup script:

```bash
# Clone the repository
git clone https://github.com/your-org/llmgateway.git
cd llmgateway

# Run the setup script
./scripts/aws-setup.sh
```

**What this does:**
- Installs Docker and dependencies
- Creates `.env` file with encryption key
- Builds and starts the Docker container

### Manual Setup (if script fails)

```bash
# Install Docker
sudo apt-get update
sudo apt-get install -y docker.io git curl

# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Add user to docker group
sudo usermod -aG docker ubuntu

# Log out and back in, or run:
newgrp docker

# Clone repo and deploy
git clone https://github.com/your-org/llmgateway.git
cd llmgateway

# Create .env file
openssl rand -hex 32 > ENCRYPTION_KEY
echo "ENCRYPTION_KEY=$(cat ENCRYPTION_KEY)" > .env
echo "PORT=3001" >> .env

# Build and run
docker compose up -d --build
```

---

## Step 4: Save Your Encryption Key ⚠️ CRITICAL

**Your encryption key is required to decrypt your provider API keys.** If you lose it, all your stored keys become unreadable.

```bash
# Display your encryption key
cat ENCRYPTION_KEY

# Copy it to a safe place (password manager, encrypted storage, etc.)
# Do NOT commit this to Git!
```

**Recommended:** Save it in AWS Secrets Manager:

```bash
aws secretsmanager create-secret \
  --name llmgateway/encryption-key \
  --secret-string "$(cat ENCRYPTION_KEY)"
```

---

## Step 5: Access Your Dashboard

### Get Your Public IP

```bash
# From your local machine
aws ec2 describe-instances \
  --region ap-southeast-1 \
  --filters "Name=tag:Name,Value=llmgateway" \
  --query "Reservations[0].Instances[0].PublicIpAddress" \
  --output text
```

### Open the Dashboard

```
http://<YOUR_ELASTIC_IP>:3001
```

Example: `http://54.169.123.45:3001`

---

## Initial Setup in Dashboard

1. **Create Admin Account**
   - Enter your email and password
   - This is the first account and becomes admin

2. **Add Provider API Keys**
   - Go to **Keys** page
   - Add your Anthropic, OpenAI, or other provider keys
   - Keys are encrypted with your `ENCRYPTION_KEY`

3. **Configure Fallback Chain**
   - Set up fallback order for different models
   - Configure routing preferences

4. **Get Your API Key**
   - Copy the generated `llmgateway-xxxxxxxx` key
   - Use this with your LLM clients

---

## Using LLM Gateway

### With OpenAI SDK

```bash
export OPENAI_BASE_URL=http://<YOUR_EIP>:3001/v1
export OPENAI_API_KEY=llmgateway-xxxxxxxx
```

### With Anthropic SDK

```bash
export ANTHROPIC_BASE_URL=http://<YOUR_EIP>:3001
export ANTHROPIC_AUTH_TOKEN=llmgateway-xxxxxxxx
```

### With Claude Code

```bash
npx llmgateway setup-claude \
  --url http://<YOUR_EIP>:3001 \
  --api-key llmgateway-xxxxxxxx
```

---

## Management Commands

### View Logs

```bash
# From your local machine
ssh -i ~/.ssh/llmgateway-key.pem ubuntu@<EIP> "docker logs -f llmgateway_llmgateway_1"
```

### Stop Service

```bash
ssh -i ~/.ssh/llmgateway-key.pem ubuntu@<EIP> "docker compose down"
```

### Restart Service

```bash
ssh -i ~/.ssh/llmgateway-key.pem ubuntu@<EIP> "docker compose restart"
```

### Update to Latest

```bash
ssh -i ~/.ssh/llmgateway-key.pem ubuntu@<EIP> "cd /tmp/llmgateway && git pull && docker compose up -d --build"
```

---

## Cost Optimization

### Use Spot Instances (Save ~60-70%)

```bash
aws ec2 run-instances \
  --region ap-southeast-1 \
  --image-id $AMI_ID \
  --instance-type t2.micro \
  --instance-market-options MarketType=spot \
  --key-name llmgateway-key \
  --security-group-ids $SG_ID \
  --count 1
```

### Auto-Shutdown When Not in Use

Create a simple script to stop the instance during off-hours:

```bash
#!/bin/bash
aws ec2 stop-instances --region ap-southeast-1 --instance-ids $INSTANCE_ID
```

Schedule with cron or AWS EventBridge.

---

## Troubleshooting

### Can't Connect to Port 3001

```bash
# Check security group
aws ec2 describe-security-groups --group-ids $SG_ID

# Check if container is running
ssh -i ~/.ssh/llmgateway-key.pem ubuntu@<EIP> "docker ps"

# Check logs
ssh -i ~/.ssh/llmgateway-key.pem ubuntu@<EIP> "docker logs llmgateway_llmgateway_1"
```

### Database Issues

```bash
# Check database file
ssh -i ~/.ssh/llmgateway-key.pem ubuntu@<EIP> "ls -la /app/server/data/"

# Restart to trigger migrations
ssh -i ~/.ssh/llmgateway-key.pem ubuntu@<EIP> "docker compose restart"
```

### Need More Resources

```bash
# Stop instance
aws ec2 stop-instances --region ap-southeast-1 --instance-ids $INSTANCE_ID

# Change instance type
aws ec2 modify-instance-attribute \
  --region ap-southeast-1 \
  --instance-id $INSTANCE_ID \
  --instance-type "{\"Value\":\"t3.large\"}"

# Start instance
aws ec2 start-instances --region ap-southeast-1 --instance-ids $INSTANCE_ID
```

---

## Cleanup (When Done)

```bash
# Terminate instance
aws ec2 terminate-instances \
  --region ap-southeast-1 \
  --instance-ids $INSTANCE_ID

# Release Elastic IP
aws ec2 release-address \
  --region ap-southeast-1 \
  --allocation-id $ASSOCIATION_ID

# Delete security group
aws ec2 delete-security-group \
  --region ap-southeast-1 \
  --group-id $SG_ID
```

---

## Quick Reference Card

| Task | Command |
|------|---------|
| Deploy | `./scripts/deploy-aws.sh --key-name llmgateway-key` |
| SSH | `ssh -i ~/.ssh/llmgateway-key.pem ubuntu@<EIP>` |
| View logs | `docker logs -f llmgateway_llmgateway_1` |
| Restart | `docker compose restart` |
| Stop | `docker compose down` |
| Update | `git pull && docker compose up -d --build` |
| Get EIP | `aws ec2 describe-addresses --region ap-southeast-1` |
