# Tabibna — Documentation Technique Développeur

> **Tagline :** "Prendre soin, simplement" — Plateforme marocaine de prise de rendez‑vous médicaux (web + mobile).

---

## Table des matières
1. Introduction
2. Vision produit & périmètre fonctionnel
3. Stack technique
4. Architecture globale
5. Base de données — Modèle conceptuel & DDL (MySQL)
6. API — Endpoints principaux (REST)
7. Authentification & sécurité
8. Intégrations locales (paiement, SMS/WhatsApp, vidéo)
9. Déploiement, infrastructure & CI/CD
10. Monitoring, logs et observabilité
11. Conformité, protection des données et bonnes pratiques
12. Guide « setup local » (docker-compose)
13. Variables d'environnement
14. Roadmap technique & scalabilité
15. Annexes: exemples de payloads, migration SQL

---

## 1. Introduction
Tabibna est une application destinée au marché marocain permettant aux patients de rechercher des praticiens, prendre des rendez‑vous en ligne, recevoir des rappels et, à terme, effectuer des téléconsultations. Les professionnels de santé bénéficient d'un tableau de bord pour gérer leur agenda, consulter des statistiques et recevoir des paiements.

Objectifs techniques : robustesse, sécurité des données de santé, localisation (FR/AR/EN), intégration avec moyens de paiement locaux et canaux de notification marocains.

---

## 2. Vision produit & périmètre fonctionnel
- Utilisateurs : Patients, Professionnels (Médecins, Cliniques), Admin.
- Fonctionnalités MVP :
  - Recherche par spécialité / ville / disponibilité
  - Profil praticien (infos, tarifs, horaire)
  - Prise / modification / annulation de RDV
  - Rappels automatiques (SMS / WhatsApp / e‑mail)
  - Interface REST pour applications Web et Mobile
  - Dashboard praticien (agenda, liste RDV, export CSV)

Fonctionnalités post‑MVP : téléconsultation vidéo, paiement en ligne, intégration mutuelles, ordonnance numérique.

---

## 3. Stack technique
- Frontend Web : **Next.js (React + TypeScript)**
- Mobile : **React Native (Expo)**
- Backend : **Node.js (TypeScript) + Express**
- ORM : **Prisma** (MySQL)
- Base de données : **MySQL 8.x**
- Auth : **JWT (RS256) + refresh tokens**
- File storage : **S3-compatible** (MinIO / AWS S3 / OVHcloud)
- Messages & notifications : **RabbitMQ** (queue), intégration Twilio / AfricasTalking / fournisseurs locaux
- Conteneurisation : **Docker / docker-compose**
- Infra : **Kubernetes (production)** ou VPS + Docker Compose
- CI/CD : **GitHub Actions**
- Monitoring : **Prometheus + Grafana + Sentry**

---

## 4. Architecture globale

```mermaid
graph TD
  subgraph Client
    A[Web Next.js] -->|HTTPS| API
    B[Mobile Expo] -->|HTTPS| API
  end
  subgraph Backend
    API[API Gateway (Express)] --> Auth[Auth Service]
    API --> App[App Service (Express + Prisma)]
    App --> DB[(MySQL)]
    App --> Storage[(S3)]
    App --> Queue[(RabbitMQ)]
    Queue --> Worker[Worker (emails, SMS, jobs)]
  end
  subgraph Infra
    API -->|metrics| Prometheus
    App --> Sentry
  end
```

Principes : API REST versionnée (`/v1/`), logique métier principalement côté backend, workers pour tâches asynchrones (envoi SMS, confirmation e‑mail, jobs de nettoyage), RLS appliqué dans l'ORM + vérifications au niveau des routes.

---

## 5. Base de données — Modèle conceptuel & DDL (MySQL)
### Principales tables
- users (patients + practitioners + admin)
- practitioners_profiles
- clinics
- schedules (créneaux / récurrences)
- tables_availability (si gestion tables pour cliniques)
- reservations
- payments
- notifications
- reviews
// complémentaires (techniques)
- refresh_tokens (hashés, révocables, avec expiration)
- reset_tokens (court terme, usage unique pour réinitialisation de mot de passe)

### Exemple DDL (MySQL)
```sql
-- users
CREATE TABLE users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(32),
  password_hash VARCHAR(255) NULL,
  role ENUM('patient','practitioner','admin') NOT NULL DEFAULT 'patient',
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  locale VARCHAR(5) DEFAULT 'fr',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- practitioners_profiles
CREATE TABLE practitioners_profiles (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  specialty VARCHAR(150),
  bio TEXT,
  clinic_id BIGINT,
  price_min INT,
  price_max INT,
  rating FLOAT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- clinics
CREATE TABLE clinics (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255),
  address TEXT,
  city VARCHAR(100),
  latitude DECIMAL(9,6),
  longitude DECIMAL(9,6),
  phone VARCHAR(32),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- schedules (disponibilités)
CREATE TABLE schedules (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  practitioner_id BIGINT NOT NULL,
  day_of_week TINYINT, -- 0=Sunday..6=Saturday
  start_time TIME,
  end_time TIME,
  slot_duration_minutes INT DEFAULT 15,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (practitioner_id) REFERENCES practitioners_profiles(id) ON DELETE CASCADE
);

-- reservations
CREATE TABLE reservations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  patient_id BIGINT NOT NULL,
  practitioner_id BIGINT NOT NULL,
  clinic_id BIGINT,
  start_datetime DATETIME NOT NULL,
  end_datetime DATETIME NOT NULL,
  status ENUM('booked','confirmed','cancelled','completed','no_show') DEFAULT 'booked',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES users(id),
  FOREIGN KEY (practitioner_id) REFERENCES practitioners_profiles(id),
  FOREIGN KEY (clinic_id) REFERENCES clinics(id)
);

-- notifications
CREATE TABLE notifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  type VARCHAR(50), -- sms, email, push
  channel VARCHAR(50),
  payload JSON,
  sent_at TIMESTAMP NULL,
  status ENUM('pending','sent','failed') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

> Remarque : ajouter index sur `practitioner_id`, `start_datetime` et `status` pour optimiser les requêtes de recherche et de gestion d'agenda.

---

## 6. API — Endpoints principaux (REST)
Base URL : `https://api.tabibna.ma/v1`
\- Local (développement) : `http://localhost:4000/v1`

### Auth
- `POST /v1/auth/register` — body: `{ email, phone, password, role }` → 201 + `{ user, token, refreshToken }`
- `POST /v1/auth/login` — body: `{ emailOrPhone, password }` → `{ user, token, refreshToken }`
- `POST /v1/auth/refresh` — body: `{ refreshToken }` → `{ token }`
- `POST /v1/auth/forgot-password` — body: `{ emailOrPhone }` → 200
// Réinitialisation de mot de passe
- `POST /v1/auth/request-password-reset` — body: `{ emailOrPhone }` → 200 `{ status: "ok" }` (ne révèle pas l'existence d'un compte)
- `POST /v1/auth/reset-password` — body: `{ token, password }` → 200 `{ status: "ok" }`

### Patients
- `GET /v1/practitioners?city=Casablanca&specialty=cardio&date=2025-09-30` → liste
- `GET /v1/practitioners/:id` → détail profil
- `GET /v1/practitioners/:id/availability?date=YYYY-MM-DD&slot_minutes=15&limit=100&offset=0&utc_offset=0` → créneaux disponibles pour la date; réponse: `{ date, slots, total, offset, limit }` (où `utc_offset` est en minutes pour ajuster l'affichage côté client)
- `POST /v1/reservations` — body: `{ practitioner_id, clinic_id, start_datetime, end_datetime, patient_notes }` → 201
- `GET /v1/reservations/:id` → détail (auth patient/practitioner)
- `PUT /v1/reservations/:id/cancel` → annuler
- `PUT /v1/reservations/:id` — reprogrammer (reschedule) — body: `{ start_datetime, end_datetime }` → 200 (réservation mise à jour)

> Auth (Bearer) requis: `POST /v1/reservations`, `PUT /v1/reservations/:id`, `PUT /v1/reservations/:id/cancel`, et toutes les routes `/v1/practitioners/me/*` (rôle `practitioner`).

### Praticiens (secured)
- `GET /v1/practitioners/me/reservations?from=...&to=...` → liste réservations
- `POST /v1/practitioners/me/schedules` → créer disponibilité
- `PUT /v1/practitioners/me/schedules/:id` → modifier
- `GET /v1/practitioners/me/stats` → nombre RDV, taux no-show, revenus estimés

> Note (dev uniquement): un endpoint `POST /v1/practitioners/me/seed-dev-practitioner` est disponible pour créer rapidement un praticien de test en environnement local (désactivé en production).

### Notifications / Webhooks
- `POST /v1/webhooks/payment` → endpoint pour réception paiement (signature HMAC)
- `POST /v1/webhooks/provider/sms` → recevoir status SMS

---

## 7. Authentification & sécurité
- **JWT RS256** (clé privée pour signer, publique pour validation) — permet révocation centralisée via liste noire (Redis).
- **Refresh tokens** stockés en DB (hashés) pour pouvoir les invalider.
- **Password hashing** : bcrypt, cost >= 12.
- **Rate limiting** : Nginx + middleware (express-rate-limit) pour endpoints sensibles (/auth, /webhooks).
- **Input validation** : Joi / Zod sur toutes les routes.
- **ORM safe queries** : Prisma avec requêtes paramétrées (évite injections SQL).
- **RLS logique** : vérifier `user.role` et relations (ex. `practitioner` ne voit que ses réservations).
- **HTTPS strict** (HSTS), CSP pour front.
- **Encryption at rest** : S3 server-side encryption, DB disks chiffrés.

Précisions (production):
- **RBAC & contrôle d’accès**
  - Les routes `/v1/practitioners/me/*` exigent le rôle `practitioner` (auth obligatoire).
  - Les mutations de réservation (création, reprogrammation `PUT /v1/reservations/:id`, annulation `PUT /v1/reservations/:id/cancel`) vérifient la propriété (patient ou praticien concerné) et/ou le rôle autorisé.
- **Rate limiting**
  - Les endpoints d’authentification `/v1/auth/*` sont protégés par un rate limit dédié (anti-bruteforce).
  - Les webhooks `/v1/webhooks/*` sont soumis à un rate limit plus strict: 10 requêtes/minute par IP.
- **Format des tokens**
  - L’API renvoie les champs `token` (JWT d’accès signé RS256) et `refreshToken` (chaîne aléatoire stockée hashée côté serveur).
  - Le rafraîchissement attend `{ refreshToken }` sur `POST /v1/auth/refresh` et retourne `{ token, refreshToken }` (rotation).

---

## 8. Intégrations locales
### Paiement
- Intégrer **CMI** (Centre Monétique Interbancaire) via leur API pour paiements cartes marocaines.
- Option : intégrer **Payzone / Paymee / Wafacash / M-Pesa like** selon cibles (pharmacies, tiers).
- Webhook sécurisé (HMAC) pour confirmer paiements côté backend.

#### Webhooks — Signature HMAC
- En-têtes acceptés: `x-signature`, `x-signature-sha256`, et `x-hub-signature` (pour certains providers). Les formats `sha256=<hex>` ou `<hex>` sont acceptés.
- Algorithme: HMAC SHA‑256 calculé sur le corps RAW (octets) de la requête telle qu'envoyée. Le backend utilise un body parser "raw" pour conserver les octets d'origine.
- Secrets: `PAYMENT_WEBHOOK_SECRET`, `SMS_WEBHOOK_SECRET`.
- Réponses: `200 { ok: true }` si signature valide; `401` si signature invalide.

Exemple signature (Node.js):
```ts
import crypto from 'crypto';
const payload = { event: 'paid', amount: 100 };
const body = JSON.stringify(payload); // bytes exactly as sent on the wire
const signature = crypto.createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET!).update(Buffer.from(body, 'utf8')).digest('hex');
// Inclure header: { 'x-signature': signature }
```

Exemple cURL (local):
```bash
PAYLOAD='{"event":"paid","amount":100}'
SIG=$(node -e "const c=require('crypto');const s=process.env.PAYMENT_WEBHOOK_SECRET;const b=process.argv[1];console.log(c.createHmac('sha256', s).update(b).digest('hex'));" "$PAYLOAD")
curl -X POST http://localhost:4000/v1/webhooks/payment \
  -H "Content-Type: application/json" \
  -H "x-signature: $SIG" \
  -d "$PAYLOAD"
```

### SMS / WhatsApp
- Fournisseurs possibles : **Twilio**, **AfricasTalking**, ou opérateurs locaux via API (Orange, Inwi). Pour WhatsApp Business API, utiliser **Facebook/Meta** ou fournisseurs BSP (MessageBird, 360dialog).

### Téléconsultation (vidéo)
- Option 1 (rapide) : intégrer **Jitsi** self-hosted (SIP optional) ou Jitsi cloud.
- Option 2 (scalable) : **Twilio Programmable Video** ou Daily.co.
- Stockage sécurisé des enregistrements (si activé) avec consentement patient.

---

## 9. Déploiement, infrastructure & CI/CD
### Environnement :
- Staging : cluster Kubernetes (1+ nodes), namespace `staging`.
- Production : cluster Kubernetes (HA) ou managed (DigitalOcean Kubernetes / AWS EKS / GCP GKE / OVH Managed K8s).

### Artefacts :
- Docker images pour `api`, `worker`, `frontend`.
- Registry : GitHub Container Registry / Docker Hub / Private Registry.

### Exemple pipeline GitHub Actions (simplifié)
1. `on: push` sur `main` → tests unitaires → build Docker → push image → deploy to k8s via `kubectl` / `helm`.
2. `on: pull_request` → lint + tests.

Recommandations CI:
- Exécuter les tests API avant build: `npm ci && npm test` dans `api/`.
- Politique images: pinner les bases par digest (ex: `node:20-bookworm-slim@sha256:...`) et activer un scan des images (échec si vulnérabilités hautes/critiques quand possible).

### Secrets & config
- Stocker secrets dans Vault / GitHub Secrets / Kubernetes Secrets (sealed/secrets manager).

---

## 10. Monitoring, logs et observabilité
- **Logs**: structured JSON logs via Winston / pino → centralisé sur ELK (Elasticsearch + Logstash + Kibana) ou Loki + Grafana.
- **Errors**: Sentry for Node + Frontend.
- **Metrics**: Prometheus scrape / Grafana dashboards (latency, error rate, queue length, DB connections). L'API expose `/metrics` (Prometheus) et `/health`.
- **Health checks**: liveness & readiness probes pour k8s.

Compléments:
- **Activation Sentry**: définir `SENTRY_DSN` (laisser vide en dev pour désactiver).
- **Logs API**: l’API utilise `pino-http` (JSON) pour une ingestion facile par les agrégateurs.

---

## 11. Conformité & protection des données
- Au Maroc il n'existe pas d'équivalent HDS strict comme en France, mais appliquer les bonnes pratiques :
  - Minimisation des données stockées.
  - Consentement explicite pour données de santé.
  - Chiffrement des données sensibles en base (ex. dossiers médicaux partiels) via AES-256.
  - Durée de conservation conforme aux recommandations juridiques locales.
  - Réaliser un registre des traitements et une analyse d'impact (DPIA) si les traitements sont sensibles.

---

## 12. Guide « setup local » (docker-compose)
Fichier `docker-compose.yml` minimal pour développement :
```yaml
services:
  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: rootpass
      MYSQL_DATABASE: tabibna_dev
    ports:
      - '3307:3306'
    volumes:
      - db_data:/var/lib/mysql

  api:
    build: ./api
    environment:
      - DATABASE_URL=mysql://root:rootpass@db:3306/tabibna_dev
      - JWT_PRIVATE_KEY=/run/secrets/jwt_private
      - JWT_PUBLIC_KEY=/run/secrets/jwt_public
      - PORT=4000
    depends_on:
      - db
    ports:
      - '4000:4000'
    secrets:
      - jwt_private
      - jwt_public

  worker:
    build: ./worker
    environment:
      - DATABASE_URL=mysql://root:rootpass@db:3306/tabibna_dev
    depends_on:
      - db
      - api

volumes:
  db_data:

secrets:
  jwt_private:
    file: ./secrets/jwt_private.pem
  jwt_public:
    file: ./secrets/jwt_public.pem
```

Étapes :
1. Cloner le repo
2. Copier `api/.env.example` vers `api/.env` et compléter si besoin
3. Générer les clés RSA JWT (RS256) et les placer dans `secrets/jwt_private.pem` et `secrets/jwt_public.pem` (répertoire ignoré par Git)
4. Démarrer: `docker-compose up --build`
5. Vérifier la santé API: `curl http://localhost:4000/health`
6. (Si nécessaire en local) appliquer les migrations Prisma: `cd api && npx prisma migrate dev`

Générer des clés JWT (PowerShell + OpenSSL):
```powershell
mkdir secrets
openssl genrsa -out secrets/jwt_private.pem 2048
openssl rsa -in secrets/jwt_private.pem -pubout -out secrets/jwt_public.pem
```

Tests (intégration rapide):
```powershell
# Pré‑requis: stack en cours d’exécution (docker-compose up -d)
cd api
$env:API_URL = "http://localhost:4000"  # optionnel
npm test
```

Dépannage Prisma/OpenSSL:
- Les images utilisent Debian slim; Prisma requiert OpenSSL. Si vous voyez `libssl`/`Unable to require(... openssl-1.1.x.so.node)`, voir README ("Security hygiene / Prisma & OpenSSL") et reconstruire: `docker-compose build --no-cache api`.

---

## 13. Variables d'environnement (exemples)
- `DATABASE_URL` = `mysql://user:pass@host:3306/dbname`
- `JWT_PRIVATE_KEY` (PEM) / `JWT_PUBLIC_KEY`
- `JWT_EXPIRES_IN` = `15m`
- `REFRESH_TOKEN_EXPIRES_IN` = `30d`
- `PORT` = `4000` (par défaut)
- `SENTRY_DSN`
- `PAYMENT_WEBHOOK_SECRET`, `SMS_WEBHOOK_SECRET`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`, `S3_SECRET`
- `SMS_PROVIDER_API_KEY`
- `PAYMENT_PROVIDER_KEY`, `PAYMENT_PROVIDER_SECRET`

Notes:
- Formats supportés pour durées: `Xs`, `Xm`, `Xh`, `Xd` (ex: `JWT_EXPIRES_IN=15m`, `REFRESH_TOKEN_EXPIRES_IN=30d`).

---

## 14. Roadmap technique & scalabilité
- Court terme : MVP, offload tasks vers worker, dashboards basiques.
- Moyen terme : intégration paiement, téléconsultation, analytics avancés.
- Long terme : microservices (séparer auth, billing, notifications), multi‑région DB read replicas, autoscaling k8s.

---

## 15. Annexes
### Exemple payload réservation (request)
```json
{
  "practitioner_id": 123,
  "clinic_id": 45,
  "start_datetime": "2025-10-01T10:00:00",
  "end_datetime": "2025-10-01T10:30:00",
  "patient_notes": "Douleur thoracique intermittente"
}
```

### Exemple réponse (201)
```json
{
  "id": 9876,
  "status": "booked",
  "start_datetime": "2025-10-01T10:00:00",
  "end_datetime": "2025-10-01T10:30:00",
  "practitioner": { "id": 123, "name": "Dr. Ahmed" }
}
```

### Migration SQL exemple (index)
```sql
ALTER TABLE reservations ADD INDEX idx_pract_start (practitioner_id, start_datetime);
```

---

