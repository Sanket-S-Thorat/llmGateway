# LLM Gateway - AWS EC2 Deployment Guide

Complete guide for deploying LLM Gateway to AWS EC2.

## Quick Start (Automated)

The deployment script will create everything for you:

```bash
# Set your AWS profile if needed
export AWS_PROFILE=your-profile

# Run the deployment script
chmod +x scripts/deploy-aws.sh
./scripts/deploy-aws.sh --key-name your-ssh-key-pair
```

## Manual Deployment

### 1. Launch EC2 Instance

```bash
aws ec2 run-instances \
  --region us-east-1 \
  --image-id $(aws ec2 describe-images --region us-east-1 --owners 099720109477 --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" --query "sort_by(Images, &CreationDate)[-1].ImageId" --output text) \
  --instance-type t2.micro \
  --key-name your-key-pair \
  --security-group-ids sg-xxxxxxxx \
  --count 1 \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=llmgateway}]"
```

### 2. Create Security Group

```bash
# Create security group
SG_ID=$(aws ec2 create-security-group \
  --region us-east-1 \
  --group-name llmgateway-sg \
  --description "LLM Gateway" \
  --output text)

# Allow SSH
aws ec2 authorize-security-group-ingress \
  --region us-east-1 \
  --group-id $SG_ID \
  --protocol tcp \
  --port 22 \
  --cidr 0.0.0.0/0

# Allow LLM Gateway (port 3001)
aws ec2 authorize-security-group-ingress \
  --region us-east-1 \
  --group-id $SG_ID \
  --protocol tcp \
  --port 3001 \
  --cidr 0.0.0.0/0
```

### 3. Allocate Elastic IP

```bash
# Allocate Elastic IP
ALLOCATION=$(aws ec2 allocate-address --region us-east-1 --domain vpc)
EIP=$(echo $ALLOCATION | jq -r '.PublicIp')
ASSOCIATION_ID=$(echo $ALLOCATION | jq -r '.AssociationId')

# Associate with instance
aws ec2 associate-address \
  --region us-east-1 \
  --instance-id i-xxxxxxxx \
  --public-ip $EIP
```

### 4. Clone and Deploy

```bash
# Connect to instance
ssh -i ~/.ssh/your-key.pem ubuntu@<EIP>

# Clone repository
git clone https://github.com/your-org/llmgateway.git
cd llmgateway

# Create .env
openssl rand -hex 32 > ENCRYPTION_KEY
echo "ENCRYPTION_KEY=$(cat ENCRYPTION_KEY)" > .env
echo "PORT=3001" >> .env
echo "DASHBOARD_ORIGINS=*" >> .env

# Build and run
docker compose up -d --build
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENCRYPTION_KEY` | Yes | None | 64-character hex key for encrypting provider keys |
| `PORT` | No | 3001 | Port to listen on |
| `HOST` | No | 0.0.0.0 | Bind address (use 0.0.0.0 for external access) |
| `DASHBOARD_ORIGINS` | No | * | CORS origins for dashboard |
| `LLMGATEWAY_DB_PATH` | No | /app/server/data/llmgateway.db | Database file path |

### Persistent Storage

For production use, mount a persistent volume:

```yaml
# docker-compose.yml additions
volumes:
  llmgateway-data:
    driver: local
    driver_opts:
      type: none
      device: /mnt/data
      o: bind
```

Or use EBS:
```bash
# Create EBS volume
VOL_ID=$(aws ec2 create-volume --region us-east-1 --size 20 --volume-type gp3 --availability-zone us-east-1a --output text --query VolumeId)

# Attach to instance
aws ec2 attach-volume --region us-east-1 --volume-id $VOL_ID --instance-id i-xxxxxxxx --device /dev/xvdf
```

## Management Commands

```bash
# View logs
docker logs -f llmgateway_llmgateway_1

# Check status
docker compose ps

# Stop service
docker compose down

# Restart
docker compose restart

# Update to latest
git pull
docker compose up -d --build

# Backup database
docker exec llmgateway_llmgateway_1 cp /app/server/data/llmgateway.db /tmp/
scp ubuntu@<EIP>:/tmp/llmgateway.db ./backup-$(date +%Y%m%d).db
```

## Security Recommendations

1. **Restrict Access**: Update security group to only allow port 3001 from specific IPs
2. **Use HTTPS**: Set up nginx reverse proxy with Let's Encrypt
3. **Enable Dashboard Auth**: Set strong admin credentials
4. **Regular Backups**: Automate database backups
5. **Monitor**: Set up CloudWatch alarms for resource usage

### HTTPS Setup (Optional)

```bash
# Install nginx and certbot
sudo apt-get install -y nginx certbot python3-certbot-nginx

# Configure nginx
sudo tee /etc/nginx/sites-available/llmgateway << 'EOF'
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/llmgateway /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com
```

## Troubleshooting

### Can't connect to port 3001
```bash
# Check if container is running
docker ps

# Check logs
docker logs llmgateway_llmgateway_1

# Verify security group allows traffic
aws ec2 describe-security-groups --group-ids sg-xxxxxxxx
```

### Database issues
```bash
# Check database file
ls -la /app/server/data/llmgateway.db

# Restart to trigger migration
docker compose restart
```

### Need more resources
```bash
# Stop instance
aws ec2 stop-instances --instance-ids i-xxxxxxxx

# Change instance type
aws ec2 modify-instance-attribute --instance-id i-xxxxxxxx --instance-type "{\"Value\":\"t3.large\"}"

# Start instance
aws ec2 start-instances --instance-ids i-xxxxxxxx
```

## Cost Estimation

- **t2.micro**: ~$8/month (or FREE with 750hrs/month free tier)
- **EBS 20GB**: ~$2/month
- **Data transfer**: Varies by usage
- **Elastic IP**: Free when attached to running instance

Consider using Spot Instances for significant savings (~60-70% cheaper).
