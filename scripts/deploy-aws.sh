#!/bin/bash
set -e

# AWS EC2 Deployment Script for LLM Gateway
# Usage: ./scripts/deploy-aws.sh [options]
#   --region <region>     AWS region (default: ap-southeast-1)
#   --instance-type <t>   EC2 instance type (default: t2.micro)
#   --ami <id>            AMI ID (default: ubuntu latest)
#   --key-name <name>     SSH key pair name
#   --security-group <id> Security group ID (optional, creates default if not provided)
#   --profile <name>      AWS CLI profile
#   --existing-ip <ip>    Use existing Elastic IP (optional)

REGION="ap-southeast-1"
INSTANCE_TYPE="t2.micro"
AMI_ID=""
KEY_NAME=""
SECURITY_GROUP=""
AWS_PROFILE=""
EXISTING_IP=""
INSTANCE_NAME="llmgateway"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --region) REGION="$2"; shift 2 ;;
        --instance-type) INSTANCE_TYPE="$2"; shift 2 ;;
        --ami) AMI_ID="$2"; shift 2 ;;
        --key-name) KEY_NAME="$2"; shift 2 ;;
        --security-group) SECURITY_GROUP="$2"; shift 2 ;;
        --profile) AWS_PROFILE="$2"; shift 2 ;;
        --existing-ip) EXISTING_IP="$2"; shift 2 ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --region <region>         AWS region (default: us-east-1)"
            echo "  --instance-type <type>    EC2 instance type (default: t2.micro)"
            echo "  --ami <id>                AMI ID (default: auto-detect Ubuntu)"
            echo "  --key-name <name>         SSH key pair name (required)"
            echo "  --security-group <id>     Security group ID (optional)"
            echo "  --profile <name>          AWS CLI profile (optional)"
            echo "  --existing-ip <ip>        Existing Elastic IP (optional)"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

AWS_ARGS=()
if [ -n "$AWS_PROFILE" ]; then
    AWS_ARGS+=("--profile" "$AWS_PROFILE")
fi

# Check prerequisites
command -v aws >/dev/null 2>&1 || { echo "Error: AWS CLI not found. Please install it."; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Error: Docker not found. Please install it."; exit 1; }
command -v ssh >/dev/null 2>&1 || { echo "Error: SSH not found."; exit 1; }

# Validate required parameters
if [ -z "$KEY_NAME" ]; then
    echo "Error: --key-name is required"
    exit 1
fi

echo "=== LLM Gateway AWS EC2 Deployment ==="
echo "Region: $REGION"
echo "Instance: $INSTANCE_TYPE"
echo "Key: $KEY_NAME"
echo ""

# Find latest Ubuntu 22.04 AMI
if [ -z "$AMI_ID" ]; then
    echo "Finding latest Ubuntu 22.04 LTS AMI..."
    AMI_ID=$(aws "${AWS_ARGS[@]}" ec2 describe-images \
        --region "$REGION" \
        --owners 099720109477 \
        --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" \
        --query "sort_by(Images, &CreationDate)[-1].ImageId" \
        --output text)
    echo "Using AMI: $AMI_ID"
fi

# Create security group if not provided
if [ -z "$SECURITY_GROUP" ]; then
    echo "Creating security group..."
    SECURITY_GROUP=$(aws "${AWS_ARGS[@]}" ec2 create-security-group \
        --region "$REGION" \
        --group-name "$INSTANCE_NAME"-sg \
        --description "LLM Gateway security group" \
        --output text)
    
    # Allow SSH, HTTP, HTTPS
    aws "${AWS_ARGS[@]}" ec2 authorize-security-group-ingress \
        --region "$REGION" \
        --group-id "$SECURITY_GROUP" \
        --protocol tcp --port 22 --cidr 0.0.0.0/0
    
    aws "${AWS_ARGS[@]}" ec2 authorize-security-group-ingress \
        --region "$REGION" \
        --group-id "$SECURITY_GROUP" \
        --protocol tcp --port 3001 --cidr 0.0.0.0/0
    
    echo "Security group created: $SECURITY_GROUP"
else
    echo "Using existing security group: $SECURITY_GROUP"
fi

# Check if key pair exists
echo "Checking key pair: $KEY_NAME"
KEY_EXISTS=$(aws "${AWS_ARGS[@]}" ec2 describe-key-pairs \
    --region "$REGION" \
    --filters "Name=key-name,Values=$KEY_NAME" \
    --output text --query 'KeyPairs[0].KeyName')

if [ -z "$KEY_EXISTS" ]; then
    echo "Error: Key pair '$KEY_NAME' not found in $REGION"
    echo "Create it with: aws ec2 create-key-pair --region $REGION --key-name $KEY_NAME --query 'KeyMaterial' --output text > $KEY_NAME.pem"
    exit 1
fi

# Create instance
echo "Starting EC2 instance..."
INSTANCE_ID=$(aws "${AWS_ARGS[@]}" ec2 run-instances \
    --region "$REGION" \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SECURITY_GROUP" \
    --count 1 \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME}]" \
    --output text --query 'Instances[0].InstanceId')

echo "Instance started: $INSTANCE_ID"

# Wait for instance to be running
echo "Waiting for instance to start..."
aws "${AWS_ARGS[@]}" ec2 wait instance-running \
    --region "$REGION" \
    --instance-ids "$INSTANCE_ID"

# Get public IP
PUBLIC_IP=$(aws "${AWS_ARGS[@]}" ec2 describe-instances \
    --region "$REGION" \
    --instance-ids "$INSTANCE_ID" \
    --query "Reservations[0].Instances[0].PublicIpAddress" \
    --output text)

echo ""
echo "=== Instance Ready ==="
echo "Public IP: $PUBLIC_IP"
echo ""

# Create Elastic IP if needed
EIP=""
if [ -n "$EXISTING_IP" ]; then
    EIP="$EXISTING_IP"
    echo "Using existing Elastic IP: $EIP"
else
    echo "Allocating Elastic IP..."
    ALLOCATE_OUTPUT=$(aws "${AWS_ARGS[@]}" ec2 allocate-address \
        --region "$REGION" \
        --domain vpc)
    EIP=$(echo "$ALLOCATE_OUTPUT" | jq -r '.PublicIp')
    echo "Elastic IP allocated: $EIP"
    
    # Associate with instance
    ASSOCIATION_ID=$(aws "${AWS_ARGS[@]}" ec2 associate-address \
        --region "$REGION" \
        --instance-id "$INSTANCE_ID" \
        --public-ip "$EIP" \
        --output text --query 'AssociationId')
    
    echo "Elastic IP associated"
fi

# Wait for SSH to be available
echo ""
echo "Waiting for SSH availability..."
for i in {1..30}; do
    if ssh -o StrictHostKeyChecking=no -i "$KEY_NAME.pem" -p 22 ubuntu@$PUBLIC_IP "echo OK" 2>/dev/null; then
        echo "SSH available!"
        break
    fi
    echo "Attempt $i/30 - waiting..."
    sleep 5
done

# Copy deployment script and setup files
echo ""
echo "Setting up server..."
scp -o StrictHostKeyChecking=no -i "$KEY_NAME.pem" scripts/aws-setup.sh ubuntu@$PUBLIC_IP:/tmp/
scp -o StrictHostKeyChecking=no -i "$KEY_NAME.pem" -r . ubuntu@$PUBLIC_IP:/tmp/llmgateway/

# Run setup on remote server
echo ""
echo "Running remote setup..."
ssh -o StrictHostKeyChecking=no -i "$KEY_NAME.pem" ubuntu@$PUBLIC_IP << 'REMOTE_SETUP'
set -e

echo "=== Installing Dependencies ==="
# Update system
sudo apt-get update
sudo apt-get install -y docker.io git curl

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ubuntu

echo "=== Building and Running LLM Gateway ==="
cd /tmp/llmgateway

# Create .env file with random encryption key
if [ ! -f .env ]; then
    openssl rand -hex 32 > ENCRYPTION_KEY
    echo "ENCRYPTION_KEY=$(cat ENCRYPTION_KEY)" > .env
    echo "PORT=3001" >> .env
    echo ".env file created with random encryption key"
    cat ENCRYPTION_KEY > /tmp/ENCRYPTION_KEY.txt
fi

# Build and run
docker compose up -d --build

echo ""
echo "=== Deployment Complete ==="
REMOTE_SETUP

echo ""
echo "=== Deployment Summary ==="
echo "Elastic IP: $EIP"
echo "Dashboard: http://$EIP:3001"
echo ""
echo "Save your encryption key:"
if [ -n "$EIP" ]; then
    echo "Run: aws ec2 describe-addresses --region $REGION --public-ips $EIP"
fi
echo ""
echo "Next steps:"
echo "1. Note down your ENCRYPTION_KEY (saved in instance or .env file)"
echo "2. Open http://$EIP:3001 in your browser"
echo "3. Add your provider API keys on the Keys page"
echo "4. Use the generated API key with your LLM clients"
echo ""
echo "To connect via SSH:"
echo "ssh -i $KEY_NAME.pem ubuntu@$EIP"
echo ""
echo "To view logs:"
echo "ssh -i $KEY_NAME.pem ubuntu@$EIP 'docker logs -f llmgateway_llmgateway_1'"
