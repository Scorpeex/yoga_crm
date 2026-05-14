"""
Скрипт для наполнения базы данных тестовыми данными
Запуск: python manage.py shell < core/management/commands/seed_data.py
Или: python manage.py seed_data (если создать как management command)
"""

from django.utils import timezone
from datetime import timedelta, datetime
from decimal import Decimal
from core.models import Tariff, ClassType, User, Hall, ClassSession, Booking, PaymentTransaction, Subscription


def create_tariffs():
    """Создание тарифов"""
    print("Создание тарифов...")
    
    # Групповой тариф с абонементом
    group_tariff, _ = Tariff.objects.get_or_create(
        name="Групповое занятие",
        defaults={
            'tariff_type': 'group',
            'price_per_person': Decimal('500.00'),
            'max_participants': 10,
            'description': 'Стандартное групповое занятие до 10 человек',
            'is_subscription_available': True,
            'subscription_sessions_count': 8,
            'subscription_price': Decimal('9000.00'),  # 8 * 1125 = 9000
            'subscription_validity_days': 45  # 1.5 месяца
        }
    )
    
    # Индивидуальный тариф (без абонемента)
    individual_tariff, _ = Tariff.objects.get_or_create(
        name="Индивидуальное занятие",
        defaults={
            'tariff_type': 'individual',
            'price_per_person': Decimal('1500.00'),
            'max_participants': 1,
            'description': 'Персональное занятие с тренером',
            'is_subscription_available': False
        }
    )
    
    # Сплит тариф (без абонемента)
    split_tariff, _ = Tariff.objects.get_or_create(
        name="Сплит (до 2 человек)",
        defaults={
            'tariff_type': 'split',
            'price_per_person': Decimal('800.00'),
            'price_full_split': Decimal('1600.00'),
            'max_participants': 2,
            'description': 'Занятие для пары. Если приходит один - платит полную стоимость.',
            'is_subscription_available': False
        }
    )
    
    return {
        'group': group_tariff,
        'individual': individual_tariff,
        'split': split_tariff
    }


def create_class_types(tariffs):
    """Создание типов занятий"""
    print("Создание типов занятий...")
    
    yoga, _ = ClassType.objects.get_or_create(
        name="Йога",
        defaults={
            'description': 'Классическая йога для всех уровней',
            'duration_minutes': 60,
            'default_tariff': tariffs['group']
        }
    )
    
    pilates, _ = ClassType.objects.get_or_create(
        name="Пилатес",
        defaults={
            'description': 'Упражнения для укрепления мышц кора',
            'duration_minutes': 60,
            'default_tariff': tariffs['group']
        }
    )
    
    stretching, _ = ClassType.objects.get_or_create(
        name="Стретчинг",
        defaults={
            'description': 'Растяжка для гибкости',
            'duration_minutes': 45,
            'default_tariff': tariffs['group']
        }
    )
    
    personal_training, _ = ClassType.objects.get_or_create(
        name="Персональная тренировка",
        defaults={
            'description': 'Индивидуальная работа с тренером',
            'duration_minutes': 60,
            'default_tariff': tariffs['individual']
        }
    )
    
    duo_training, _ = ClassType.objects.get_or_create(
        name="Парная тренировка",
        defaults={
            'description': 'Тренировка для двоих',
            'duration_minutes': 60,
            'default_tariff': tariffs['split']
        }
    )
    
    return {
        'yoga': yoga,
        'pilates': pilates,
        'stretching': stretching,
        'personal': personal_training,
        'duo': duo_training
    }


def create_halls():
    """Создание залов"""
    print("Создание залов...")
    
    hall1, _ = Hall.objects.get_or_create(
        name="Зал №1 (Основной)",
        defaults={
            'address': 'ул. Ленина, 10',
            'price_per_hour': Decimal('1000.00'),
            'color': '#4ECDC4'
        }
    )
    
    hall2, _ = Hall.objects.get_or_create(
        name="Зал №2 (Малый)",
        defaults={
            'address': 'ул. Ленина, 10',
            'price_per_hour': Decimal('700.00'),
            'color': '#FF6B6B'
        }
    )
    
    hall3, _ = Hall.objects.get_or_create(
        name="VIP Зал",
        defaults={
            'address': 'пр. Мира, 25',
            'price_per_hour': Decimal('2000.00'),
            'color': '#BB8FCE'
        }
    )
    
    return {'main': hall1, 'small': hall2, 'vip': hall3}


def create_users(tariffs):
    """Создание пользователей"""
    print("Создание пользователей...")
    
    # Администратор
    admin, _ = User.objects.get_or_create(
        username='admin',
        defaults={
            'email': 'admin@studio.com',
            'first_name': 'Админ',
            'last_name': 'Истраторов',
            'role': 'admin',
            'is_staff': True,
            'is_superuser': True,
            'balance': Decimal('0.00')
        }
    )
    admin.set_password('admin123')
    admin.save()
    
    # Модератор
    moderator, _ = User.objects.get_or_create(
        username='moderator',
        defaults={
            'email': 'mod@studio.com',
            'first_name': 'Модер',
            'last_name': 'Модеров',
            'role': 'moderator',
            'is_staff': True,
            'balance': Decimal('0.00')
        }
    )
    moderator.set_password('mod123')
    moderator.save()
    
    # Ученик 1 - доступен только групповой тариф, с абонементом
    student1, _ = User.objects.get_or_create(
        username='student1',
        defaults={
            'email': 'student1@example.com',
            'first_name': 'Анна',
            'last_name': 'Петрова',
            'role': 'student',
            'phone': '+7-900-111-22-33',
            'balance': Decimal('12000.00')  # Достаточно для абонемента (9000) + немного на остаток
        }
    )
    student1.allowed_tariffs.add(tariffs['group'])
    student1.set_password('stud123')
    student1.save()
    
    # Ученик 2 - доступны групповой и сплит, без абонемента
    student2, _ = User.objects.get_or_create(
        username='student2',
        defaults={
            'email': 'student2@example.com',
            'first_name': 'Иван',
            'last_name': 'Сидоров',
            'role': 'student',
            'phone': '+7-900-444-55-66',
            'balance': Decimal('5000.00')
        }
    )
    student2.allowed_tariffs.add(tariffs['group'], tariffs['split'])
    student2.set_password('stud123')
    student2.save()
    
    # Ученик 3 - все тарифы (VIP клиент), с абонементом
    student3, _ = User.objects.get_or_create(
        username='student3',
        defaults={
            'email': 'student3@example.com',
            'first_name': 'Ольга',
            'last_name': 'Смирнова',
            'role': 'student',
            'phone': '+7-900-777-88-99',
            'balance': Decimal('15000.00')  # Достаточно для абонемента и других занятий
        }
    )
    student3.allowed_tariffs.add(tariffs['group'], tariffs['split'], tariffs['individual'])
    student3.set_password('stud123')
    student3.save()
    
    # Ученик 4 - для теста сплита
    student4, _ = User.objects.get_or_create(
        username='student4',
        defaults={
            'email': 'student4@example.com',
            'first_name': 'Дмитрий',
            'last_name': 'Козлов',
            'role': 'student',
            'phone': '+7-900-123-45-67',
            'balance': Decimal('2000.00')
        }
    )
    student4.allowed_tariffs.add(tariffs['split'])
    student4.set_password('stud123')
    student4.save()
    
    return {
        'admin': admin,
        'moderator': moderator,
        'student1': student1,
        'student2': student2,
        'student3': student3,
        'student4': student4
    }


def create_sessions(class_types, halls, tariffs):
    """Создание занятий на ближайшую неделю"""
    print("Создание занятий...")
    
    now = timezone.now()
    sessions = {}
    
    # Групповые занятия по йоге (завтра в 10:00, 14:00, 18:00)
    for i, hour in enumerate([10, 14, 18]):
        session_date = now.replace(hour=hour, minute=0, second=0, microsecond=0) + timedelta(days=1)
        session, _ = ClassSession.objects.get_or_create(
            class_type=class_types['yoga'],
            date_time=session_date,
            defaults={
                'tariff': tariffs['group'],
                'duration': 60,
                'hall': halls['main']
            }
        )
        sessions[f'yoga_{i}'] = session
    
    # Пилатес (послезавтра в 12:00)
    pilates_date = now.replace(hour=12, minute=0, second=0, microsecond=0) + timedelta(days=2)
    pilates_session, _ = ClassSession.objects.get_or_create(
        class_type=class_types['pilates'],
        date_time=pilates_date,
        defaults={
            'tariff': tariffs['group'],
            'duration': 60,
            'hall': halls['small']
        }
    )
    sessions['pilates_1'] = pilates_session
    
    # Стретчинг (через 3 дня в 19:00)
    stretch_date = now.replace(hour=19, minute=0, second=0, microsecond=0) + timedelta(days=3)
    stretch_session, _ = ClassSession.objects.get_or_create(
        class_type=class_types['stretching'],
        date_time=stretch_date,
        defaults={
            'tariff': tariffs['group'],
            'duration': 45,
            'hall': halls['main']
        }
    )
    sessions['stretching_1'] = stretch_session
    
    # Персональная тренировка (завтра в 16:00)
    personal_date = now.replace(hour=16, minute=0, second=0, microsecond=0) + timedelta(days=1)
    personal_session, _ = ClassSession.objects.get_or_create(
        class_type=class_types['personal'],
        date_time=personal_date,
        defaults={
            'tariff': tariffs['individual'],
            'duration': 60,
            'hall': halls['vip']
        }
    )
    sessions['personal_1'] = personal_session
    
    # Сплит тренировка (послезавтра в 18:00)
    duo_date = now.replace(hour=18, minute=0, second=0, microsecond=0) + timedelta(days=2)
    duo_session, _ = ClassSession.objects.get_or_create(
        class_type=class_types['duo'],
        date_time=duo_date,
        defaults={
            'tariff': tariffs['split'],
            'duration': 60,
            'hall': halls['small']
        }
    )
    sessions['duo_1'] = duo_session
    
    # Еще одно занятие через 5 часов (для теста списания)
    soon_session_date = now + timedelta(hours=5)
    soon_session, _ = ClassSession.objects.get_or_create(
        class_type=class_types['yoga'],
        date_time=soon_session_date,
        defaults={
            'tariff': tariffs['group'],
            'duration': 60,
            'hall': halls['main']
        }
    )
    sessions['yoga_soon'] = soon_session
    
    return sessions


def create_bookings(sessions, users):
    """Создание записей на занятия"""
    print("Создание записей...")
    
    # Student1 записывается на йогу завтра в 10:00
    booking1, _ = Booking.objects.get_or_create(
        session=sessions['yoga_0'],
        client=users['student1'],
        defaults={
            'status': 'pending',
            'amount_paid': sessions['yoga_0'].get_current_price()
        }
    )
    
    # Student2 записывается на йогу завтра в 10:00
    booking2, _ = Booking.objects.get_or_create(
        session=sessions['yoga_0'],
        client=users['student2'],
        defaults={
            'status': 'pending',
            'amount_paid': sessions['yoga_0'].get_current_price()
        }
    )
    
    # Student3 записывается на персональную тренировку
    booking3, _ = Booking.objects.get_or_create(
        session=sessions['personal_1'],
        client=users['student3'],
        defaults={
            'status': 'confirmed',
            'amount_paid': sessions['personal_1'].get_current_price()
        }
    )
    # Оплачиваем персональную тренировку
    booking3.status = 'paid'
    booking3.paid_at = timezone.now()
    booking3.save()
    
    # Student2 и Student4 записываются на сплит
    booking4, _ = Booking.objects.get_or_create(
        session=sessions['duo_1'],
        client=users['student2'],
        defaults={
            'status': 'pending',
            'amount_paid': sessions['duo_1'].get_current_price()
        }
    )
    
    booking5, _ = Booking.objects.get_or_create(
        session=sessions['duo_1'],
        client=users['student4'],
        defaults={
            'status': 'pending',
            'amount_paid': sessions['duo_1'].get_current_price()
        }
    )
    
    # Student3 записывается на занятие через 5 часов (для теста списания)
    booking6, _ = Booking.objects.get_or_create(
        session=sessions['yoga_soon'],
        client=users['student3'],
        defaults={
            'status': 'confirmed',
            'amount_paid': sessions['yoga_soon'].get_current_price()
        }
    )
    
    return {
        'booking1': booking1,
        'booking2': booking2,
        'booking3': booking3,
        'booking4': booking4,
        'booking5': booking5,
        'booking6': booking6
    }


def run_seed():
    """Основная функция наполнения"""
    print("=" * 50)
    print("Наполнение базы данных тестовыми данными")
    print("=" * 50)
    
    # Создаем тарифы
    tariffs = create_tariffs()
    print(f"✓ Создано тарифов: {len(tariffs)}")
    
    # Создаем типы занятий
    class_types = create_class_types(tariffs)
    print(f"✓ Создано типов занятий: {len(class_types)}")
    
    # Создаем залы
    halls = create_halls()
    print(f"✓ Создано залов: {len(halls)}")
    
    # Создаем пользователей
    users = create_users(tariffs)
    print(f"✓ Создано пользователей: {len(users)}")
    
    # Покупаем абонементы для student1 и student3
    from core.services import PaymentService
    
    if tariffs['group'].is_subscription_available:
        try:
            sub1 = PaymentService.purchase_subscription(users['student1'], tariffs['group'], "Тестовый абонемент для Анны")
            print(f"✓ Куплен абонемент для {users['student1']}: {sub1.sessions_remaining} занятий")
            
            sub3 = PaymentService.purchase_subscription(users['student3'], tariffs['group'], "Тестовый абонемент для Ольги")
            print(f"✓ Куплен абонемент для {users['student3']}: {sub3.sessions_remaining} занятий")
        except Exception as e:
            print(f"⚠ Ошибка при покупке абонемента: {e}")
    
    # Создаем занятия
    sessions = create_sessions(class_types, halls, tariffs)
    print(f"✓ Создано занятий: {len(sessions)}")
    
    # Создаем записи
    bookings = create_bookings(sessions, users)
    print(f"✓ Создано записей: {len(bookings)}")
    
    print("=" * 50)
    print("Готово! Тестовые данные успешно созданы.")
    print("=" * 50)
    print("\nУчетные данные для входа:")
    print("  Admin: admin / admin123")
    print("  Moderator: moderator / mod123")
    print("  Students: student1-4 / stud123")
    print("\nАбонементы:")
    print("  - Групповой тариф: 8 занятий за 9000 руб., срок действия 45 дней")
    print("  - Доступен для тарифа 'Групповое занятие'")
    print("=" * 50)


if __name__ == '__main__':
    run_seed()
