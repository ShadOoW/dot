#!/bin/sh
cd /opt/awsvpnclient || exit 1
exec "/opt/awsvpnclient/AWS VPN Client" "$@"
