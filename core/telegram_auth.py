"""
Модуль для аутентификации через Telegram

Использует Telegram Login Widget для проверки подлинности данных пользователя.
Документация: https://core.telegram.org/widgets/login#checking-authorization
"""

import hashlib
import hmac
from typing import Dict, Optional, Any


def check_telegram_signature(data: Dict[str, str], bot_token: str) -> bool:
    """
    Проверяет криптографическую подпись данных от Telegram
    
    Args:
        data: Словарь с данными от Telegram (id, first_name, username, auth_date, hash)
        bot_token: Токен вашего Telegram бота
        
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
    data_check_string = '\n'.join(f'{key}={value}' for key, value in sorted_data)
    
    # Создаем секретный ключ из токена бота
    secret_key = hmac.new(
        b'Sha256',
        bot_token.encode('utf-8'),
        hashlib.sha256
    ).digest()
    
    # Вычисляем хэш
    computed_hash = hmac.new(
        secret_key,
        data_check_string.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    # Сравниваем хэши
    return hmac.compare_digest(computed_hash, received_hash)


def is_auth_data_valid(auth_date: str, max_age: int = 86400) -> bool:
    """
    Проверяет, не устарели ли данные авторизации
    
    Args:
        auth_date: Timestamp авторизации от Telegram
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


def validate_telegram_auth_data(data: Dict[str, str], bot_token: str) -> Optional[Dict[str, Any]]:
    """
    Полная проверка данных авторизации от Telegram
    
    Args:
        data: Данные от Telegram виджета
        bot_token: Токен бота
        
    Returns:
        Словарь с проверенными данными пользователя или None если проверка не пройдена
    """
    if not bot_token:
        return None
    
    # Проверяем наличие обязательных полей
    required_fields = ['id', 'first_name', 'auth_date', 'hash']
    for field in required_fields:
        if field not in data:
            return None
    
    # Проверяем подпись
    if not check_telegram_signature(data, bot_token):
        return None
    
    # Проверяем актуальность данных
    if not is_auth_data_valid(data.get('auth_date', '0')):
        return None
    
    # Возвращаем проверенные данные
    return {
        'telegram_id': int(data['id']),
        'first_name': data.get('first_name', ''),
        'last_name': data.get('last_name', ''),
        'username': data.get('username', ''),
        'photo_url': data.get('photo_url', ''),
    }
