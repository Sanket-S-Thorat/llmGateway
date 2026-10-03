# AWS Setup Test Report

**Date**: 2026-10-04  
**Status**: ⚠️ **MOSTLY OK WITH CRITICAL ISSUES**

---

## Executive Summary

The AWS setup scripts are **functionally correct** for basic deployments but have **5 critical/high issues** that should be fixed before production use:

1. 🔴 **CRITICAL**: Missing `jq` dependency validation
2. 🟠 **HIGH**: SSH key file not validated
3. 🟡 **MEDIUM**: ENCRYPTION_KEY not backed up locally
4. 🟡 **MEDIUM**: Insecure SSH options in deployment
5. 🟡 **MEDIUM**: Docker service name references outdated

---

## Test Results

### ✅ Passed Tests

| Test | Result | Details |
|------|--------|---------|
| Bash Syntax | ✅ PASS | All scripts pass `bash -n` validation |
| AWS CLI | ✅ PASS | AWS CLI installed and authenticated |
| Docker | ✅ PASS | Docker installed and running |
| SSH | ✅ PASS | SSH command available |
| docker-compose.yml | ✅ PASS | Valid YAML, proper structure |
| Dockerfile | ✅ PASS | Valid multi-stage build |
| Error Handling | ✅ PASS | Scripts use `set -e` properly |
| Argument Parsing | ✅ PASS | Proper argument parsing with defaults |
| SSH Key Validation | ✅ PASS | Key pair existence checked |
| Public IP Retrieval | ✅ PASS | Correctly queries PublicIpAddress |
| Security Group | ✅ PASS | Proper ingress rules (22, 3001) |

### ⚠️ Failed/Warning Tests

| Issue | Severity | Details | Recommendation |
|-------|----------|---------|-----------------|
| jq Dependency Not Validated | 🔴 CRITICAL | Script uses `jq -r` without checking if jq is installed. Will fail silently on systems without jq. | Add prerequisite check: `command -v jq >/dev/null 2>&1 \|\| { echo "jq not found"; exit 1; }` |
| SSH Key File Not Validated | 🟠 HIGH | deploy-aws.sh assumes `$KEY_NAME.pem` exists but doesn't validate file before use. | Add check: `[ -f "$KEY_NAME.pem" ] \|\| { echo "Key file not found"; exit 1; }` |
| ENCRYPTION_KEY Not Backed Up | 🟡 MEDIUM | Encryption key generated on remote instance and saved to /tmp/ENCRYPTION_KEY.txt but never retrieved locally. Risk of data loss if instance is terminated. | Retrieve key from remote instance and display to user before any cleanup. Store in local safe location. |
| StrictHostKeyChecking=no | 🟡 MEDIUM | SSH connections use `StrictHostKeyChecking=no` which disables host key verification. Vulnerable to man-in-the-middle attacks. | Add SSH public key to known_hosts on first connection, or use `-o UserKnownHostsFile=/dev/null` with user confirmation. |
| Outdated Service Name | 🟡 MEDIUM | Logs reference `llmgateway_llmgateway_1` which is Docker Compose v1 naming. Docker Compose v2 uses hyphens: `llmgateway-llmgateway-1` | Update service name references to match actual container names. |
| .env in /tmp | 🟡 MEDIUM | .env file created in /tmp/llmgateway/ which is temporary storage. Could be cleared by system maintenance. | Move .env to persistent location like /home/ubuntu/llmgateway/ or /app/ |

---

## Detailed Findings

### 1. Missing jq Dependency Check (CRITICAL)

**File**: `scripts/deploy-aws.sh` (lines with `jq -r`)

**Problem**:
```bash
ALLOC=$(aws ec2 allocate-address --region "$region" --domain vpc)
EIP=$(echo "$ALLOC" | jq -r '.PublicIp')  # ← jq must be installed
```

**Impact**: Script will fail with cryptic error if jq is not installed on the user's system.

**Fix**:
```bash
# Add to prerequisite checks near line 50
command -v jq >/dev/null 2>&1 || { echo "Error: jq not found. Install it with: brew install jq (macOS) or apt-get install jq (Linux)"; exit 1; }
```

---

### 2. SSH Key File Not Validated (HIGH)

**File**: `scripts/deploy-aws.sh` (line ~180)

**Problem**:
```bash
ssh -o StrictHostKeyChecking=no -i "$KEY_NAME.pem" ubuntu@$PUBLIC_IP  # ← Assumes file exists
```

**Impact**: Unclear error message if user doesn't have the key file locally.

**Fix**:
```bash
if [ ! -f "$KEY_NAME.pem" ]; then
    echo "Error: SSH key file not found: $KEY_NAME.pem"
    echo "Expected location: $(pwd)/$KEY_NAME.pem"
    exit 1
fi
```

---

### 3. ENCRYPTION_KEY Not Backed Up Locally (MEDIUM)

**File**: `scripts/deploy-aws.sh` (lines ~220-230)

**Problem**:
- Key is generated on remote instance
- Saved to `/tmp/ENCRYPTION_KEY.txt` on remote
- Never retrieved back to user's machine
- User has no way to recover key if instance is terminated

**Risk**: Data loss - cannot decrypt stored API keys if instance is lost.

**Fix**:
```bash
# After remote setup completes, retrieve the key:
scp -o StrictHostKeyChecking=no -i "$KEY_NAME.pem" ubuntu@$EIP:/tmp/ENCRYPTION_KEY.txt ./ENCRYPTION_KEY_backup.txt

echo ""
echo "⚠️  IMPORTANT: Save this encryption key in a safe place:"
echo "$(cat ./ENCRYPTION_KEY_backup.txt)"
echo ""
echo "Backup saved to: ./ENCRYPTION_KEY_backup.txt"
```

---

### 4. Insecure SSH Options (MEDIUM)

**File**: `scripts/deploy-aws.sh` (multiple SSH commands)

**Problem**:
```bash
ssh -o StrictHostKeyChecking=no -i "$KEY_NAME.pem" ubuntu@$PUBLIC_IP
# ↑ Disables host key verification - could allow MITM attacks
```

**Fix**:
```bash
# Use a temporary known_hosts file or prompt user:
ssh -o StrictHostKeyChecking=accept-new -i "$KEY_NAME.pem" ubuntu@$PUBLIC_IP
# This accepts new hosts on first connection but remembers them
```

---

### 5. Outdated Docker Service Name (MEDIUM)

**File**: `scripts/deploy-aws.sh` (line ~270)

**Problem**:
```bash
echo "docker logs -f llmgateway_llmgateway_1"  # ← v1 naming
# Docker Compose v2 would use: llmgateway-llmgateway-1
```

**Fix**:
```bash
# Instead of hardcoding, get the actual container name:
CONTAINER_ID=$(docker ps -q -f label=com.docker.compose.service=llmgateway)
echo "docker logs -f $CONTAINER_ID"
```

---

## Environment Variables

All required environment variables are properly documented:
- ✅ NODE_ENV
- ✅ PORT
- ✅ ENCRYPTION_KEY
- ✅ DASHBOARD_ORIGINS

---

## Security Checklist

| Item | Status | Notes |
|------|--------|-------|
| No hardcoded credentials in scripts | ⚠️ | ENCRYPTION_KEY is generated, not hardcoded ✓ |
| SSH host verification enabled | ❌ | `StrictHostKeyChecking=no` used |
| Sudo privileges validated | ✅ | Used appropriately for Docker setup |
| API keys encrypted at rest | ✅ | ENCRYPTION_KEY used for SQLite encryption |
| Public IP/EIP management | ✅ | Proper AWS API calls |
| Docker image building | ✅ | Multi-stage build, runs as node user |

---

## Recommendations

### Immediate (Before Production)
1. ✅ Add jq dependency check
2. ✅ Add SSH key file validation
3. ✅ Implement secure SSH host verification

### Short-term (Before First Deployment)
4. ✅ Back up ENCRYPTION_KEY locally and display to user
5. ✅ Move .env to persistent location
6. ✅ Update Docker service name references

### Long-term (Improvements)
7. 📋 Add automated testing for AWS deployment
8. 📋 Create rollback/cleanup script
9. 📋 Add monitoring and alerting setup
10. 📋 Document cost estimation for EC2 usage

---

## Quick Fix Checklist

```bash
# Apply these fixes to deploy-aws.sh:
□ Add jq validation to prerequisites check
□ Add SSH key file existence check  
□ Change StrictHostKeyChecking=no to StrictHostKeyChecking=accept-new
□ Add logic to retrieve and display ENCRYPTION_KEY
□ Update docker logs command to use actual container name
□ Document all required tools in README
```

---

## Testing Your Deployment

To actually test the AWS deployment (optional), use:

```bash
# Test without actually creating resources:
./scripts/deploy-aws.sh --key-name your-key-name --region us-east-1

# This will:
# 1. Validate all prerequisites
# 2. Check AWS credentials
# 3. Find latest Ubuntu AMI
# 4. Create security group
# 5. Launch EC2 instance
# 6. Deploy LLM Gateway
```

⚠️ **WARNING**: This creates actual AWS resources and will incur charges!

---

## Files Analyzed

- ✅ `/scripts/aws-setup.sh` - Remote setup script
- ✅ `/scripts/deploy-aws.sh` - Main orchestration script  
- ✅ `/scripts/aws-helper.sh` - Helper functions
- ✅ `/docker-compose.yml` - Container orchestration
- ✅ `/Dockerfile` - Container image definition
- ✅ `/SETUP.md` - Local setup documentation
- ✅ `/docs/AWS-DEPLOYMENT-GUIDE.md` - AWS deployment guide

---

## Conclusion

**Overall Assessment: ✅ FUNCTIONAL BUT NEEDS FIXES**

The AWS deployment scripts are well-structured and mostly complete. With the recommended fixes above, they'll be production-ready. The main issues are edge-case handling and security improvements rather than fundamental logic problems.

**Estimated Fix Time**: 1-2 hours for all recommendations  
**Testing Complexity**: Low (mostly validation improvements)  
**Risk Level**: Medium (pre-fixes), Low (post-fixes)
