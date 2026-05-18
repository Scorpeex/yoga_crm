#!/bin/bash
# backup_config.sh - Скрипт для бэкапа конфигурации Django проекта

set -e

PROJECT_NAME="yoga_crm"
BACKUP_DIR="./server_backup_$(date +%Y%m%d_%H%M%S)"
USER_NAME="django_user"

echo "🚀 Начало создания бэкапа конфигурации..."

# Создаем директорию для бэкапа
mkdir -p "$BACKUP_DIR"/{nginx,gunicorn,certbot,env,systemd}

echo "📁 Бэкап конфигурации Nginx..."
cp /etc/nginx/sites-available/$PROJECT_NAME.conf "$BACKUP_DIR/nginx/" 2>/dev/null || \
cp /etc/nginx/sites-available/alenaproyoga.ru "$BACKUP_DIR/nginx/" 2>/dev/null || \
echo "⚠️ Файл конфига Nginx не найден в стандартных местах, проверьте вручную."
cp /etc/nginx/nginx.conf "$BACKUP_DIR/nginx/" 2>/dev/null || true
cp /etc/nginx/proxy_params "$BACKUP_DIR/nginx/" 2>/dev/null || true

echo "📁 Бэкап конфигурации Gunicorn (systemd)..."
cp /etc/systemd/system/gunicorn.service "$BACKUP_DIR/systemd/"

echo "📁 Бэкап SSL сертификатов Certbot..."
if [ -d "/etc/letsencrypt/live/alenaproyoga.ru" ]; then
    cp -r /etc/letsencrypt/live/alenaproyoga.ru "$BACKUP_DIR/certbot/"
    cp -r /etc/letsencrypt/archive/alenaproyoga.ru "$BACKUP_DIR/certbot/" 2>/dev/null || true
    # Копируем основные настройки letsencrypt
    cp /etc/letsencrypt/options-ssl-nginx.conf "$BACKUP_DIR/certbot/" 2>/dev/null || true
    cp /etc/letsencrypt/ssl-dhparams.pem "$BACKUP_DIR/certbot/" 2>/dev/null || true
else
    echo "⚠️ Директория с сертификатами не найдена."
fi

echo "📁 Бэкап переменных окружения (.env)..."
# Ищем .env в директории проекта
if [ -f "/home/$USER_NAME/$PROJECT_NAME/.env" ]; then
    cp /home/$USER_NAME/$PROJECT_NAME/.env "$BACKUP_DIR/env/"
else
    echo "⚠️ Файл .env не найден в /home/$USER_NAME/$PROJECT_NAME/"
fi

echo "📁 Создание списка установленных пакетов..."
pip freeze > "$BACKUP_DIR/requirements_frozen.txt" 2>/dev/null || true
dpkg --get-selections | grep -v deinstall > "$BACKUP_DIR/packages_list.txt" 2>/dev/null || true

echo "📦 Архивация бэкапа..."
tar -czf "${BACKUP_DIR}.tar.gz" "$BACKUP_DIR"
rm -rf "$BACKUP_DIR"

echo "✅ Бэкап успешно создан: ${BACKUP_DIR}.tar.gz"
echo "💡 Совет: Сохраните этот файл в надежное место (локально или в облако)."
echo "💡 Для восстановления используйте скрипт deploy_from_backup.sh"