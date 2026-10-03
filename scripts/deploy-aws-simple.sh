#!/bin/bash
# Quick deployment script for AWS EC2 using pre-built image
# Usage: ./scripts/deploy-aws-simple.sh <key-name> [region]

set -e

KEY_NAME=${1:?Usage: $0 <key-name> [region]}
REGION=${2:-us-east-1}

echo "=== LLM Gateway Quick Deploy ==="
echo "Region: $REGION"
echo "Key: $KEY_NAME"

# Check AWS CLI
command -v aws >/dev/null 2>&1 || { echo "Error: AWS CLI not installed"; exit 1; }

# Create security group
echo "Creating security group..."
SG_ID=$(aws ec2 create-security-group \
    --region "$REGION" \
    --group-name llmgateway-quick \
    --description "LLM Gateway quick deploy" \
    --output text)

# Allow SSH and HTTP
aws ec2 authorize-security-group-ingress \
    --region "$REGION" \
    --group-id "$SG_ID" \
    --protocol tcp --port 22 --cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress \
    --region "$REGION" \
    --group-id "$SG_ID" \
    --protocol tcp --port 3001 --cidr 0.0.0.0/0

echo "Security Group: $SG_ID"

# Get latest Ubuntu AMI
echo "Getting latest Ubuntu AMI..."
AMI_ID=$(aws ec2 describe-images \
    --region "$REGION" \
    --owners 099720109477 \
    --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" \
    --query "sort_by(Images, &CreationDate)[-1].ImageId" \
    --output text)

echo "AMI: $AMI_ID"

# Launch instance
echo "Starting instance..."
INSTANCE_ID=$(aws ec2 run-instances \
    --region "$REGION" \
    --image-id "$AMI_ID" \
    --instance-type t2.micro \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SG_ID" \
    --count 1 \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=llmgateway}]" \
    --output text --query 'Instances[0].InstanceId')

echo "Instance ID: $INSTANCE_ID"

# Wait for running
echo "Waiting for instance to start..."
aws ec2 wait instance-running \
    --region "$REGION" \
    --instance-ids "$INSTANCE_ID"

# Get public IP
PUBLIC_IP=$(aws ec2 describe-instances \
    --region "$REGION" \
    --instance-ids "$INSTANCE_ID" \
    --query "Reservations[0].Instances[0].PublicIpAddress" \
    --output text)

echo ""
echo "=== Deployment Complete ==="
echo "Public IP: $PUBLIC_IP"
echo "Dashboard: http://$PUBLIC_IP:3001"
echo ""
echo "SSH access:"
echo "  ssh -i ~/.ssh/$KEY_NAME.pem ubuntu@$PUBLIC_IP"
echo ""
echo "Initial setup commands:"
echo "  git clone https://github.com/your-org/llmgateway.git"
echo "  cd llmgateway"
echo "  openssl rand -hex 32 > ENCRYPTION_KEY"
echo "  echo 'ENCRYPTION_KEY=$(cat ENCRYPTION_KEY)' > .env"
echo "  echo 'PORT=3001' >> .env"
echo "  docker compose up -d --build"
