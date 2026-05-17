/**
 * VK ID Widget integration
 * Handles VK authentication and user data processing
 */

(function() {
    'use strict';

    // Инициализация виджета VK ID
    const initVKWidget = function() {
        const container = document.getElementById('vk-login-container');
        if (!container) return;

        // Создаем скрипт виджета VK ID
        const script = document.createElement('script');
        script.async = true;
        script.src = 'https://vk.com/js/api/vd.js';
        
        // Функция обработки успешной авторизации
        window.VKIDOnAuthSuccess = function(data) {
            // Отправляем данные на сервер для проверки и входа
            fetch('/api/auth/vk/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-CSRFToken': getCookie('csrftoken')
                },
                body: new URLSearchParams({
                    'id': data.user.id,
                    'first_name': data.user.first_name || '',
                    'last_name': data.user.last_name || '',
                    'photo_url': data.user.photo_url || '',
                    'auth_date': Math.floor(Date.now() / 1000).toString(),
                    'hash': data.sign || ''
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

        // Вставляем скрипт в контейнер после загрузки
        script.onload = function() {
            // Инициализируем VK ID виджет
            if (window.VKID) {
                try {
                    const vkIdInstance = new window.VKID({
                        app: 0, // ЗАМЕНИТЕ на ID вашего VK приложения
                        container: 'vk-login-container',
                        onAuthSuccess: window.VKIDOnAuthSuccess,
                        buttonSize: 'large',
                        buttonTheme: 'light'
                    });
                } catch (e) {
                    console.error('Ошибка инициализации VK ID:', e);
                    // Fallback: создаем кнопку вручную
                    createFallbackButton(container);
                }
            } else {
                // Fallback: создаем кнопку вручную
                createFallbackButton(container);
            }
        };

        container.appendChild(script);
    };

    // Fallback кнопка если SDK не загрузился
    const createFallbackButton = function(container) {
        container.innerHTML = `
            <a href="https://vk.com/id" target="_blank" 
               style="display: inline-block; padding: 10px 20px; background: #0077FF; color: white; 
                      text-decoration: none; border-radius: 8px; font-weight: 500;">
                Войти через ВКонтакте
            </a>
        `;
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
    window.VKAuthUtils = {
        initVKWidget: initVKWidget,
        getCookie: getCookie
    };

    // Автоматическая инициализация при загрузке DOM
    document.addEventListener('DOMContentLoaded', function() {
        initVKWidget();
    });
})();
