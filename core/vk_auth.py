"""
Модуль для аутентификации через ВКонтакте

Использует VK ID для проверки подлинности данных пользователя.
Документация: https://dev.vk.com/widgets
"""

import hashlib
import hmac
from typing import Dict, Optional, Any


def check_vk_signature(data: Dict[str, str], client_secret: str) -> bool:
    """
    Проверяет криптографическую подпись данных от VK
    
    Args:
        data: Словарь с данными от VK (id, first_name, last_name, photo_url, auth_date, hash)
        client_secret: Секретный ключ вашего VK приложения
        
    Returns:
        True если подпись валидна, False иначе
    """
    # Извлекаем хэш из данных
    received_hash = data.get('hash')
    if not received_hash:
        return False
    
    # Создаем копию данных без хэша для проверки
    data_without_hash = {k: v for k, v in data.items() if k != 'hash'}
    
    # Сортируем ключи и создаем строку для хэширования
    sorted_data = sorted(data_without_hash.items())
    data_check_string = '_'.join(f'{key}={value}' for key, value in sorted_data)
    
    # Вычисляем хэш используя секретный ключ приложения
    computed_hash = hmac.new(
        client_secret.encode('utf-8'),
        data_check_string.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    # Сравниваем хэши
    return hmac.compare_digest(computed_hash, received_hash)


def is_auth_data_valid(auth_date: str, max_age: int = 86400) -> bool:
    """
    Проверяет, не устарели ли данные авторизации
    
    Args:
        auth_date: Timestamp авторизации от VK
        max_age: Максимальный возраст данных в секундах (по умолчанию 24 часа)
        
    Returns:
        True если данные актуальны, False иначе
    """
    import time
    try:
        auth_time = int(auth_date)
        current_time = int(time.time())
        return (current_time - auth_time) <= max_age
    except (ValueError, TypeError):
        return False


def validate_vk_auth_data(data: Dict[str, str], client_secret: str) -> Optional[Dict[str, Any]]:
    """
    Полная проверка данных авторизации от VK
    
    Args:
        data: Данные от VK виджета
        client_secret: Секретный ключ приложения
        
    Returns:
        Словарь с проверенными данными пользователя или None если проверка не пройдена
    """
    if not client_secret:
        return None
    
    # Проверяем наличие обязательных полей
    required_fields = ['id', 'first_name', 'auth_date', 'hash']
    for field in required_fields:
        if field not in data:
            return None
    
    # Проверяем подпись
    if not check_vk_signature(data, client_secret):
        return None
    
    # Проверяем актуальность данных
    if not is_auth_data_valid(data.get('auth_date', '0')):
        return None
    
    # Возвращаем проверенные данные
    return {
        'vk_id': int(data['id']),
        'first_name': data.get('first_name', ''),
        'last_name': data.get('last_name', ''),
        'photo_url': data.get('photo_url', ''),
    }
