#!/bin/bash
# Super simple one-command deploy
# Usage: ./quick-deploy.sh <key-name>

set -e

KEY_NAME=${1:?Usage: ./quick-deploy.sh <key-name>}
REGION="ap-southeast-1"

echo "🚀 LLM Gateway Quick Deploy"
echo "   Region: $REGION"
echo "   Key: $KEY_NAME"
echo ""

# Check prerequisites
command -v aws >/dev/null 2>&1 || { echo "❌ AWS CLI not found. Install with: brew install awscli"; exit 1; }
command -v ssh >/dev/null 2>&1 || { echo "❌ SSH not found"; exit 1; }

# Verify key exists
if [ ! -f ~/.ssh/$KEY_NAME.pem ]; then
    echo "❌ Key file not found: ~/.ssh/$KEY_NAME.pem"
    echo "   Create it with: aws ec2 create-key-pair --region $REGION --key-name $KEY_NAME --query 'KeyMaterial' --output text > ~/.ssh/$KEY_NAME.pem"
    exit 1
fi

echo "✅ Prerequisites checked"
echo ""

# Create security group
echo "📦 Creating security group..."
SG_ID=$(aws ec2 create-security-group \
    --region $REGION \
    --group-name llmgateway-quick \
    --description "LLM Gateway" \
    --output text 2>/dev/null || {
    # If it already exists, get the existing one
    SG_ID=$(aws ec2 describe-security-groups \
        --region $REGION \
        --filters "Name=group-name,Values=llmgateway-quick" \
        --query 'SecurityGroups[0].GroupId' \
        --output text)
})

aws ec2 authorize-security-group-ingress \
    --region $REGION --group-id $SG_ID \
    --protocol tcp --port 22 --cidr 0.0.0.0/0 \
    2>/dev/null || echo "   SSH rule already exists"

aws ec2 authorize-security-group-ingress \
    --region $REGION --group-id $SG_ID \
    --protocol tcp --port 3001 --cidr 0.0.0.0/0 \
    2>/dev/null || echo "   Port 3001 rule already exists"

echo "   Security Group: $SG_ID"

# Get AMI
echo "🖥️  Getting latest Ubuntu AMI..."
AMI_ID=$(aws ec2 describe-images \
    --region $REGION \
    --owners 099720109477 \
    --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" \
    --query "sort_by(Images, &CreationDate)[-1].ImageId" \
    --output text)

# Launch instance
echo "🚀 Launching instance..."
INSTANCE_ID=$(aws ec2 run-instances \
    --region $REGION \
    --image-id $AMI_ID \
    --instance-type t2.micro \
    --key-name $KEY_NAME \
    --security-group-ids $SG_ID \
    --count 1 \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=llmgateway}]" \
    --output text --query 'Instances[0].InstanceId')

echo "   Instance ID: $INSTANCE_ID"

# Wait for running
echo "⏳ Waiting for instance to start..."
aws ec2 wait instance-running --region $REGION --instance-ids $INSTANCE_ID

# Get public IP
PUBLIC_IP=$(aws ec2 describe-instances \
    --region $REGION \
    --instance-ids $INSTANCE_ID \
    --query "Reservations[0].Instances[0].PublicIpAddress" \
    --output text)

echo ""
echo "✅ Instance ready!"
echo ""
echo "📍 Public IP: $PUBLIC_IP"
echo "🌐 Dashboard: http://$PUBLIC_IP:3001"
echo ""
echo "🔧 Next steps:"
echo "   1. SSH into instance:"
echo "      ssh -i ~/.ssh/$KEY_NAME.pem ubuntu@$PUBLIC_IP"
echo ""
echo "   2. Clone repo and deploy:"
echo "      git clone https://github.com/your-org/llmgateway.git"
echo "      cd llmgateway"
echo "      ./scripts/aws-setup.sh"
echo ""
echo "   3. Save your encryption key!"
echo ""
