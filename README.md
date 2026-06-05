# TaskSnap 📸

TaskSnap is a web application designed for capturing website screenshots and annotating/editing them. It consists of a React frontend and an Express + Playwright backend.

---

## 📁 Project Structure

```text
taskSnap/
├── backend/          # Express server with Playwright for capturing screenshots
│   ├── screenshots/  # Captured screenshots (ignored by Git, managed via .gitkeep)
│   └── server.js     # Server entry point
├── frontend/         # React application built with Vite
│   └── src/          # Frontend source code (canvas/annotation editor)
└── README.md         # Root documentation
```

---

## 🚀 Getting Started

Follow these steps to run both the frontend and backend services locally.

### 1. Prerequisites
Ensure you have [Node.js](https://nodejs.org/) installed (v18+ recommended).

---

### 2. Backend Setup & Run

The backend is an Express server that uses Playwright to navigate to a requested URL, capture a screenshot, and save it.

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables (create a `.env` file based on `.env.example` if needed):
   ```env
   PORT=5000
   ```
4. Start the backend development server:
   ```bash
   npm run dev
   ```

---

### 3. Frontend Setup & Run

The frontend is a React application built with Vite, utilizing canvas libraries like Fabric.js to annotate or edit screenshots.

1. Open a new terminal and navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the frontend development server:
   ```bash
   npm run dev
   ```

---

## 🛠️ Built With

- **Frontend**: React, Vite, Fabric.js / React-Konva, Styled Components
- **Backend**: Node.js, Express, Playwright (Chromium), CORS
