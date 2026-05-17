/**
 * Telegram Login Widget integration
 * Handles Telegram authentication and user data processing
 */

(function() {
    'use strict';

    // Инициализация виджета Telegram
    const initTelegramWidget = function() {
        const container = document.getElementById('telegram-login-container');
        if (!container) return;

        // Создаем скрипт виджета Telegram
        const script = document.createElement('script');
        script.async = true;
        script.src = 'https://telegram.org/js/telegram-widget.js?22';
        script.setAttribute('data-telegram-login', 'alena_pro_yoga_bot'); // ЗАМЕНИТЕ на username вашего бота
        script.setAttribute('data-size', 'large');
        script.setAttribute('data-radius', '8');
        script.setAttribute('data-request-access', 'write');
        script.setAttribute('data-userpic', 'false');
        script.setAttribute('data-onauth', 'onTelegramAuth(user)');

        // Функция обработки успешной авторизации
        window.onTelegramAuth = function(user) {
            // Отправляем данные на сервер для проверки и входа
            fetch('/api/auth/telegram/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-CSRFToken': getCookie('csrftoken')
                },
                body: new URLSearchParams({
                    'id': user.id,
                    'first_name': user.first_name,
                    'last_name': user.last_name || '',
                    'username': user.username || '',
                    'photo_url': user.photo_url || '',
                    'auth_date': user.auth_date,
                    'hash': user.hash
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Перенаправляем пользователя в личный кабинет
                    window.location.href = data.redirect_url || '/profile/';
                } else {
                    alert('Ошибка авторизации: ' + (data.error || 'Неизвестная ошибка'));
                }
            })
            .catch(error => {
                console.error('Error:', error);
                alert('Произошла ошибка при авторизации. Попробуйте ещё раз.');
            });
        };

        // Вставляем скрипт в контейнер
        container.appendChild(script);
    };

    // Функция для получения CSRF токена
    const getCookie = function(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    };

    // Экспорт функций для использования в других скриптах
    window.TelegramAuthUtils = {
        initTelegramWidget: initTelegramWidget,
        getCookie: getCookie
    };

    // Автоматическая инициализация при загрузке DOM
    document.addEventListener('DOMContentLoaded', function() {
        initTelegramWidget();
    });
})();
