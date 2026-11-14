#!/bin/bash
# Associate an Amazon Connect instance's Contact Trace Record (CTR) streaming with a
# Kinesis stream, without silently overwriting an existing CTR destination.
#
# An Amazon Connect instance can have only ONE Kinesis destination for CTRs. Running
# associate-instance-storage-config always REPLACES whatever is configured today. If
# another system already depends on that stream (a dashboard, an analytics pipeline,
# etc.), replacing it breaks that system's data flow with no warning from AWS.
#
# This script checks for an existing CONTACT_TRACE_RECORDS Kinesis association first
# and asks for explicit confirmation before changing anything.
#
# Usage:
#   ./associate-ctr-stream.sh <instance-id> <stream-arn> [region]
#
# Example:
#   ./associate-ctr-stream.sh f2f080f8-6516-4bc8-b212-0780d41a94e1 \
#     arn:aws:kinesis:us-east-1:949734958994:stream/agent-contact-history-ctr-stream \
#     us-east-1

set -euo pipefail

INSTANCE_ID="${1:-}"
STREAM_ARN="${2:-}"
REGION="${3:-us-east-1}"

if [[ -z "$INSTANCE_ID" || -z "$STREAM_ARN" ]]; then
  echo "Usage: $0 <instance-id> <stream-arn> [region]" >&2
  exit 1
fi

echo "Checking existing CTR storage configuration for instance $INSTANCE_ID in $REGION..."

EXISTING=$(aws connect list-instance-storage-configs \
  --instance-id "$INSTANCE_ID" \
  --resource-type CONTACT_TRACE_RECORDS \
  --region "$REGION" \
  --output json)

EXISTING_COUNT=$(echo "$EXISTING" | \
  python3 -c "import json,sys; print(len(json.load(sys.stdin).get('StorageConfigs', [])))" 2>/dev/null || echo 0)

if [[ "$EXISTING_COUNT" -gt 0 ]]; then
  echo
  echo "!! This instance already has a CTR storage configuration:"
  echo "$EXISTING"
  echo
  EXISTING_ARN=$(echo "$EXISTING" | python3 -c \
    "import json,sys; c=json.load(sys.stdin)['StorageConfigs']; print(c[0].get('KinesisStreamConfig',{}).get('StreamArn',''))" \
    2>/dev/null || true)
  if [[ "$EXISTING_ARN" == "$STREAM_ARN" ]]; then
    echo "It already points at the target stream ($STREAM_ARN). Nothing to do."
    exit 0
  fi
  echo "Associating the new stream will REPLACE this configuration."
  echo "Anything currently consuming CTRs from the existing destination will stop"
  echo "receiving them as soon as this change is applied."
  echo
  read -r -p "Type REPLACE to overwrite the existing CTR destination, or anything else to cancel: " CONFIRM
  if [[ "$CONFIRM" != "REPLACE" ]]; then
    echo "Cancelled. No changes made."
    exit 1
  fi
else
  echo "No existing CTR storage configuration found. Safe to proceed."
  read -r -p "Associate stream $STREAM_ARN with instance $INSTANCE_ID? [y/N] " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Cancelled. No changes made."
    exit 1
  fi
fi

echo "Associating CTR streaming with $STREAM_ARN ..."
aws connect associate-instance-storage-config \
  --instance-id "$INSTANCE_ID" \
  --resource-type CONTACT_TRACE_RECORDS \
  --storage-config "StorageType=KINESIS_STREAM,KinesisStreamConfig={StreamArn=$STREAM_ARN}" \
  --region "$REGION"

echo "Done."
