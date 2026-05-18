#!/bin/bash
# deploy_from_backup.sh - Скрипт для быстрого деплоя из бэкапа

set -e

# === НАСТРОЙКИ ===
BACKUP_FILE="${1:-}"  # Путь к архиву бэкапа (передается первым аргументом)
PROJECT_NAME="yoga_crm"
USER_NAME="django_user"
DOMAIN="alenaproyoga.ru"
SERVER_IP="87.103.255.224"
# =================

if [ -z "$BACKUP_FILE" ]; then
    echo "❌ Ошибка: Не указан файл бэкапа."
    echo "Использование: $0 <путь_к_архиву_бэкапа.tar.gz>"
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Ошибка: Файл бэкапа не найден: $BACKUP_FILE"
    exit 1
fi

echo "🚀 Начало восстановления из бэкапа: $BACKUP_FILE"

# Создаем временную директорию для распаковки
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "📦 Распаковка бэкапа..."
tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR"

# Находим распакованную директорию (она будет иметь имя вида server_backup_YYYYMMDD_HHMMSS)
BACKUP_CONTENT_DIR=$(find "$TEMP_DIR" -maxdepth 1 -type d -name "server_backup_*" | head -n 1)

if [ -z "$BACKUP_CONTENT_DIR" ]; then
    echo "❌ Ошибка: Не удалось найти директорию с содержимым бэкапа."
    exit 1
fi

echo "📁 Восстановление конфигурации Nginx..."
if [ -f "$BACKUP_CONTENT_DIR/nginx/alenaproyoga.ru" ]; then
    cp "$BACKUP_CONTENT_DIR/nginx/alenaproyoga.ru" /etc/nginx/sites-available/$DOMAIN
    ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
    rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
elif [ -f "$BACKUP_CONTENT_DIR/nginx/$PROJECT_NAME.conf" ]; then
    cp "$BACKUP_CONTENT_DIR/nginx/$PROJECT_NAME.conf" /etc/nginx/sites-available/$DOMAIN
    ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
    rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
fi

if [ -f "$BACKUP_CONTENT_DIR/nginx/proxy_params" ]; then
    cp "$BACKUP_CONTENT_DIR/nginx/proxy_params" /etc/nginx/proxy_params
fi

echo "📁 Восстановление сервиса Gunicorn..."
if [ -f "$BACKUP_CONTENT_DIR/systemd/gunicorn.service" ]; then
    cp "$BACKUP_CONTENT_DIR/systemd/gunicorn.service" /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable gunicorn
fi

echo "📁 Восстановление SSL сертификатов..."
if [ -d "$BACKUP_CONTENT_DIR/certbot/live/$DOMAIN" ]; then
    # Восстанавливаем только если директория letsencrypt пуста или требует обновления
    if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ] || [ "$(ls -A /etc/letsencrypt/live/$DOMAIN)" = "" ]; then
        mkdir -p /etc/letsencrypt/live/$DOMAIN
        cp -r "$BACKUP_CONTENT_DIR/certbot/live/$DOMAIN"/* /etc/letsencrypt/live/$DOMAIN/
    fi
    if [ -f "$BACKUP_CONTENT_DIR/certbot/options-ssl-nginx.conf" ]; then
        cp "$BACKUP_CONTENT_DIR/certbot/options-ssl-nginx.conf" /etc/letsencrypt/
    fi
    if [ -f "$BACKUP_CONTENT_DIR/certbot/ssl-dhparams.pem" ]; then
        cp "$BACKUP_CONTENT_DIR/certbot/ssl-dhparams.pem" /etc/letsencrypt/
    fi
fi

echo "📁 Восстановление переменных окружения (.env)..."
if [ -f "$BACKUP_CONTENT_DIR/env/.env" ]; then
    cp "$BACKUP_CONTENT_DIR/env/.env" /home/$USER_NAME/$PROJECT_NAME/.env
    chown $USER_NAME:$USER_NAME /home/$USER_NAME/$PROJECT_NAME/.env
    chmod 600 /home/$USER_NAME/$PROJECT_NAME/.env
fi

echo "🔧 Проверка конфигурации Nginx..."
nginx -t

echo "🔄 Перезапуск сервисов..."
systemctl restart nginx
systemctl restart gunicorn

echo "✅ Восстановление завершено!"
echo "🌐 Сайт должен быть доступен по адресу: https://$DOMAIN"
echo "💡 Проверьте статус сервисов: systemctl status nginx gunicorn"
echo "💡 Если возникли проблемы с SSL, выполните: certbot renew --dry-run"