# Golan Stora — Deployment

## Render
This package is configured for Render with a persistent disk. The persistent disk is required because the store uses SQLite for wallet balances, deposits, orders and digital codes.

### Environment variables
- `ADMIN_EMAIL` — your admin email
- `ADMIN_PASSWORD` — your admin password
- `JWT_SECRET` — long random secret
- `DB_DIR` — optional; defaults to `./data`

### Render settings
- Build: `npm install`
- Start: `npm start`
- Persistent disk mount: `/opt/render/project/src/data`

Do not publish the store with a temporary/ephemeral filesystem if it will hold real customer balances or codes.
