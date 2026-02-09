#!/bin/bash
set -e
cd "$(dirname "$0")"
echo "Building RAM backend..."
cargo build --release
echo "Starting RAM backend..."
exec cargo run --release
