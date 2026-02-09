# RAM Backend - Quick Start

## Prerequisites

- Docker & Docker Compose
- Rust (latest stable)

## Getting Started

### 1. Start PostgreSQL

```bash
cd ram-backend
docker-compose up -d
```

Kiểm tra PostgreSQL đã chạy:
```bash
docker-compose ps
# Hoặc
docker ps | grep ram-postgres
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Mặc định `.env` đã được cấu hình sẵn cho Docker PostgreSQL. Chỉ cần update:
- `RAM_PACKAGE_ID` - Package ID của smart contract RAM
- `SUI_RPC_URL` - Sui RPC endpoint (nếu khác testnet)

### 3. Run Backend

```bash
cargo run --release
```

Backend sẽ:
- ✅ Connect tới PostgreSQL (port 5434)
- ✅ Chạy database migrations tự động
- ✅ Khởi động HTTP server (port 4000)
- ✅ Bắt đầu indexing events từ Sui blockchain

### 4. Verify

```bash
# Check health
curl http://localhost:4000/health

# Kết quả mong đợi:
# {
#   "status": "healthy",
#   "nautilus_server": "up",
#   "database": "up",
#   "indexer": "running"
# }
```

## Database Access

### Kết nối từ command line

```bash
# Sử dụng docker exec
docker exec -it ram-postgres psql -U ram -d ram

# Hoặc từ host (nếu có psql installed)
psql -h localhost -p 5434 -U ram -d ram
# Password: ram123
```

### Các lệnh PostgreSQL hữu ích

```sql
-- Xem tất cả events
SELECT * FROM ram_events ORDER BY timestamp_ms DESC LIMIT 10;

-- Đếm events theo loại
SELECT event_type, COUNT(*) FROM ram_events GROUP BY event_type;

-- Xem events của một wallet
SELECT * FROM ram_events WHERE handle = 'alice';
```

## Troubleshooting

### PostgreSQL không start

```bash
# Xem logs
docker-compose logs postgres

# Restart
docker-compose restart postgres
```

### Port 5434 đã được sử dụng

Sửa port trong `docker-compose.yml`:
```yaml
ports:
  - "5435:5432"  # Đổi 5434 thành port khác
```

Và update `DATABASE_URL` trong `.env`:
```
DATABASE_URL=postgres://ram:ram123@localhost:5435/ram
```

### Reset database

```bash
# WARNING: Xóa toàn bộ dữ liệu
docker-compose down -v
docker-compose up -d
```

## Stop Services

```bash
# Stop backend: Ctrl+C trong terminal đang chạy cargo run

# Stop PostgreSQL
docker-compose down

# Stop và xóa data
docker-compose down -v
```

## Next Steps

- Xem [README.md](README.md) để biết thêm về API endpoints
- Xem [INTEGRATION.md](INTEGRATION.md) để tích hợp với Frontend
- Xem [DOCKER.md](DOCKER.md) để biết thêm Docker commands
