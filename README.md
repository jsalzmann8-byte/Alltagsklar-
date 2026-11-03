# ALLTAGSKLAR – Full-Stack-Startpaket

En erweiterte Version des Frontend-Prototyps mit vorbereitetem Backend für Supabase-Login, einen serverseitigen OpenAI-Assistenten und Stripe-Abos. Zugangsdaten sind absichtlich nicht enthalten. Ohne eigene Anbieter-Konfiguration werden geschützte Aktionen mit einer klaren Meldung abgelehnt – es gibt keine vorgetäuschte Anmeldung oder Zahlung.

## Enthalten

- `public/index.html`: bestehendes Design mit Login/Registrierung, Profilstatus, echtem API-Aufruf für den Assistenten und Stripe-Checkout-Aktionen.
- `server.mjs`: Express-Backend, Supabase-Tokenprüfung, KI-Endpunkt, Tariflimits, Stripe Checkout und Webhook.
- `supabase/schema.sql`: Profile, Projekte, AI-Nutzung, RLS-Regeln und Profil-Trigger.
- `.env.example`: benötigte Umgebungsvariablen.

## Lokal starten

Voraussetzung: Node.js 20 oder neuer.

```bash
cp .env.example .env
npm install
npm start
```

Dann `http://localhost:4242` öffnen. Solange `.env` nicht mit echten Test-Zugangsdaten befüllt ist, funktionieren Login, KI und Zahlung nicht; die Website erklärt das dann ausdrücklich.

## Supabase einrichten

1. Ein Projekt unter https://supabase.com anlegen.
2. In **Project Settings → API** Projekt-URL und Publishable/Anon-Key in `.env` eintragen.
3. Service-Role-Key ausschließlich serverseitig in `.env` eintragen. Niemals in `public/` oder in Git veröffentlichen.
4. `supabase/schema.sql` im Supabase SQL Editor ausführen.
5. In Authentication die gewünschte E-Mail-Bestätigung und erlaubte Redirect-URLs setzen. Für lokal `http://localhost:4242` erlauben.

## OpenAI einrichten

1. API-Key in der OpenAI Platform erzeugen und serverseitig als `OPENAI_API_KEY` eintragen.
2. `OPENAI_MODEL` auf ein für das Konto verfügbares Modell setzen.
3. API-Kostenlimit/Benachrichtigungen im Anbieter-Konto einrichten und vor dem Launch Limits testen.

Die App nutzt die Responses API. Der API-Key wird nie an den Browser gesendet. Aktueller offizieller Einstieg: https://platform.openai.com/docs/api-reference/responses

## Stripe einrichten

1. Stripe-Konto im Testmodus öffnen.
2. Zwei wiederkehrende monatliche Preise anlegen: Plus 3,99 EUR und Premium 7,99 EUR (Steuern/Endpreise passend zum späteren Geschäftsmodell konfigurieren).
3. Die Price-IDs als `STRIPE_PRICE_PLUS` und `STRIPE_PRICE_PREMIUM` in `.env` eintragen.
4. `STRIPE_SECRET_KEY` mit einem Test-Secret-Key befüllen.
5. Webhook-Endpunkt `/api/stripe/webhook` abonnieren. Mindestens Events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` auswählen; das Webhook-Secret in `.env` eintragen.
6. Checkout und Kündigungs-/Statuswechsel im Testmodus durchspielen, bevor Live-Schlüssel verwendet werden.

## Wichtige Hinweise vor Veröffentlichung

- Die Frontend-Werkzeuge speichern bisher einige Eingaben lokal im Browser. `saved_projects` ist vorbereitet, aber die Synchronisierung bestehender Planer-/Budgetdaten in die Datenbank muss als eigener Schritt ergänzt und getestet werden.
- Die Abo-Checkout-Route ist vorbereitet; ein Kundenportal für selbstständige Kündigungen/Rechnungsverwaltung muss noch ergänzt werden.
- Webhook-Fehlerbehandlung, E-Mail-Zustellung, Rate-Limiting/IP-Schutz, Monitoring, Backups, Datenschutztexte, Impressum, AGB und steuerliche Prüfung vor Livegang ergänzen.
- Für Live-Betrieb HTTPS, sichere Hosting-Secrets und eine korrekte `APP_URL` verwenden.
- Das Schema ist ein Startpunkt und muss vor Produktionsbetrieb mit Tests, Berechtigungsprüfung und Datenschutzanforderungen validiert werden.
