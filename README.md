# Nutrition Coach Server (NestJS + Ollama)

## 1) Prerequisites

- Node.js 20+
- Ollama installed
- Model pulled: llama3:8b

## 2) Ollama setup

1. Start Ollama service

- ollama serve

1. Pull model

- ollama pull llama3:8b

1. Test model quickly

- ollama run llama3:8b "hello"

## 3) Server setup

1. Go to server folder

- cd nutrition-coach-server

1. Create env file

- copy .env.example .env

1. Install deps (if not installed)

- npm install

1. Start dev server

- npm run start:dev

## 4) Build and run

- npm run build
- npm run start

## 5) API

### Health

- GET /health

### Coach chat

- POST /coach/chat
- Body example:

{
  "question": "Toi bi tang huyet ap, nen an gi de giam sodium?",
  "profile": {
    "age": 27,
    "conditions": ["hypertension"],
    "allergies": ["peanut"],
    "goal": "giam huyet ap"
  }
}

## 6) Notes

- The server retrieves evidence from JSONL files under ../nutrition-rag-data/data.
- If Ollama is unavailable, the server returns a safe fallback summary with evidence IDs.

## 7) Push Notification Environment

FCM sends use Firebase Admin credentials.

- `FIREBASE_SERVICE_ACCOUNT_PATH`: path to a Firebase service account JSON file.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: raw service account JSON for hosted environments.
- `NOTIFICATIONS_SCHEDULER_ENABLED`: set to `true` to run daily reminder sends every minute.

Use only one Firebase credential option. Keep scheduler disabled until device token registration and admin broadcast are verified.
