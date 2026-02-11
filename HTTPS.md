# HTTPS Setup for Mobile Access

Family Vault requires HTTPS when accessing from non-localhost devices because the Web Crypto API is only available in secure contexts.

## Quick Start

Run the development server with HTTPS support:

```bash
npm run dev:https
```

This command:
1. Starts the SSL proxy on port 3334 (HTTPS)
2. Starts the Next.js dev server on port 3333 (HTTP)
3. The proxy forwards HTTPS traffic to the dev server

## Accessing from Mobile

Once running, access Family Vault from your phone:

```
https://192.168.178.53:3334
```

⚠️ **SSL Certificate Warning**: You'll see a browser warning about an insecure connection. This is expected with self-signed certificates. Tap "Advanced" → "Proceed" (Chrome) or "Show Details" → "visit this website" (Safari) to continue.

## How It Works

- **Port 3333**: Next.js dev server (HTTP, localhost only)
- **Port 3334**: SSL proxy (HTTPS, accessible from LAN)
- **cert.pem**: Self-signed certificate (safe to commit)
- **key.pem**: Private key (ignored by git for security)

## Manual Setup (if needed)

Generate new certificates:

```bash
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -subj '/CN=localhost'
```

Run proxy separately:

```bash
npm run proxy:ssl   # In terminal 1
npm run dev         # In terminal 2
```

## Troubleshooting

### Port already in use

Kill existing processes:

```bash
lsof -ti:3333,3334 | xargs kill -9
```

### Can't access from phone

Ensure your phone is on the same WiFi network and the IP address (192.168.178.53) is correct for your machine.
