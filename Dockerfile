# ---- 1) フロントエンドをビルド ----
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2) バックエンド + ビルド済みフロントを配信 ----
FROM python:3.12-slim AS app
WORKDIR /app

# 依存インストール（PyMuPDF 等は manylinux wheel が入る）
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# バックエンド本体
COPY backend/ ./backend/
# ビルド済みフロント（main.py が ../frontend/dist を配信する）
COPY --from=frontend /app/frontend/dist ./frontend/dist

WORKDIR /app/backend
ENV PORT=8000
EXPOSE 8000
# PaaS が割り当てる $PORT にバインド（未設定なら 8000）
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
