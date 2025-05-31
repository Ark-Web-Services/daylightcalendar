#!/bin/bash

echo "Starting Home Assistant with port forwarding..."
echo "Home Assistant will be available at http://localhost:7123"

# Make sure supervisor service is running
if ! systemctl is-active --quiet hassio-supervisor; then
  echo "Starting Home Assistant supervisor service..."
  sudo systemctl start hassio-supervisor
fi

# Start socat for port forwarding if needed
if ! pgrep -f "socat TCP-LISTEN:7123" > /dev/null; then
  echo "Setting up port forwarding from 7123 to 8123..."
  socat TCP-LISTEN:7123,fork TCP:supervisor:8123 &
  echo "Port forwarding started."
fi

echo "Home Assistant should now be accessible at http://localhost:7123"
echo "If you still can't access it, try running this command:"
echo "supervisor_run"