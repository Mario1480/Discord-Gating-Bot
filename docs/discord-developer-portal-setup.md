# Discord Developer Portal Setup (für diesen Bot)

Diese Anleitung zeigt dir exakt, was du im Discord Developer Portal einstellen musst, damit:
- der Bot sauber läuft
- Slash Commands registriert werden
- die Admin-Web-UI Login via Discord OAuth funktioniert

## 1. Application anlegen

1. Öffne [Discord Developer Portal](https://discord.com/developers/applications).
2. Klicke `New Application`.
3. Name vergeben (z. B. `Discord Gating Bot Local`).
4. Speichern.

## 2. Basisdaten für `.env.local.3001`

Unter `General Information`:
- `APPLICATION ID` -> `DISCORD_CLIENT_ID`

Unter `OAuth2 > General`:
- `CLIENT SECRET` -> `DISCORD_CLIENT_SECRET`

Unter `Bot`:
- `Reset Token` / `Copy` -> `DISCORD_TOKEN`

Danach in `.env.local.3001` eintragen:

```env
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_TOKEN=...
```

## 3. Bot-Einstellungen

Unter `Bot`:
1. `Public Bot`: aktiv lassen, wenn du per OAuth einladen willst.
2. `Privileged Gateway Intents`:
   - `SERVER MEMBERS INTENT`: **aktivieren** (wichtig, da der Bot `GuildMembers` nutzt).
3. Änderungen speichern.

## 4. OAuth für Admin Web UI konfigurieren

Unter `OAuth2 > General`:
1. `Redirects` hinzufügen:
   - `http://localhost:3001/auth/callback`
2. Speichern.

Wichtig:
- Die App erzeugt die Callback-URL aus `ADMIN_UI_BASE_URL`.
- Bei `ADMIN_UI_BASE_URL=http://localhost:3001/admin` ergibt sich korrekt:
  `http://localhost:3001/auth/callback`

## 5. Bot in deinen Server einladen

Unter `OAuth2 > URL Generator`:
1. Scopes auswählen:
   - `bot`
   - `applications.commands`
2. Bot Permissions auswählen:
   - `Manage Roles`
   - `Manage Server` (technisch `ManageGuild`)
3. URL öffnen und Bot in den Ziel-Server einladen.

Hinweis:
- Die Bot-Rolle muss in Discord **oberhalb** der Rollen stehen, die verwaltet werden sollen.
- In der Discord-UI heißt die Permission **Manage Server** (nicht „Manage Guild“).

## 6. Guild-ID für schnelles Command-Testing (optional)

Für sofortige Slash-Command-Updates lokal:
1. In Discord `User Settings > Advanced > Developer Mode` aktivieren.
2. Rechtsklick auf Server -> `Copy Server ID`.
3. In `.env.local.3001` setzen:

```env
DISCORD_GUILD_IDS=<DEINE_SERVER_ID>
```

Dann Commands neu registrieren:

```bash
set -a
source .env.local.3001
set +a
npm run commands:register
```

## 7. OAuth Scopes für Admin Login

In `.env.local.3001` sollte stehen:

```env
DISCORD_OAUTH_SCOPES="identify guilds"
```

Das ist korrekt für die Admin-UI, weil dort User + Guild-Liste gebraucht werden.

## 8. Schnell-Check nach Setup

1. App starten:
```bash
npm run start:3001
```
2. Admin öffnen: [http://localhost:3001/admin](http://localhost:3001/admin)
3. Login klicken:
   - Erwartung: Redirect zu Discord
   - Nach Bestätigung Rücksprung auf `/admin`

## 9. Typische Fehlerbilder

- `TokenInvalid` beim Start:
  - `DISCORD_TOKEN` falsch/alt -> im Portal unter `Bot` neu erzeugen und `.env.local.3001` aktualisieren.

- OAuth Callback Fehler:
  - Redirect URL in Portal stimmt nicht exakt mit `http://localhost:3001/auth/callback` überein.

- Bot kann Rollen nicht setzen:
  - `Manage Roles` oder `Manage Server` fehlt oder Bot-Rolle steht zu tief in der Rollen-Hierarchie.

- Keine/alte Slash Commands:
  - `npm run commands:register` nicht ausgeführt oder falsche `DISCORD_CLIENT_ID`/`DISCORD_GUILD_IDS`.
