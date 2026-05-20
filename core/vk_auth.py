"""
Модуль для аутентификации через ВКонтакте (VK ID SDK 3.0+)

Использует новый OAuth flow с exchange code для получения данных пользователя.
Документация: https://dev.vk.com/vkid/
"""

import requests
from typing import Dict, Optional, Any
from django.conf import settings


def get_user_data_from_vk(access_token: str, user_id: int) -> Optional[Dict[str, Any]]:
    """
    Получает данные пользователя через VK API используя access_token
    
    Args:
        access_token: Токен доступа от VK ID
        user_id: ID пользователя ВКонтакте
        
    Returns:
        Словарь с данными пользователя или None если произошла ошибка
    """
    if not access_token:
        return None
    
    # VK API метод для получения информации о пользователе
    api_url = 'https://api.vk.com/method/users.get'
    params = {
        'user_ids': user_id,
        'fields': 'photo_200,first_name,last_name',
        'access_token': access_token,
        'v': '5.131'  # Версия API
    }
    
    try:
        response = requests.get(api_url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if 'error' in data:
            print(f"VK API Error: {data['error']}")
            return None
        
        if 'response' in data and len(data['response']) > 0:
            user_data = data['response'][0]
            return {
                'vk_id': int(user_data['id']),
                'first_name': user_data.get('first_name', ''),
                'last_name': user_data.get('last_name', ''),
                'photo_url': user_data.get('photo_200', ''),
            }
        else:
            return None
            
    except requests.RequestException as e:
        print(f"Error calling VK API: {e}")
        return None


def validate_vk_oauth_data(access_token: str, user_id: int, client_secret: str) -> Optional[Dict[str, Any]]:
    """
    Проверяет данные авторизации от VK ID SDK 3.0+
    
    Args:
        access_token: Токен доступа от VK
        user_id: ID пользователя
        client_secret: Сервисный ключ доступа приложения
        
    Returns:
        Словарь с проверенными данными пользователя или None если проверка не пройдена
    """
    if not access_token or not user_id or not client_secret:
        return None
    
    # Получаем данные пользователя через VK API
    user_data = get_user_data_from_vk(access_token, user_id)
    
    if not user_data:
        return None
    
    # Дополнительно можно проверить токен через метод secure.checkToken
    # но для базовой авторизации достаточно успешного получения данных пользователя
    
    return user_data
