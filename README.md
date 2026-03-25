# Taskify Backend (taskifybe)

Express + MongoDB backend for Taskify.

## Tech Stack
- Node.js
- Express
- MongoDB (Mongoose)
- JWT auth
- Cookie-based sessions

## Prerequisites
- Node.js 18+
- npm
- MongoDB connection string

## Environment Variables
Create a `.env` file using `.env.example` as reference.

Required keys:
- `PORT`
- `JWT_USER_PASSWORD`
- `FRONTEND_BASE_URL`
- `BACKEND_BASE_URL`
- `CORS_ORIGIN`
- `MONGODB_URI`

## Install
```bash
npm install
```

## Run (Development)
```bash
npm run dev
```

Server entrypoint is `index.js` and default health endpoint is:
- `GET /healthy`

## API Base
Main route group is mounted at:
- `/user`

## Project Structure
- `index.js` - app bootstrap and DB connection
- `routes/user.js` - auth, user, invite, boards APIs
- `routes/todo.js` - todo/card/list APIs
- `middleware/user.js` - auth middleware
- `database/index.js` - Mongoose models
- `utils.js` - utility helpers

## Notes
- Keep secrets only in `.env`.
- Do not commit real credentials.
