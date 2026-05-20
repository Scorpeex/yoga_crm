/**
 * VK ID Widget integration (SDK 3.0+)
 * Handles VK authentication using new OAuth flow with code exchange
 */

(function() {
    'use strict';

    // Конфигурация VK ID
    const VK_CONFIG = {
        appId: 54601779, // ЗАМЕНИТЕ на ID вашего VK приложения
        redirectUrl: window.location.origin + '/api/auth/vk/',
    };

    // Инициализация виджета VK ID
    const initVKWidget = function() {
        const container = document.getElementById('vk-login-container');
        if (!container) return;

        // Очищаем контейнер
        container.innerHTML = '';

        // Создаем скрипт VK SDK
        const script = document.createElement('script');
        script.async = true;
        script.src = 'https://unpkg.com/@vkid/sdk@3/dist-sdk/umd/index.js';
        
        script.onload = function() {
            if (!('VKIDSDK' in window)) {
                console.error('VK SDK не загрузился');
                createFallbackButton(container);
                return;
            }

            const VKID = window.VKIDSDK;

            try {
                // Инициализируем конфиг
                VKID.Config.init({
                    app: VK_CONFIG.appId,
                    redirectUrl: VK_CONFIG.redirectUrl,
                    responseMode: VKID.ConfigResponseMode.Callback,
                    source: VKID.ConfigSource.LOWCODE,
                    scope: '', // Можно добавить нужные права доступа
                });

                // Создаем экземпляр OneTap
                const oneTap = new VKID.OneTap();

                // Рендерим виджет
                oneTap.render({
                    container: container,
                    showAlternativeLogin: true
                })
                .on(VKID.WidgetEvents.ERROR, vkidOnError)
                .on(VKID.OneTapInternalEvents.LOGIN_SUCCESS, function (payload) {
                    const code = payload.code;
                    const deviceId = payload.device_id;

                    // Обмениваем code на токен и получаем данные пользователя
                    VKID.Auth.exchangeCode(code, deviceId)
                        .then(function(data) {
                            vkidOnSuccess(data);
                        })
                        .catch(vkidOnError);
                });

            } catch (e) {
                console.error('Ошибка инициализации VK ID:', e);
                createFallbackButton(container);
            }
        };

        script.onerror = function() {
            console.error('Не удалось загрузить VK SDK');
            createFallbackButton(container);
        };

        container.appendChild(script);
    };

    // Обработка успешной авторизации
    const vkidOnSuccess = function(data) {
        // Данные содержат access_token и user info
        // Отправляем access_token на сервер для получения данных пользователя
        fetch('/api/auth/vk/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({
                'access_token': data.access_token,
                'user_id': data.user_id,
                'email': data.email || '',
                'first_name': data.first_name || '',
                'last_name': data.last_name || '',
                'photo_url': data.photo_url || ''
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

    // Обработка ошибки
    const vkidOnError = function(error) {
        console.error('VK ID Error:', error);
        alert('Ошибка авторизации ВКонтакте. Попробуйте ещё раз.');
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
