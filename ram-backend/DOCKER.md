# Docker Commands for RAM Backend

## Start PostgreSQL
```bash
docker-compose up -d
```

## Stop PostgreSQL
```bash
docker-compose down
```

## View logs
```bash
docker-compose logs -f postgres
```

## Connect to PostgreSQL
```bash
# Using psql from host (if installed)
psql -h localhost -p 5434 -U ram -d ram

# Using docker exec
docker exec -it ram-postgres psql -U ram -d ram
```

## Reset database (WARNING: deletes all data)
```bash
docker-compose down -v
docker-compose up -d
```

## Database Credentials
- Host: localhost
- Port: 5434
- Database: ram
- User: ram
- Password: ram123
