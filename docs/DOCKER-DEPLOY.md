# 🐳 Despliegue con Docker — ChatBot Hub

Guía completa para levantar ChatBot Hub en tu VPS usando Docker, sin preocuparte por versiones de Node, dependencias o compatibilidad.

---

## Requisitos en tu VPS

- **Docker**: v20.10+  
- **Docker Compose**: v2.0+ (viene incluido con Docker Desktop y las instalaciones modernas de Docker Engine)
- **Puertos abiertos**: `3000` (app) y `8080` (Evolution API, si la usas)

### Instalar Docker en Ubuntu/Debian (si no lo tienes)

```bash
# Actualizar paquetes
sudo apt update && sudo apt upgrade -y

# Instalar Docker
curl -fsSL https://get.docker.com | sh

# Agregar tu usuario al grupo docker (para no usar sudo)
sudo usermod -aG docker $USER

# Cerrar sesión y volver a entrar para que tome efecto
exit
# (reconectar SSH)

# Verificar instalación
docker --version
docker compose version
```

---

## Paso 1: Subir los archivos al VPS

Desde tu máquina local, sube el proyecto completo al servidor. Puedes usar `scp`, `rsync`, o `git`:

### Opción A: rsync (recomendado)
```bash
rsync -avz --exclude node_modules --exclude 'database/*.sqlite' \
  /Volumes/ExternalHelp/Outside/htdocs/ChatBot/ \
  tu_usuario@tu-vps-ip:/home/tu_usuario/chatbot-hub/
```

### Opción B: scp
```bash
scp -r /Volumes/ExternalHelp/Outside/htdocs/ChatBot/ \
  tu_usuario@tu-vps-ip:/home/tu_usuario/chatbot-hub/
```

### Opción C: Git (si subes a un repositorio privado)
```bash
# En tu VPS
git clone https://tu-repo.com/chatbot-hub.git
cd chatbot-hub
```

---

## Paso 2: Configurar variables de entorno

En el VPS, edita el archivo `.env` con tus valores reales:

```bash
cd /home/tu_usuario/chatbot-hub
cp .env.example .env
nano .env
```

Cambia al menos:
- `JWT_SECRET` → un valor secreto único largo
- `ADMIN_PASSWORD` → una contraseña segura
- Las credenciales de WhatsApp y/o IA cuando las tengas

---

## Paso 3: Levantar los servicios

### Todo junto (ChatBot + Evolution API para WhatsApp QR):
```bash
docker compose --profile whatsapp-qr up -d
```

### Solo ChatBot Hub (sin Evolution API):
```bash
docker compose up -d
```

> **Importante:** `evolution-api` usa un *profile* de Docker Compose. Solo se levanta con el flag `--profile whatsapp-qr`. Usar solo `docker compose up -d` arranca únicamente `chatbot-hub`.

### Verificar que los contenedores están corriendo:
```bash
docker compose ps
```

Deberías ver algo como:
```
NAME              STATUS          PORTS
chatbot-hub       Up (healthy)    0.0.0.0:3000->3000/tcp
evolution-api     Up              0.0.0.0:8080->8080/tcp
```

### Ver logs en tiempo real:
```bash
docker compose logs -f chatbot-hub
```

---

## Paso 4: Acceder al panel

Abre en tu navegador:
```
http://tu-vps-ip:3000/admin/login.html
```

Credenciales por defecto:
- **Email**: `admin@chatbot.local`
- **Contraseña**: la que configuraste en `.env`

---

## Paso 5: Configurar Nginx como Proxy Inverso (Producción con HTTPS)

Para usar tu dominio con SSL, instala Nginx y Certbot:

```bash
sudo apt install nginx certbot python3-certbot-nginx -y
```

Crea la configuración de Nginx:

```bash
sudo nano /etc/nginx/sites-available/chatbot
```

```nginx
server {
    server_name chatbot.tu-dominio.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Activar y obtener certificado SSL:

```bash
sudo ln -s /etc/nginx/sites-available/chatbot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d chatbot.tu-dominio.com
```

> **Importante:** La configuración de Nginx incluye headers para WebSocket (`Upgrade` y `Connection`) que son necesarios para que funcione Socket.IO (chat en tiempo real).

> **Nota sobre el Login QR:** La app detecta HTTPS automáticamente gracias a `app.set('trust proxy', 1)` en `server.js`. El código QR generado en el panel apuntará al dominio que configures aquí (ej: `https://chatbot.tu-dominio.com/admin/qr-scan.html?token=...`). Asegúrate de acceder al panel por tu dominio HTTPS y no por la IP, o el QR apuntará a la IP.

---

## Comandos útiles de mantenimiento

| Comando | Descripción |
|---|---|
| `docker compose up -d` | Levantar todos los servicios |
| `docker compose down` | Detener todos los servicios |
| `docker compose restart chatbot-hub` | Reiniciar solo la app |
| `docker compose logs -f chatbot-hub` | Ver logs en tiempo real |
| `docker compose exec chatbot-hub sh` | Entrar al contenedor |
| `docker compose build --no-cache` | Reconstruir imagen (después de cambios) |
| `docker compose pull` | Actualizar Evolution API a última versión |

---

## Actualizar la app en producción

Cuando hagas cambios en el código:

```bash
# 1. Subir archivos actualizados al VPS (rsync, git pull, etc.)

# 2. Reconstruir la imagen y reiniciar
docker compose build --no-cache chatbot-hub
docker compose up -d chatbot-hub

# 3. Verificar que está corriendo
docker compose ps
docker compose logs -f chatbot-hub
```

---

## Backup de la base de datos

La base de datos SQLite se almacena en el volumen Docker persistente `chatbot_data` montado en `/app/data` dentro del contenedor (separado del código de la app). Para hacer backup:

```bash
# Copiar la BD desde el volumen al host
docker compose cp chatbot-hub:/app/data/chatbot.sqlite ./backup_$(date +%Y%m%d).sqlite
```

Para restaurar un backup:

```bash
docker compose stop chatbot-hub
docker compose cp ./backup_20260101.sqlite chatbot-hub:/app/data/chatbot.sqlite
docker compose start chatbot-hub
```
