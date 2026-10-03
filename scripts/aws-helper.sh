#!/bin/bash
set -e

# Helper script to get latest Ubuntu AMI
get_latest_ubuntu() {
    local region=${1:-us-east-1}
    aws ec2 describe-images \
        --region "$region" \
        --owners 099720109477 \
        --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" \
        --query "sort_by(Images, &CreationDate)[-1].ImageId" \
        --output text
}

# Helper script to create security group for LLM Gateway
create_sg() {
    local region=${1:-us-east-1}
    local name=${2:-llmgateway-sg}
    
    SG_ID=$(aws ec2 create-security-group \
        --region "$region" \
        --group-name "$name" \
        --description "LLM Gateway security group" \
        --output text)
    
    echo "Security Group ID: $SG_ID"
    
    # Allow SSH
    aws ec2 authorize-security-group-ingress \
        --region "$region" \
        --group-id "$SG_ID" \
        --protocol tcp \
        --port 22 \
        --cidr 0.0.0.0/0
    
    # Allow LLM Gateway
    aws ec2 authorize-security-group-ingress \
        --region "$region" \
        --group-id "$SG_ID" \
        --protocol tcp \
        --port 3001 \
        --cidr 0.0.0.0/0
    
    echo "$SG_ID"
}

# Helper script to create instance
create_instance() {
    local region=${1:-us-east-1}
    local ami=${2:-$(get_latest_ubuntu "$region")}
    local instance_type=${3:-t2.micro}
    local key_name=${4:?Key name required}
    local sg_id=${5:?Security group ID required}
    local name=${6:-llmgateway}
    
    aws ec2 run-instances \
        --region "$region" \
        --image-id "$ami" \
        --instance-type "$instance_type" \
        --key-name "$key_name" \
        --security-group-ids "$sg_id" \
        --count 1 \
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$name}]" \
        --output text --query 'Instances[0].InstanceId'
}

# Helper script to allocate and associate Elastic IP
allocate_eip() {
    local region=${1:-us-east-1}
    local instance_id=${2:?Instance ID required}
    
    ALLOC=$(aws ec2 allocate-address --region "$region" --domain vpc)
    EIP=$(echo "$ALLOC" | jq -r '.PublicIp')
    ASSOC_ID=$(echo "$ALLOC" | jq -r '.AssociationId')
    
    aws ec2 associate-address \
        --region "$region" \
        --instance-id "$instance_id" \
        --public-ip "$EIP"
    
    echo "$EIP"
}

# Cleanup function
cleanup_instance() {
    local region=${1:-us-east-1}
    local instance_id=${2:?Instance ID required}
    
    # Wait for instance to terminate
    aws ec2 terminate-instances --region "$region" --instance-ids "$instance_id"
    
    # Release Elastic IP if needed
    aws ec2 release-address --region "$region" --allocation-id "$ASSOCIATION_ID"
    
    # Delete security group
    aws ec2 delete-security-group --region "$region" --group-id "$SG_ID"
    
    echo "Cleaned up instance $instance_id"
}

# Usage
if [ $# -eq 0 ]; then
    echo "Usage: $0 <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  get-ami [region]              Get latest Ubuntu AMI"
    echo "  create-sg [region] [name]     Create security group"
    echo "  create-instance <region> <ami> <type> <key> <sg> <name>"
    echo "  allocate-eip <region> <instance-id>"
    echo "  cleanup <region> <instance-id>"
    exit 1
fi

case $1 in
    get-ami)
        get_latest_ubuntu "${2:-us-east-1}"
        ;;
    create-sg)
        create_sg "${2:-us-east-1}" "${3:-llmgateway-sg}"
        ;;
    create-instance)
        create_instance "$2" "$3" "$4" "$5" "$6" "${7:-llmgateway}"
        ;;
    allocate-eip)
        allocate_eip "$2" "$3"
        ;;
    cleanup)
        cleanup_instance "$2" "$3"
        ;;
    *)
        echo "Unknown command: $1"
        exit 1
        ;;
esac
