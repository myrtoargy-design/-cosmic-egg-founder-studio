# COSMIC EGG · Founder Decision Studio v7

Static Greek questionnaire for GitHub Pages. The browser decrypts the questionnaire with PBKDF2-HMAC-SHA-256 (600,000 iterations) and AES-256-GCM. Answers and the current question are encrypted in browser `localStorage`. The application sends no answers to a server. JSON and CSV downloads and the clipboard summary contain readable decision data.

## Local preview

From this folder, run `python3 -m http.server 8090 --bind 127.0.0.1 --directory site` and open `http://localhost:8090/`. Unlocking requires `site/questionnaire.enc.json` and its password.

## Preparing the encrypted questionnaire

Use Node.js 22 or later and the original canonical v7 JSON file outside this repository. The script validates the schema, including 74 unique decisions across 11 sections, and encrypts the file byte for byte.

In Bash, run the following with the path to the private JSON. The input hides the password and passes it via stdin. The script verifies the encrypted result and refuses to overwrite an existing file.

```bash
read -r -s -p 'Questionnaire password: ' studio_password
printf '\n'
printf '%s' "$studio_password" | node scripts/encrypt.mjs /private/canonical.json site/questionnaire.enc.json
unset studio_password
```

Commit the encrypted output and keep the source and password private. Re-encrypting creates a fresh salt and starts a new local progress record for the new payload. Export existing answers before replacing the payload.

## GitHub Pages

Choose **GitHub Actions** in the repository’s **Settings → Pages → Build and deployment → Source**. The deployment workflow runs when `main` changes or when dispatched manually. It uploads the static app and the encrypted questionnaire.
