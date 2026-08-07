# 🏢 Sistema de Pagos - Edificio Nassau P.H.

Sistema PWA de gestión de cuotas de administración para el Edificio Nassau P.H., Cll 32F # 66c-27.

---

## 📦 Estructura del proyecto

```
nassau-admin/
├── frontend/          → PWA (Cloudflare Pages)
├── workers/           → API REST (Cloudflare Workers)
├── database/          → SQL scripts
└── .github/workflows/ → CI/CD automático
```

---

## 🚀 GUÍA DE DESPLIEGUE PASO A PASO

### PASO 1 — Crear base de datos en Neon.tech

1. Ir a **https://neon.tech** y crear cuenta gratuita
2. Crear un nuevo proyecto: nombre `nassau-ph`
3. Copiar la **Connection String** que se ve así:
   ```
   postgresql://nassau_user:PASSWORD@ep-xxxx.us-east-2.aws.neon.tech/nassau_ph?sslmode=require
   ```
4. Guardar esta URL — la necesitará en el Paso 4

### PASO 2 — Conectar Neon.tech a su PGAdmin 4

1. Abrir PGAdmin 4
2. Click derecho en "Servers" → "Register" → "Server..."
3. **General tab:** Name: `Neon - Nassau`
4. **Connection tab:**
   - Host: `ep-xxxx.us-east-2.aws.neon.tech` (del connection string)
   - Port: `5432`
   - Database: `nassau_ph`
   - Username: `nassau_user`
   - Password: (su password de Neon)
   - SSL Mode: `Require`
5. Click "Save"

### PASO 3 — Ejecutar el Schema SQL

1. En PGAdmin 4, conectarse al servidor Neon
2. Click derecho en la base de datos `nassau_ph` → "Query Tool"
3. Abrir el archivo `database/schema.sql` y ejecutarlo (F5)
4. Abrir `database/seeds.sql` y ejecutarlo
5. Verificar que se crearon las tablas en el panel izquierdo

### PASO 4 — Crear repositorio en GitHub

```bash
# En PowerShell, desde C:\Users\SUPERUSUARIO\nassau-admin
git init
git add .
git commit -m "feat: initial Nassau P.H. system"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/nassau-admin.git
git push -u origin main
```

### PASO 5 — Configurar Cloudflare

#### 5a. Crear Worker (API)
1. Ir a **https://dash.cloudflare.com**
2. Workers & Pages → Create Application → "Create Worker"
3. Nombre: `nassau-api`
4. Click Deploy (código temporal)

#### 5b. Crear Pages (Frontend)
1. Workers & Pages → Create Application → "Pages"
2. Conectar con GitHub → seleccionar repositorio `nassau-admin`
3. Configuración de build:
   - **Framework preset:** None
   - **Build command:** (vacío)
   - **Build output directory:** `frontend`
4. Click "Save and Deploy"

#### 5c. Agregar Secrets al Worker
```bash
# En PowerShell, desde nassau-admin/workers
npm install -g wrangler
wrangler login

# Agregar los secretos:
wrangler secret put DATABASE_URL
# (pegar el connection string de Neon.tech)

wrangler secret put JWT_SECRET
# (ingresar una clave aleatoria larga, ej: nassau-jwt-secret-2026-xyz789)

wrangler secret put TURNSTILE_SECRET_KEY
# (ver Paso 6)
```

### PASO 6 — Configurar Cloudflare Turnstile

1. En Cloudflare Dashboard → **Turnstile** (menú izquierdo)
2. Click "Add Site"
3. Site name: `Nassau Admin`
4. Hostnames: agregar su dominio Pages (ej: `nassau-admin.pages.dev`)
5. Widget Mode: **Managed**
6. Click "Create"
7. Copiar el **Site Key** → pegarlo en `frontend/js/auth.js` (reemplazar el placeholder)
8. Copiar el **Secret Key** → usarlo en `wrangler secret put TURNSTILE_SECRET_KEY`

### PASO 7 — Actualizar URL del Worker en el Frontend

1. Ir al Worker en Cloudflare → copiar la URL del worker
   (ej: `https://nassau-api.TU-USUARIO.workers.dev`)
2. Abrir `frontend/js/api.js`
3. Actualizar la línea:
   ```javascript
   const API_BASE = 'https://nassau-api.TU-USUARIO.workers.dev';
   ```
4. Commit y push → se deploya automáticamente

### PASO 8 — Configurar GitHub Secrets para CI/CD

1. En GitHub → repositorio `nassau-admin` → Settings → Secrets → Actions
2. Agregar estos secrets:
   - `CLOUDFLARE_API_TOKEN`: crear en Cloudflare → My Profile → API Tokens
   - `CLOUDFLARE_ACCOUNT_ID`: en Cloudflare Dashboard → Overview (lado derecho)

### PASO 9 — Deploy del Worker desde consola

```bash
cd C:\Users\SUPERUSUARIO\nassau-admin\workers
npm install
npm run deploy
```

### PASO 10 — Primer acceso al sistema

1. Abrir `https://nassau-admin.pages.dev`
2. Iniciar sesión con:
   - Email: `admin@nassau.com`
   - Contraseña: `Nassau2026!`
3. ⚠️ **IMPORTANTE**: Cambiar contraseña inmediatamente en Configuración

---

## 🔑 Credenciales iniciales

| Usuario | Email | Contraseña temporal | Rol |
|---------|-------|---------------------|-----|
| Super Admin | superadmin@nassau.com | Nassau2026! | superadmin |
| Admin Nassau | admin@nassau.com | Nassau2026! | admin_urb |

> **⚠️ Cambiar contraseñas en el primer acceso**

---

## 📋 Funcionalidades

| Módulo | Descripción |
|--------|-------------|
| 🏠 Propietarios | Crear, editar, buscar propietarios |
| 💰 Pagos | Registrar pagos mes a mes |
| 📊 Estado de Cuenta | Ver deudas, saldos, intereses por propietario |
| 🧾 Cuentas de Cobro | Generar PDF con consecutivo NAS## |
| ⚙️ Configuración | Parámetros por año (tasa mora, días) |
| 👑 Super Admin | Gestionar urbanizaciones |

---

## 📄 Documentos generados (NAS##)

**Encabezado:**
```
EDIFICIO NASSAU P.H.
Cll 32F # 66c-27
```

**Pie de página:**
```
DOCUMENTO PROVISIONAL
BANCOLOMBIA cuenta de ahorros No 106-251007-73
PAULA ANDREA HERRERA CANO
De conformidad con la Ley 675 de 2001 de Propiedad Horizontal...
```

---

## 🔄 Generación automática de cuotas

Las cuotas se generan automáticamente los primeros 5 días de cada mes via Cloudflare Cron Trigger. También se pueden generar manualmente desde Configuración → "Generar cuotas".

---

## 💾 Backup de base de datos

Neon.tech realiza backups automáticos. Para backup manual desde PGAdmin 4:
1. Click derecho en la base de datos → "Backup..."
2. Formato: `Custom`, archivo: `nassau-backup-YYYY-MM-DD.backup`

---

## 🛠️ Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | HTML5 + CSS3 + JavaScript (PWA) |
| API | Cloudflare Workers (JavaScript Edge) |
| Base de datos | PostgreSQL en Neon.tech |
| Autenticación | JWT + Cloudflare Turnstile |
| CI/CD | GitHub Actions |
| Hosting | Cloudflare Pages + Workers |
