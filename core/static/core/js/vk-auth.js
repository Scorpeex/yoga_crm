/**
 * VK ID Widget integration (SDK 3.0+)
 * Handles VK authentication using new OAuth flow with code exchange
 */

(function() {
    'use strict';

    // Получаем конфигурацию из Django settings через data-атрибуты
    const getVkConfig = function() {
        const container = document.getElementById('vk-login-container');
        if (!container) return null;
        
        const appId = container.getAttribute('data-vk-app-id');
        const redirectUrl = container.getAttribute('data-vk-redirect-url') || window.location.origin + '/api/auth/vk/';
        
        if (!appId) {
            console.error('VK App ID не настроен в Django settings');
            return null;
        }
        
        return {
            appId: appId,
            redirectUrl: redirectUrl
        };
    };

    // Инициализация виджета VK ID
    const initVKWidget = function() {
        const container = document.getElementById('vk-login-container');
        if (!container) return;

        // Получаем конфигурацию
        const vkConfig = getVkConfig();
        if (!vkConfig) {
            createErrorButton(container, 'VK авторизация не настроена');
            return;
        }

        // Очищаем контейнер
        container.innerHTML = '';

        // Создаем скрипт VK SDK
        const script = document.createElement('script');
        script.async = true;
        script.src = 'https://unpkg.com/@vkid/sdk@3/dist-sdk/umd/index.js';
        
        script.onload = function() {
            if (!('VKIDSDK' in window)) {
                console.error('VK SDK не загрузился');
                createErrorButton(container, 'Не удалось загрузить VK SDK');
                return;
            }

            const VKID = window.VKIDSDK;

            try {
                // Инициализируем конфиг
                VKID.Config.init({
                    app: vkConfig.appId,
                    redirectUrl: vkConfig.redirectUrl,
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
                createErrorButton(container, 'Ошибка инициализации VK ID');
            }
        };

        script.onerror = function() {
            console.error('Не удалось загрузить VK SDK');
            createErrorButton(container, 'Не удалось загрузить VK SDK');
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

    // Кнопка с ошибкой если конфигурация не настроена или SDK не загрузился
    const createErrorButton = function(container, errorMessage) {
        container.innerHTML = `
            <div style="display: inline-block; padding: 10px 20px; background: #f44336; color: white; 
                         border-radius: 8px; font-weight: 500; cursor: not-allowed;">
                ${errorMessage}
            </div>
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
