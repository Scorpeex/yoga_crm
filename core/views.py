import json
import re
import os
from django.shortcuts import render, get_object_or_404, redirect
from django.http import JsonResponse, HttpResponse
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth import login, logout, authenticate
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.db import transaction
from decimal import Decimal
from datetime import datetime, timedelta
from django.utils import timezone
import pytz
from django.conf import settings
from .auth_backend import normalize_phone
from .models import ClassSession, Hall, ClassType, User, Attendance, UserDefaultSettings, Tariff, Booking, Subscription, News, InAppNotification, PaymentTransaction
from .services import PaymentService
from .yookassa_service import create_payment, handle_callback as yookassa_handle_callback, log_msg
from .forms import RegistrationForm, LoginForm, NewsForm
from .telegram_auth import validate_telegram_auth_data
from .vk_auth import validate_vk_oauth_data, exchange_silent_token, get_user_phone_from_vk, get_masked_user_info_from_vk
from .vk_bot import handle_callback, send_vk_message
from django.db.models import Q


def _validate_avatar(upload):
    """Проверка загружаемого аватара. Возвращает строку ошибки или None."""
    max_size = getattr(settings, 'AVATAR_MAX_SIZE', 5 * 1024 * 1024)
    min_dim = getattr(settings, 'AVATAR_MIN_DIMENSION', 100)

    if upload.size > max_size:
        return f'Размер файла не должен превышать {max_size // (1024 * 1024)} МБ'

    try:
        from PIL import Image
        image = Image.open(upload)
        image.verify()
        upload.seek(0)
        image = Image.open(upload)
        width, height = image.size
    except Exception:
        return 'Загрузите файл изображения (JPG, PNG, WEBP, GIF)'

    if width < min_dim or height < min_dim:
        return f'Изображение слишком маленькое — минимум {min_dim}×{min_dim} px'

    return None


def parse_datetime_to_local(start_str):
    """Конвертирует дату из FullCalendar (может быть в UTC или с timezone) в локальное naive datetime"""
    if not start_str:
        return None
    
    try:
        # Парсим строку с помощью fromisoformat (поддерживает форматы с timezone)
        dt = datetime.fromisoformat(start_str)
        
        # Если дата timezone-aware, конвертируем в локальную зону и убираем tzinfo
        if dt.tzinfo is not None:
            novosibirsk_tz = pytz.timezone('Asia/Novosibirsk')
            # Конвертируем в целевую часовую зону
            local_dt = dt.astimezone(novosibirsk_tz)
            # Возвращаем naive datetime (без tzinfo) для SQLite
            return local_dt.replace(tzinfo=None)
        else:
            # Это уже naive datetime, используем как есть
            return dt
    except (ValueError, TypeError) as e:
        print(f"Ошибка парсинга даты {start_str}: {e}")
        return None


@login_required
def calendar_view(request):
    """Отображение календаря занятий"""
    halls = Hall.objects.all()
    class_types = ClassType.objects.all()
    tariffs = Tariff.objects.filter(is_active=True)
    
    # Проверяем права пользователя
    is_moderator = False
    is_admin = False
    
    if request.user.is_authenticated:
        # Проверяем суперадмина Django
        if request.user.is_superuser:
            is_admin = True
        # Проверяем профиль клиента через роль
        elif hasattr(request.user, 'role'):
            is_moderator = request.user.role in ['moderator', 'admin']
            is_admin = request.user.role == 'admin'
    
    user_display_name = ''
    if request.user.is_authenticated:
        if is_admin or is_moderator:
            user_display_name = f"{request.user.last_name} {request.user.first_name}".strip()
        else:
            user_display_name = request.user.first_name or request.user.username

    return render(request, 'core/calendar.html', {
        'halls': halls,
        'class_types': class_types,
        'tariffs': tariffs,
        'is_moderator': is_moderator,
        'is_admin': is_admin,
        'user_role': 'admin' if is_admin else ('moderator' if is_moderator else 'student'),
        'user_display_name': user_display_name,
    })


@login_required
def get_events(request):
    """Получение событий для календаря (JSON)"""
    # Пассивный триггер: обрабатываем сплит-платежи с наступившим дедлайном
    from core.services import PaymentService
    try:
        PaymentService.process_split_sessions()
    except Exception:
        pass  # Ошибки не блокируют загрузку календаря

    # Получаем параметры периода от FullCalendar
    start_param = request.GET.get('start')
    end_param = request.GET.get('end')
    
    if start_param and end_param:
        # Используем параметры от FullCalendar (ISO формат даты)
        try:
            # Конвертируем из UTC в локальное время для корректного фильтра
            start_date = parse_datetime_to_local(start_param)
            end_date = parse_datetime_to_local(end_param)
            if not start_date or not end_date:
                raise ValueError("Неверный формат даты")
        except (ValueError, TypeError):
            # Fallback на текущий месяц при ошибке парсинга
            now = datetime.now()
            start_date = datetime(now.year, now.month, 1)
            if now.month == 12:
                end_date = datetime(now.year + 1, 1, 1) - timedelta(days=1)
            else:
                end_date = datetime(now.year, now.month + 1, 1) - timedelta(days=1)
    else:
        # Fallback на параметры year/month если start/end не переданы
        year = request.GET.get('year', datetime.now().year)
        month = request.GET.get('month', datetime.now().month)
        
        try:
            year = int(year)
            month = int(month)
        except (ValueError, TypeError):
            year = datetime.now().year
            month = datetime.now().month
        
        # Первый и последний день месяца
        start_date = datetime(year, month, 1)
        if month == 12:
            end_date = datetime(year + 1, 1, 1) - timedelta(days=1)
        else:
            end_date = datetime(year, month + 1, 1) - timedelta(days=1)
    
    # Базовый запрос
    sessions = ClassSession.objects.filter(
        date_time__gte=start_date,
        date_time__lte=end_date.replace(hour=23, minute=59, second=59)
    ).select_related('hall', 'class_type', 'tariff')
    
    # Определяем доступные тарифы для обычных пользователей
    # Все занятия показываем, но для недоступных тарифов ставим is_allowed=false
    allowed_tariff_ids = None  # None = все тарифы доступны
    if request.user.is_authenticated and not request.user.is_moderator:
        allowed_tariff_ids = list(request.user.allowed_tariffs.values_list('id', flat=True))
    
    events = []
    
    for session in sessions:
        # Время хранится как локальное (без timezone info), используем его напрямую
        local_dt = session.date_time
        
        # Получаем max_participants с учетом переопределения
        max_participants = session.get_max_participants()
        
        # Определяем доступность тарифа для пользователя (с учётом групп тарифов)
        if allowed_tariff_ids is None:
            is_allowed = True
        else:
            allowed_set = set(allowed_tariff_ids)
            is_allowed = bool(set(PaymentService.effective_tariff_ids(session.tariff)) & allowed_set)
        
        events.append({
            'id': str(session.id),
            'title': f"{session.class_type.name}",
            'start': local_dt.strftime('%Y-%m-%dT%H:%M:%S'),
            'end': (local_dt + timedelta(minutes=session.duration)).strftime('%Y-%m-%dT%H:%M:%S'),
            'allDay': False,
            'backgroundColor': session.hall.color if session.hall else '#4ECDC4',
            'borderColor': session.hall.color if session.hall else '#4ECDC4',
            'textColor': session.hall.get_effective_text_color() if session.hall else '#FFFFFF',
            'extendedProps': {
                'hall_id': session.hall.id if session.hall else None,
                'hall_name': session.hall.name if session.hall else '',
                'duration': session.duration,
                'max_participants': max_participants,
                'tariff_id': session.tariff.id if session.tariff else None,
                'price': float(session.get_current_price()),
                'subscription_price': float(session.tariff.subscription_price) if session.tariff else None,
                'max_participants_override': session.max_participants_override,
                'description': session.class_type.description if session.class_type.description else '',
                'is_recurring': session.is_recurring,
                'recurrence_id': session.recurrence_id or '',
                'is_allowed': is_allowed,
            }
        })
    
    return JsonResponse(events, safe=False)


@require_http_methods(["POST"])
def create_event(request):
    """Создание нового занятия (только для модераторов и админов)"""
    # Проверка прав доступа
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Доступ запрещен'}, status=403)
    
    # Проверяем суперадмина Django или администратора/модератора через профиль
    is_authorized = False
    if request.user.is_superuser or request.user.is_staff:
        is_authorized = True
    elif hasattr(request.user, 'role') and request.user.role in ['moderator', 'admin']:
        is_authorized = True
    
    if not is_authorized:
        return JsonResponse({'error': 'Доступ запрещен. Только модераторы и администраторы могут создавать занятия'}, status=403)
    
    try:
        data = json.loads(request.body)
        class_type_id = data.get('class_type_id')
        start = data.get('start')
        hall_id = data.get('hall_id')
        duration = data.get('duration')
        tariff_id = data.get('tariff_id')
        max_participants_override = data.get('max_participants_override')
        is_recurring = data.get('is_recurring', False)
        recurring_count = data.get('recurring_count', 4)
        
        if not start:
            return JsonResponse({'error': 'Дата начала обязательна'}, status=400)
        
        if not class_type_id:
            return JsonResponse({'error': 'Тип занятия обязателен'}, status=400)
        
        # Парсим дату, конвертируя из UTC в локальное время если нужно
        date_time = parse_datetime_to_local(start)
        if not date_time:
            return JsonResponse({'error': 'Неверный формат даты'}, status=400)
        
        class_type = get_object_or_404(ClassType, id=class_type_id)
        
        # Если длительность не указана, берем из типа занятия
        if not duration:
            duration = class_type.duration_minutes
        
        hall = None
        if hall_id:
            hall = get_object_or_404(Hall, id=hall_id)
        
        tariff = None
        if tariff_id:
            tariff = get_object_or_404(Tariff, id=tariff_id)
        elif class_type.default_tariff:
            tariff = class_type.default_tariff
        
        session = ClassSession.objects.create(
            class_type=class_type,
            tariff=tariff,
            date_time=date_time,
            duration=duration,
            hall=hall,
            is_recurring=is_recurring,
            max_participants_override=max_participants_override if max_participants_override is not None else None,
        )
        
        # Если занятие повторяющееся, создаем события на 4 недели вперед
        created_events = [{'id': session.id, 'title': session.class_type.name, 
                          'start': session.date_time.strftime('%Y-%m-%dT%H:%M:%S'),
                          'end': (session.date_time + timedelta(minutes=session.duration)).strftime('%Y-%m-%dT%H:%M:%S')}]
        
        if is_recurring and recurring_count > 1:
            for week in range(1, recurring_count):
                new_date = date_time + timedelta(weeks=week)
                recurring_session = ClassSession.objects.create(
                    class_type=class_type,
                    tariff=tariff,
                    date_time=new_date,
                    duration=duration,
                    hall=hall,
                    is_recurring=True,
                    recurrence_id=session.recurrence_id,
                    max_participants_override=max_participants_override if max_participants_override is not None else None,
                )
                created_events.append({
                    'id': recurring_session.id,
                    'title': recurring_session.class_type.name,
                    'start': recurring_session.date_time.strftime('%Y-%m-%dT%H:%M:%S'),
                    'end': (recurring_session.date_time + timedelta(minutes=recurring_session.duration)).strftime('%Y-%m-%dT%H:%M:%S'),
                    'recurrence_id': recurring_session.recurrence_id,
                    'is_recurring': True
                })
        
        return JsonResponse({
            'success': True,
            'event': created_events[0],
            'recurring_events': created_events if is_recurring else None
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


@require_http_methods(["POST", "PUT"])
def update_event(request, event_id):
    """Обновление существующего занятия (только для модераторов и админов)"""
    # Проверка прав доступа
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Доступ запрещен'}, status=403)
    
    # Проверяем суперадмина Django или администратора/модератора через профиль
    is_authorized = False
    if request.user.is_superuser or request.user.is_staff:
        is_authorized = True
    elif hasattr(request.user, 'role') and request.user.role in ['moderator', 'admin']:
        is_authorized = True
    
    if not is_authorized:
        return JsonResponse({'error': 'Доступ запрещен. Только модераторы и администраторы могут редактировать занятия'}, status=403)
    
    try:
        session = get_object_or_404(ClassSession, id=event_id)

        # Запоминаем старые значения для уведомлений
        old_date = session.date_time
        old_class_type = session.class_type

        if request.method == "POST":
            data = json.loads(request.body)
        else:
            data = json.loads(request.body)

        new_start_dt = None
        if 'class_type_id' in data and data['class_type_id']:
            session.class_type = get_object_or_404(ClassType, id=data['class_type_id'])
        if 'start' in data:
            parsed_dt = parse_datetime_to_local(data['start'])
            if parsed_dt:
                session.date_time = parsed_dt
                new_start_dt = parsed_dt
            else:
                return JsonResponse({'error': 'Неверный формат даты'}, status=400)
        if 'duration' in data:
            session.duration = data['duration']
        elif session.class_type and not session.duration:
            session.duration = session.class_type.duration_minutes
        if 'hall_id' in data:
            if data['hall_id']:
                session.hall = get_object_or_404(Hall, id=data['hall_id'])
            else:
                session.hall = None
        if 'tariff_id' in data:
            if data['tariff_id']:
                session.tariff = get_object_or_404(Tariff, id=data['tariff_id'])
            else:
                session.tariff = None
        if 'max_participants_override' in data:
            session.max_participants_override = data['max_participants_override'] if data['max_participants_override'] is not None else None
        
        session.save()

        # Запоминаем, было ли событие частью серии ДО этого сохранения
        was_recurring = bool(session.recurrence_id)

        # Обработка повторения: при включении повторения создаём серию событий.
        # Серия создаётся только при ПЕРВОМ включении повтора; у уже повторяющегося
        # занятия серия существует, поэтому дубликаты не создаём (иначе смена
        # времени/даты начального занятия плодила бы параллельные серии).
        if data.get('is_recurring', False):
            session.is_recurring = True
            # save() сгенерирует recurrence_id, если его ещё нет
            if not session.recurrence_id:
                session.save()
            if not was_recurring:
                recurring_count = int(data.get('recurring_count', 4))
                existing_dates = set(
                    ClassSession.objects.filter(recurrence_id=session.recurrence_id)
                    .exclude(pk=session.pk)
                    .values_list('date_time', flat=True)
                )
                for week in range(1, recurring_count):
                    new_date = session.date_time + timedelta(weeks=week)
                    if new_date in existing_dates:
                        continue
                    ClassSession.objects.create(
                        class_type=session.class_type,
                        tariff=session.tariff,
                        date_time=new_date,
                        duration=session.duration,
                        hall=session.hall,
                        is_recurring=True,
                        recurrence_id=session.recurrence_id,
                        max_participants_override=session.max_participants_override,
                    )
        elif 'is_recurring' in data:
            # Отключили повторение — выходим из серии, остальные события не трогаем
            if session.is_recurring:
                session.is_recurring = False
                session.recurrence_id = ''
                session.save()

        # Редактирование НАЧАЛЬНОГО занятия серии применяется ко всей серии:
        # переносим изменения свойств (тип, длительность, зал, тариф, вместимость,
        # время начала) на остальные занятия серии. Изменение даты-«начала» при этом
        # переносит только время (часы:минуты), а даты остальных занятий не трогает.
        if was_recurring and data.get('is_recurring', True) is not False:
            has_earlier = ClassSession.objects.filter(
                recurrence_id=session.recurrence_id
            ).exclude(pk=session.pk).filter(date_time__lt=old_date).exists()
            if not has_earlier:
                siblings = ClassSession.objects.filter(
                    recurrence_id=session.recurrence_id
                ).exclude(pk=session.pk)
                for sib in siblings:
                    changed = False
                    if 'class_type_id' in data and data['class_type_id']:
                        sib.class_type = session.class_type
                        changed = True
                    if 'duration' in data:
                        sib.duration = session.duration
                        changed = True
                    if 'hall_id' in data:
                        sib.hall = session.hall
                        changed = True
                    if 'tariff_id' in data:
                        sib.tariff = session.tariff
                        changed = True
                    if 'max_participants_override' in data:
                        sib.max_participants_override = session.max_participants_override
                        changed = True
                    if new_start_dt is not None:
                        sib.date_time = sib.date_time.replace(
                            hour=new_start_dt.hour,
                            minute=new_start_dt.minute,
                            second=0,
                            microsecond=0,
                        )
                        changed = True
                    if changed:
                        sib.save()

        # Уведомление о переносе
        if old_date != session.date_time or old_class_type != session.class_type:
            from .vk_bot import send_vk_message
            bookings = session.bookings.filter(
                status__in=['confirmed', 'paid'],
                client__vk_messages_allowed=True,
                client__vk_user_id__isnull=False,
            ).exclude(client__vk_user_id='')
            for booking in bookings:
                msg = (
                    f'Занятие "{session.class_type.name}" перенесено. '
                    f'Новое время: {session.date_time.strftime("%d.%m.%Y %H:%M")}.'
                )
                send_vk_message(booking.client.vk_user_id, msg)
                InAppNotification.objects.create(
                    user=booking.client,
                    notification_type=InAppNotification.TYPE_EVENT_CHANGE,
                    title=f'Занятие "{session.class_type.name}" перенесено',
                    message=f'Новое время: {session.date_time.strftime("%d.%m.%Y %H:%M")}.',
                    link='/calendar/',
                )
        
        return JsonResponse({
            'success': True,
            'event': {
                'id': session.id,
                'title': session.class_type.name,
                'start': session.date_time.strftime('%Y-%m-%dT%H:%M:%S'),
                'end': (session.date_time + timedelta(minutes=session.duration)).strftime('%Y-%m-%dT%H:%M:%S'),
            }
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


@require_http_methods(["POST"])
def delete_event(request, event_id):
    """Удаление занятия (только для модераторов и админов)"""
    # Проверка прав доступа
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Доступ запрещен'}, status=403)
    
    # Проверяем суперадмина Django или администратора/модератора через профиль
    is_authorized = False
    if request.user.is_superuser or request.user.is_staff:
        is_authorized = True
    elif hasattr(request.user, 'role') and request.user.role in ['moderator', 'admin']:
        is_authorized = True
    
    if not is_authorized:
        return JsonResponse({'error': 'Доступ запрещен. Только модераторы и администраторы могут удалять занятия'}, status=403)
    
    try:
        session = get_object_or_404(ClassSession, id=event_id)

        # Получаем данные о повторении перед удалением
        is_recurring = session.is_recurring
        recurrence_id = session.recurrence_id

        # Проверяем, нужно ли удалять только одно событие или всю серию
        if request.content_type == 'application/json':
            data = json.loads(request.body)
            delete_single = data.get('delete_single', False)
        else:
            delete_single = False

        # Определяем какие сессии будут удалены
        if is_recurring and recurrence_id and not delete_single:
            sessions_to_delete = ClassSession.objects.filter(
                recurrence_id=recurrence_id,
                date_time__gte=session.date_time
            )
        else:
            sessions_to_delete = [session]

        # Возвращаем средства всем записанным ученикам перед удалением
        for s in sessions_to_delete:
            for booking in s.bookings.filter(status__in=['confirmed', 'paid']):
                PaymentService.cancel_booking(booking, by_admin=True)

        # Уведомление в VK об отмене
        from .vk_bot import send_vk_message
        dt = session.date_time.strftime('%d.%m.%Y %H:%M')
        reason = 'отмена' if is_recurring and recurrence_id and not delete_single else 'отмена'
        for s in sessions_to_delete:
            for booking in s.bookings.filter(
                status__in=['cancelled', 'cancelled_by_admin'],
                client__vk_messages_allowed=True,
                client__vk_user_id__isnull=False,
            ).exclude(client__vk_user_id=''):
                msg = (
                    f'Занятие "{session.class_type.name}" ({dt}) отменено. '
                    f'Средства возвращены на ваш баланс.'
                )
                if booking.client.vk_user_id:
                    send_vk_message(booking.client.vk_user_id, msg)
                InAppNotification.objects.create(
                    user=booking.client,
                    notification_type=InAppNotification.TYPE_EVENT_CHANGE,
                    title=f'Занятие "{session.class_type.name}" отменено',
                    message=f'Занятие ({dt}) отменено. Средства возвращены на баланс.',
                    link='/calendar/',
                )

        if is_recurring and recurrence_id and not delete_single:
            sessions_to_delete.delete()
        else:
            session.delete()

        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


@require_http_methods(["GET"])
def get_attendance(request, session_id):
    """Получение списка записей на занятие"""
    try:
        session = get_object_or_404(ClassSession, id=session_id)
        
        # Авто-списание для сплит-сессий, у которых наступил дедлайн
        if session.tariff.tariff_type == 'split':
            deadline = session.date_time - timedelta(hours=3, minutes=50)
            now = datetime.now()
            if now >= deadline:
                has_confirmed = Booking.objects.filter(
                    session=session, status='confirmed'
                ).exists()
                if has_confirmed:
                    first_booking = Booking.objects.filter(
                        session=session, status='confirmed'
                    ).first()
                    if first_booking:
                        from core.services import PaymentService
                        try:
                            PaymentService.charge_split_bookings(first_booking)
                        except Exception:
                            pass  # Ошибки обработки не блокируют показ списка
        
        # Проверка прав доступа
        is_moderator = False
        current_user_client_id = None
        if request.user.is_authenticated:
            client = request.user
            is_moderator = client.role in ['moderator', 'admin']
            current_user_client_id = client.id
        
        # Получаем всех клиентов, записанных на это занятие (исключая отменённые)
        bookings = Booking.objects.filter(
            session=session
        ).exclude(
            status__in=['cancelled', 'cancelled_by_admin']
        ).select_related('client')
        
        attendance_list = []
        for booking in bookings:
            client_user = booking.client
            is_staff = is_moderator
            if is_staff:
                display_name = f"{client_user.last_name} {client_user.first_name}".strip()
                display_phone = client_user.phone or ''
            else:
                first_name = client_user.first_name or ''
                last_initial = (client_user.last_name[0] + '.') if client_user.last_name else ''
                display_name = f"{first_name} {last_initial}".strip()
                display_phone = ''
            attendance_data = {
                'id': booking.id,
                'client_id': booking.client.id,
                'client_name': display_name,
                'client_phone': display_phone,
                'attended': booking.status in ['paid', 'confirmed'],
                'is_current_user': booking.client_id == current_user_client_id,
                'role': booking.client.role,
                'status': booking.status,
                'is_subscription_used': booking.is_subscription_used
            }
            attendance_list.append(attendance_data)
        
        # Получаем max_participants с учетом переопределения
        max_participants = session.get_max_participants()
        
        return JsonResponse({
            'success': True,
            'attendances': attendance_list,
            'max_participants': max_participants,
            'registered_count': len(attendance_list),
            'can_view_details': True
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


@require_http_methods(["POST"])
def update_attendance(request, session_id):
    """Обновление посещаемости для занятия (только для модераторов и админов)"""
    # Проверка прав доступа
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Доступ запрещен'}, status=403)
    
    # Проверяем суперадмина Django или администратора/модератора через профиль
    is_authorized = False
    if request.user.is_superuser or request.user.is_staff:
        is_authorized = True
    elif hasattr(request.user, 'role') and request.user.role in ['moderator', 'admin']:
        is_authorized = True
    
    if not is_authorized:
        return JsonResponse({'error': 'Доступ запрещен. Только модераторы и администраторы могут управлять посещаемостью'}, status=403)
    
    try:
        session = get_object_or_404(ClassSession, id=session_id)
        data = json.loads(request.body)
        
        # attended_client_ids - список ID клиентов, которые посетили занятие
        attended_client_ids = data.get('attended_clients', [])
        
        # Обновляем статус записей для клиентов, которые посетили занятие
        for client_id in attended_client_ids:
            client = get_object_or_404(User, id=client_id)
            booking, _ = Booking.objects.get_or_create(
                session=session,
                client=client,
                defaults={
                    'status': 'paid',
                    'amount_paid': 0,
                    'is_subscription_used': False,
                    'paid_at': timezone.now(),
                }
            )
            if booking.status not in ['cancelled', 'cancelled_by_admin']:
                booking.status = 'paid'
                if not booking.paid_at:
                    booking.paid_at = timezone.now()
                booking.save()
            # Создаём/обновляем запись посещаемости
            Attendance.objects.update_or_create(
                session=session,
                client=client,
                defaults={'status': 'attended', 'visited_at': session.date_time}
            )
        
        # Удаляем записи посещаемости для клиентов, которых убрали из списка посетивших
        Attendance.objects.filter(session=session).exclude(
            client_id__in=attended_client_ids
        ).delete()
        
        # Для клиентов, которые были записаны, но не отмечены - ставим статус no_show
        all_bookings = Booking.objects.filter(session=session).exclude(
            status__in=['cancelled', 'cancelled_by_admin']
        )
        for booking in all_bookings:
            if booking.client_id not in attended_client_ids:
                booking.status = 'no_show'
                booking.save()
        
        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


@require_http_methods(["POST"])
def enroll_to_class(request, session_id):
    """Запись пользователя на занятие"""
    # Проверка прав доступа
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Доступ запрещен. Требуется авторизация'}, status=403)
    
    # Для записи на занятие нужен профиль клиента (ученик или модератор/админ)
    # Проверяем, что пользователь имеет подходящую роль
    if not hasattr(request.user, 'role') or request.user.role not in ['student', 'moderator', 'admin']:
        return JsonResponse({'error': 'Доступ запрещен. Требуется профиль клиента'}, status=403)
    
    client = request.user
    
    try:
        session = get_object_or_404(ClassSession, id=session_id)
        
        # Проверяем время до занятия (не менее 4 часов для отмены)
        # При USE_TZ = False используем naive datetime для сравнения
        now = datetime.now()
        session_time = session.date_time
        time_until_class = session_time - now
        if time_until_class.total_seconds() < 4 * 3600:  # 4 часа в секундах
            return JsonResponse({'error': 'Запись возможна не позднее чем за 4 часа до начала занятия'}, status=400)
        
        # Удаляем старые отменённые записи этого клиента на это занятие
        Booking.objects.filter(
            session=session, client=client,
            status__in=['cancelled', 'cancelled_by_admin']
        ).delete()
        
        # Проверяем, не записан ли уже клиент
        existing_booking = Booking.objects.filter(
            session=session, client=client
        ).first()
        if existing_booking:
            return JsonResponse({'error': 'Вы уже записаны на это занятие'}, status=400)
        
        # Проверяем наличие свободных мест
        current_count = Booking.objects.filter(session=session, status__in=['confirmed', 'paid']).count()
        max_participants = session.get_max_participants()
        if current_count >= max_participants:
            return JsonResponse({'error': 'Нет свободных мест'}, status=400)
        
        # Создаем запись с мгновенным списанием средств (абонемент или баланс)
        try:
            booking = PaymentService.create_booking(client, session)
        except ValueError as e:
            return JsonResponse({'error': str(e)}, status=400)
        
        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


@require_http_methods(["POST"])
def cancel_enrollment(request, session_id):
    """Отмена записи пользователя на занятие"""
    # Проверка прав доступа
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Доступ запрещен. Требуется авторизация'}, status=403)
    
    # Для отмены записи нужен профиль клиента (ученик или модератор/админ)
    # Проверяем, что пользователь имеет подходящую роль
    if not hasattr(request.user, 'role') or request.user.role not in ['student', 'moderator', 'admin']:
        return JsonResponse({'error': 'Доступ запрещен. Требуется профиль клиента'}, status=403)
    
    client = request.user
    
    try:
        session = get_object_or_404(ClassSession, id=session_id)
        
        # Проверяем время до занятия (не менее 4 часов)
        # При USE_TZ = False используем naive datetime для сравнения
        now = datetime.now()
        session_time = session.date_time
        time_until_class = session_time - now
        if time_until_class.total_seconds() < 4 * 3600:  # 4 часа в секундах
            return JsonResponse({'error': 'Отмена записи возможна не позднее чем за 4 часа до начала занятия'}, status=400)
        
        # Находим запись
        booking = Booking.objects.filter(session=session, client=client).first()
        if not booking:
            return JsonResponse({'error': 'Вы не записаны на это занятие'}, status=400)
        
        # Отменяем запись через сервис
        PaymentService.cancel_booking(booking, by_admin=False)
        
        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


@require_http_methods(["POST"])
def add_client_to_session(request, session_id):
    """Добавление клиента на занятие вручную (только для модераторов и админов)"""
    # Проверка прав доступа
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Доступ запрещен'}, status=403)
    
    # Проверяем суперадмина Django или администратора/модератора через профиль
    is_authorized = False
    if request.user.is_superuser or request.user.is_staff:
        is_authorized = True
    elif hasattr(request.user, 'role') and request.user.role in ['moderator', 'admin']:
        is_authorized = True
    
    if not is_authorized:
        return JsonResponse({'error': 'Доступ запрещен. Только модераторы и администраторы могут добавлять клиентов на занятия'}, status=403)
    
    try:
        session = get_object_or_404(ClassSession, id=session_id)
        data = json.loads(request.body)
        client_id = data.get('client_id')
        
        if not client_id:
            return JsonResponse({'error': 'ID клиента обязателен'}, status=400)
        
        client = get_object_or_404(User, id=client_id)
        
        # Удаляем старые отменённые записи (как в enroll_to_class)
        Booking.objects.filter(
            session=session, client=client,
            status__in=['cancelled', 'cancelled_by_admin']
        ).delete()

        # Проверяем, не записан ли уже клиент (активная запись)
        existing = Booking.objects.filter(session=session, client=client).exclude(
            status__in=['cancelled', 'cancelled_by_admin']
        ).first()
        if existing:
            return JsonResponse({'error': 'Клиент уже записан на это занятие'}, status=400)
        
        # Создаем запись с мгновенным списанием средств (абонемент или баланс)
        try:
            booking = PaymentService.create_booking(client, session)
        except ValueError as e:
            return JsonResponse({'error': str(e)}, status=400)
        
        return JsonResponse({
            'success': True,
            'client': {
                'id': client.id,
                'name': f"{client.last_name if client else ''} {client.first_name if client else ''}".strip(),
                'phone': client.phone or '',
                'role': client.role
            }
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


@require_http_methods(["POST"])
def remove_client_from_session(request, session_id):
    """Удаление клиента с занятия (только для модераторов и админов) с возвратом средств"""
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Доступ запрещен'}, status=403)

    is_authorized = False
    if request.user.is_superuser or request.user.is_staff:
        is_authorized = True
    elif hasattr(request.user, 'role') and request.user.role in ['moderator', 'admin']:
        is_authorized = True

    if not is_authorized:
        return JsonResponse({'error': 'Доступ запрещен. Только модераторы и администраторы могут удалять клиентов с занятий'}, status=403)

    try:
        session = get_object_or_404(ClassSession, id=session_id)
        data = json.loads(request.body)
        client_id = data.get('client_id')

        if not client_id:
            return JsonResponse({'error': 'ID клиента обязателен'}, status=400)

        booking = get_object_or_404(Booking, session=session, client_id=client_id)

        if booking.status in ['cancelled', 'cancelled_by_admin']:
            return JsonResponse({'error': 'Запись уже отменена'}, status=400)

        PaymentService.cancel_booking(booking, by_admin=True)

        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


# Транслитерация ЙЦУКЕН ↔ QWERTY для поиска без учёта раскладки
_RU_TO_EN = {
    'й': 'q', 'ц': 'w', 'у': 'e', 'к': 'r', 'е': 't', 'н': 'y',
    'г': 'u', 'ш': 'i', 'щ': 'o', 'з': 'p', 'х': '[', 'ъ': ']',
    'ф': 'a', 'ы': 's', 'в': 'd', 'а': 'f', 'п': 'g', 'р': 'h',
    'о': 'j', 'л': 'k', 'д': 'l', 'ж': ';', 'э': "'",
    'я': 'z', 'ч': 'x', 'с': 'c', 'м': 'v', 'и': 'b', 'т': 'n',
    'ь': 'm', 'б': ',', 'ю': '.', 'ё': '`',
}
_EN_TO_RU = {v: k for k, v in _RU_TO_EN.items()}


def _transliterate(text, mapping):
    return ''.join(mapping.get(ch, ch) for ch in text)


@require_http_methods(["GET"])
def search_clients(request):
    """Поиск клиентов по имени/фамилии/телефону (только для модераторов и админов)"""
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Доступ запрещен'}, status=403)
    
    if not hasattr(request.user, 'role') or request.user.role not in ['moderator', 'admin']:
        return JsonResponse({'error': 'Доступ запрещен. Только модераторы и администраторы могут искать клиентов'}, status=403)
    
    try:
        query = request.GET.get('q', '')
        if not query:
            return JsonResponse({'clients': []})
        
        raw = query.lower()
        variants = {raw}
        variants.add(_transliterate(raw, _EN_TO_RU))
        variants.add(_transliterate(raw, _RU_TO_EN))
        # Добавляем варианты с заменой е↔ё
        for v in list(variants):
            if 'е' in v:
                variants.add(v.replace('е', 'ё'))
            if 'ё' in v:
                variants.add(v.replace('ё', 'е'))
        variants.discard('')
        
        # Выбираем всех активных пользователей и фильтруем в Python
        # (SQLite не умеет в регистронезависимый поиск для кириллицы)
        all_users = User.objects.filter(is_active=True).only('id', 'first_name', 'last_name', 'phone', 'role')
        
        client_list = []
        for u in all_users:
            text = f"{u.last_name} {u.first_name} {u.phone}".lower()
            if any(v in text for v in variants):
                client_list.append({
                    'id': u.id,
                    'name': f"{u.last_name} {u.first_name}".strip(),
                    'phone': u.phone or '',
                    'role': u.role
                })
                if len(client_list) >= 10:
                    break
        
        return JsonResponse({'clients': client_list})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


def register_view(request):
    """Страница регистрации нового пользователя"""
    if request.user.is_authenticated:
        return redirect('home')
    
    if request.method == 'POST':
        form = RegistrationForm(request.POST)
        if form.is_valid():
            with transaction.atomic():
                user = form.save(commit=False)
                user.username = form.cleaned_data.get('phone')
                user.first_name = form.cleaned_data.get('first_name')
                user.last_name = form.cleaned_data.get('last_name')
                
                default_settings = UserDefaultSettings.get_defaults()
                
                user.role = default_settings.default_role
                user.balance = default_settings.default_balance
                user.save()
                
                if default_settings.default_tariffs.exists():
                    user.allowed_tariffs.set(default_settings.default_tariffs.all())
                
                if default_settings.default_groups.exists():
                    user.groups.set(default_settings.default_groups.all())
                
                if hasattr(user, 'client_profile'):
                    user.client_profile.phone = user.username
                    user.client_profile.save()
                
                user.backend = 'core.auth_backend.PhoneAuthBackend'
                login(request, user)
                return redirect('home')
    else:
        form = RegistrationForm()
    
    return render(request, 'core/register.html', {'form': form})


def login_view(request, template='core/login.html'):
    """Страница входа для существующих пользователей"""
    if request.user.is_authenticated:
        return redirect('home')
    
    if request.method == 'POST':
        form = LoginForm(request, data=request.POST)
        if form.is_valid():
            cleaned_phone = form.cleaned_data.get('username')
            password = form.cleaned_data.get('password')
            
            user = authenticate(request, username=cleaned_phone, password=password)
            if user is not None:
                login(request, user)
                next_url = request.GET.get('next', 'home')
                return redirect(next_url)
    else:
        form = LoginForm()
    
    return render(request, template, {'form': form})


@login_required
def logout_view(request):
    """Выход из системы"""
    logout(request)
    return redirect('login')


@login_required
def home_view(request):
    """Главная — дайджест: новости, баланс, занятия, абонементы"""
    client = request.user

    current_hour = timezone.now().hour
    if 5 <= current_hour < 12:
        greeting = "Доброе утро"
    elif 12 <= current_hour < 18:
        greeting = "Добрый день"
    else:
        greeting = "Добрый вечер"

    upcoming_sessions = ClassSession.objects.filter(
        bookings__client=client,
        bookings__status__in=['confirmed', 'paid'],
        date_time__gte=timezone.now()
    ).select_related('class_type', 'hall').prefetch_related('bookings').order_by('date_time')[:10]

    past_sessions = ClassSession.objects.filter(
        attendance__client=client,
        attendance__status='attended',
        date_time__lt=timezone.now()
    ).select_related('class_type', 'hall').order_by('-date_time')[:20]

    # Ближайшие доступные для записи занятия
    now_plus_4h = timezone.now() + timedelta(hours=4)
    all_upcoming = ClassSession.objects.filter(
        PaymentService.session_access_q(client),
        date_time__gte=now_plus_4h,
    ).exclude(
        bookings__client=client, bookings__status__in=['confirmed', 'paid']
    ).select_related('class_type', 'hall', 'tariff').order_by('date_time')[:20]

    available_upcoming_sessions = []
    for s in all_upcoming:
        can, reason = PaymentService.can_book_session(client, s)
        available_upcoming_sessions.append({'session': s, 'can_book': can, 'reason': reason})

    active_subscriptions = Subscription.objects.filter(
        client=client,
        status='active'
    ).select_related('tariff').order_by('-purchased_at')

    subscription_remaining = sum(sub.sessions_remaining for sub in active_subscriptions)

    renewable_subscriptions = [sub for sub in active_subscriptions if PaymentService.can_renew_subscription(sub)]

    # Показываем все тарифы с абонементами; недоступные — серыми (allowed_tariff_ids управляет доступом)
    available_tariffs_with_subscriptions = Tariff.objects.filter(
        is_subscription_available=True,
        is_active=True
    ).annotate()
    if client.is_moderator:
        allowed_tariff_ids = list(available_tariffs_with_subscriptions.values_list('id', flat=True))
    else:
        allowed_tariff_ids = list(client.allowed_tariffs.values_list('id', flat=True))

    news_list = News.objects.filter(is_published=True).order_by('-published_at')[:10]

    past_dates = [s.date_time.strftime('%Y-%m-%d') for s in past_sessions]

    context = {
        'client': client,
        'greeting': greeting,
        'upcoming_sessions': upcoming_sessions,
        'past_sessions': past_sessions,
        'available_upcoming_sessions': available_upcoming_sessions,
        'is_moderator': client.is_moderator,
        'is_admin': client.is_admin,
        'is_staff': client.is_staff,
        'active_subscriptions': active_subscriptions,
        'subscription_remaining': subscription_remaining,
        'renewable_subscriptions': renewable_subscriptions,
        'available_tariffs_with_subscriptions': available_tariffs_with_subscriptions,
        'allowed_tariff_ids': allowed_tariff_ids,
        'news_list': news_list,
        'past_dates_json': json.dumps(past_dates),
    }
    return render(request, 'core/home.html', context)


@login_required
def profile_detail_view(request):
    """Профиль — личные данные, настройки, достижения"""
    client = request.user

    error = None
    avatar_error = None

    if request.method == 'POST':
        if request.POST.get('avatar_delete'):
            client.avatar.delete(save=False)
            client.save()
            return redirect('profile_detail')

        if 'avatar' in request.FILES:
            avatar_file = request.FILES['avatar']
            avatar_error = _validate_avatar(avatar_file)
            if avatar_error:
                pass  # re-render with avatar_error below
            else:
                client.avatar = avatar_file
                client.save()
                return redirect('profile_detail')

        first_name = request.POST.get('first_name', '').strip()
        last_name = request.POST.get('last_name', '').strip()
        raw_phone = request.POST.get('phone', '').strip()
        email = request.POST.get('email', '').strip()
        theme = request.POST.get('theme', 'default')

        if raw_phone:
            cleaned_phone = re.sub(r'[^\d+]', '', raw_phone)
            if cleaned_phone.startswith('8') and len(cleaned_phone) == 11:
                cleaned_phone = '+7' + cleaned_phone[1:]
            if not re.match(r'^\+7\d{10}$', cleaned_phone):
                error = 'Неверный формат телефона. Используйте формат +7XXXXXXXXXX'
            else:
                # Check uniqueness with normalization (existing DB values may have dashes)
                dupes = User.objects.exclude(pk=client.pk).values_list('phone', flat=True)
                if any(normalize_phone(p or '') == cleaned_phone for p in dupes):
                    error = 'Этот номер телефона уже используется другим пользователем.'
                else:
                    client.phone = cleaned_phone
                    client.username = cleaned_phone
        else:
            error = 'Номер телефона обязателен'

        if first_name:
            client.first_name = first_name
        if last_name:
            client.last_name = last_name
        client.email = email

        if error:
            pass  # re-render with error below
        else:
            if 'avatar' in request.FILES:
                client.avatar = request.FILES['avatar']
            client.theme = theme
            client.save()
            return redirect('profile_detail')

    active_subscriptions = Subscription.objects.filter(
        client=client,
        status='active'
    ).select_related('tariff').order_by('-purchased_at')

    subscription_remaining = sum(sub.sessions_remaining for sub in active_subscriptions)

    renewable_subscriptions = [sub for sub in active_subscriptions if PaymentService.can_renew_subscription(sub)]

    upcoming_sessions = ClassSession.objects.filter(
        bookings__client=client,
        bookings__status__in=['confirmed', 'paid'],
        date_time__gte=timezone.now()
    ).select_related('class_type', 'hall').prefetch_related('bookings').order_by('date_time')[:10]

    past_sessions = ClassSession.objects.filter(
        attendance__client=client,
        attendance__status='attended',
        date_time__lt=timezone.now()
    ).select_related('class_type', 'hall').order_by('-date_time')[:100]

    past_dates = [s.date_time.strftime('%Y-%m-%d') for s in past_sessions]

    balance_transactions = PaymentTransaction.objects.filter(
        client=client
    ).select_related('subscription__tariff', 'booking__session__class_type').order_by('-created_at')[:200]

    context = {
        'client': client,
        'error': error,
        'avatar_error': avatar_error,
        'active_subscriptions': active_subscriptions,
        'subscription_remaining': subscription_remaining,
        'renewable_subscriptions': renewable_subscriptions,
        'upcoming_sessions': upcoming_sessions,
        'past_sessions': past_sessions,
        'past_dates_json': json.dumps(past_dates),
        'balance_transactions': balance_transactions,
        'vk_group_id': settings.VK_GROUP_ID,
    }
    return render(request, 'core/profile.html', context)


@require_http_methods(["POST"])
def telegram_auth(request):
    """
    Обработчик авторизации через Telegram
    
    Получает данные от Telegram Login Widget, проверяет подпись,
    находит или создаёт пользователя, выполняет вход.
    """
    if not settings.TELEGRAM_BOT_TOKEN:
        return JsonResponse({
            'success': False,
            'error': 'Telegram бот не настроен. Обратитесь к администратору.'
        }, status=500)
    
    # Получаем данные из POST запроса
    telegram_data = {}
    for key in ['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash']:
        if key in request.POST:
            telegram_data[key] = request.POST[key]
    
    # Проверяем данные через модуль телеграм аутентификации
    validated_data = validate_telegram_auth_data(telegram_data, settings.TELEGRAM_BOT_TOKEN)
    
    if not validated_data:
        return JsonResponse({
            'success': False,
            'error': 'Неверные данные авторизации. Попробуйте ещё раз.'
        }, status=400)
    
    telegram_id = validated_data['telegram_id']
    
    try:
        with transaction.atomic():
            # Ищем пользователя по telegram_id
            user = User.objects.filter(telegram_id=telegram_id).first()
            
            if user:
                # Пользователь найден - просто выполняем вход
                created = False
            else:
                # Пользователь не найден - создаём нового
                # Генерируем уникальный username на основе telegram_id
                username = f"tg_{telegram_id}"
                
                user = User.objects.create_user(
                    username=username,
                    first_name=validated_data['first_name'],
                    last_name=validated_data['last_name'],
                    telegram_id=telegram_id,
                )
                
                # Получаем настройки по умолчанию и применяем их
                default_settings = UserDefaultSettings.get_defaults()
                user.role = default_settings.default_role
                user.balance = default_settings.default_balance
                user.save()
                
                # Назначаем тарифы по умолчанию
                if default_settings.default_tariffs.exists():
                    user.allowed_tariffs.set(default_settings.default_tariffs.all())
                
                # Назначаем группы по умолчанию
                if default_settings.default_groups.exists():
                    user.groups.set(default_settings.default_groups.all())
                
                # Сохраняем username из Telegram если есть
                if validated_data.get('username'):
                    # Пробуем использовать username из Telegram как phone (если свободен)
                    tg_username = validated_data['username']
                    if not User.objects.filter(username=tg_username).exclude(id=user.id).exists():
                        user.username = tg_username
                        user.save()
                
                created = True
            
            # Выполняем вход пользователя
            login(request, user)
            
            return JsonResponse({
                'success': True,
                'created': created,
                'redirect_url': '/profile/',
                'user': {
                    'id': user.id,
                    'first_name': user.first_name,
                    'last_name': user.last_name,
                    'telegram_id': user.telegram_id,
                }
            })
            
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': f'Ошибка при авторизации: {str(e)}'
        }, status=500)


@require_http_methods(["GET", "POST"])
def vk_auth(request):
    """
    Обработчик авторизации через ВКонтакте (VK ID SDK 3.0+)
    
    GET: редирект после авторизации VK (содержит code в query) — перенаправляем на login/
    POST: обработка данных от VK SDK
    """
    # Обработка редиректа от VK (когда попап заблокирован)
    if request.method == "GET":
        code = request.GET.get('code', '')
        if code:
            if request.user.is_authenticated:
                return redirect('/profile/?' + request.META.get('QUERY_STRING', ''))
            return redirect('/login/?' + request.META.get('QUERY_STRING', ''))
        return JsonResponse({'success': False, 'error': 'Метод не поддерживается'}, status=405)
    
    if not settings.VK_SERVICE_KEY:
        return JsonResponse({'success': False, 'error': 'VK авторизация не настроена.'}, status=500)
    
    try:
        data = json.loads(request.body)
        access_token = data.get('access_token', '')
        user_id = data.get('user_id')
        first_name = data.get('first_name', '')
        last_name = data.get('last_name', '')
        phone = data.get('phone', '')
        silent_token = data.get('silent_token', '')
        uuid = data.get('uuid', '')
        id_token = data.get('id_token', '')
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'Неверный формат данных'}, status=400)
    
    if not access_token or not user_id:
        return JsonResponse({'success': False, 'error': 'Неверные данные авторизации'}, status=400)
    
    validated_data = validate_vk_oauth_data(access_token, int(user_id), settings.VK_SERVICE_KEY)
    if not validated_data:
        return JsonResponse({'success': False, 'error': 'Ошибка проверки данных VK'}, status=400)
    
    # Получаем номер телефона из VK
    full_phone = ''
    if silent_token and uuid:
        full_phone = exchange_silent_token(access_token, silent_token, uuid)
    if not full_phone:
        full_phone = get_user_phone_from_vk(access_token) or ''
    if not full_phone and id_token:
        masked_info = get_masked_user_info_from_vk(id_token)
        if masked_info:
            full_phone = masked_info.get('phone', '')
            if not first_name:
                first_name = masked_info.get('first_name', '')
            if not last_name:
                last_name = masked_info.get('last_name', '')
    
    vk_id = str(validated_data['vk_id'])
    
    # Если пользователь уже залогинен — привязываем VK к текущему аккаунту
    if request.user.is_authenticated:
        if User.objects.filter(vk_user_id=vk_id).exclude(id=request.user.id).exists():
            return JsonResponse({'success': False, 'error': 'Этот VK ID уже привязан к другому аккаунту.'}, status=409)
        request.user.vk_user_id = vk_id
        request.user.vk_access_token = access_token or ''
        if first_name:
            request.user.first_name = first_name
        if last_name:
            request.user.last_name = last_name
        request.user.save()
        return JsonResponse({
            'success': True, 'status': 'linked', 'redirect_url': '/profile/',
        })
    
    try:
        with transaction.atomic():
            # v1: Пользователь уже есть по vk_user_id
            user = User.objects.filter(vk_user_id=vk_id).first()
            if user:
                if first_name:
                    user.first_name = first_name
                if last_name:
                    user.last_name = last_name
                if access_token:
                    user.vk_access_token = access_token
                user.save()
                user.backend = 'core.auth_backend.PhoneAuthBackend'
                login(request, user)
                return JsonResponse({
                    'success': True, 'status': 'linked', 'created': False,
                    'redirect_url': '/dashboard/',
                })
            
            
            # Нормализуем телефон из VK
            client_phone = phone or full_phone or ''
            vk_phone = normalize_phone(client_phone) if client_phone else ''
            
            # v2: Телефон совпал → авто-привязка
            if vk_phone:
                phone_user = User.objects.filter(phone=vk_phone).first()
                if phone_user:
                    if phone_user.vk_user_id:
                        return JsonResponse({
                            'success': False, 'status': 'phone_conflict',
                            'error': 'Этот номер телефона уже привязан к другому аккаунту VK.'
                        }, status=409)
                    
                    phone_user.vk_user_id = vk_id
                    phone_user.vk_access_token = access_token or ''
                    if first_name:
                        phone_user.first_name = first_name
                    if last_name:
                        phone_user.last_name = last_name
                    phone_user.save()
                    phone_user.backend = 'core.auth_backend.PhoneAuthBackend'
                    login(request, phone_user)
                    return JsonResponse({
                        'success': True, 'status': 'phone_linked', 'created': False,
                        'redirect_url': '/dashboard/',
                    })
            
            # v4: Телефон не совпал / не предоставлен → ambiguous
            return JsonResponse({
                'success': False, 'status': 'ambiguous',
                'vk_user_id': vk_id,
                'vk_phone': vk_phone,
                'first_name': first_name or validated_data['first_name'],
                'last_name': last_name or validated_data['last_name'],
            })
            
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Ошибка: {str(e)}'}, status=500)


@require_http_methods(["POST"])
def vk_create_user(request):
    """Создание нового пользователя по данным из VK (после ambiguous)"""
    try:
        data = json.loads(request.body)
        vk_user_id = data.get('vk_user_id', '')
        first_name = data.get('first_name', '')
        last_name = data.get('last_name', '')
        phone = data.get('phone', '')
        access_token = data.get('access_token', '')
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'Неверный формат данных'}, status=400)
    
    if not vk_user_id:
        return JsonResponse({'success': False, 'error': 'Отсутствует VK ID'}, status=400)
    
    # Проверяем, не занят ли vk_user_id
    if User.objects.filter(vk_user_id=vk_user_id).exists():
        return JsonResponse({'success': False, 'error': 'Этот VK ID уже привязан к другому аккаунту.'}, status=409)
    
    normalized_phone = normalize_phone(phone) if phone else ''
    
    try:
        with transaction.atomic():
            if not normalized_phone:
                return JsonResponse({
                    'success': False, 'error': 'Не удалось получить номер телефона из VK. Укажите номер вручную.',
                    'need_phone': True,
                }, status=400)
            
            user = User.objects.create_user(
                username=normalized_phone,
                first_name=first_name,
                last_name=last_name,
                phone=normalized_phone,
                vk_user_id=vk_user_id,
                vk_access_token=access_token or '',
            )
            
            default_settings = UserDefaultSettings.get_defaults()
            user.role = default_settings.default_role
            user.balance = default_settings.default_balance
            user.save()
            
            if default_settings.default_tariffs.exists():
                user.allowed_tariffs.set(default_settings.default_tariffs.all())
            if default_settings.default_groups.exists():
                user.groups.set(default_settings.default_groups.all())
            
            user.backend = 'core.auth_backend.PhoneAuthBackend'
            login(request, user)
            return JsonResponse({
                'success': True, 'created': True, 'redirect_url': '/dashboard/',
            })
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Ошибка: {str(e)}'}, status=500)


@require_http_methods(["POST"])
def vk_link_existing(request):
    """Привязка VK к существующему аккаунту по телефону + паролю"""
    try:
        data = json.loads(request.body)
        vk_user_id = data.get('vk_user_id', '')
        phone = data.get('phone', '')
        password = data.get('password', '')
        access_token = data.get('access_token', '')
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'Неверный формат данных'}, status=400)
    
    if not vk_user_id or not phone or not password:
        return JsonResponse({'success': False, 'error': 'Заполните телефон и пароль'}, status=400)
    
    normalized_phone = normalize_phone(phone)
    user = User.objects.filter(phone=normalized_phone).first()
    if not user:
        return JsonResponse({'success': False, 'error': 'Пользователь с таким телефоном не найден.'}, status=404)
    
    if user.vk_user_id:
        return JsonResponse({'success': False, 'error': 'К этому аккаунту уже привязан VK ID.'}, status=409)
    
    # Проверяем пароль
    if not user.check_password(password):
        return JsonResponse({'success': False, 'error': 'Неверный пароль.'}, status=403)
    
    # Проверяем, не занят ли vk_user_id кем-то другим
    if User.objects.filter(vk_user_id=vk_user_id).exclude(id=user.id).exists():
        return JsonResponse({'success': False, 'error': 'Этот VK ID уже привязан к другому аккаунту.'}, status=409)
    
    user.vk_user_id = vk_user_id
    user.vk_access_token = access_token or ''
    user.save()
    user.backend = 'core.auth_backend.PhoneAuthBackend'
    login(request, user)
    return JsonResponse({
        'success': True, 'status': 'linked', 'redirect_url': '/dashboard/',
    })


@login_required
@require_http_methods(["POST"])
def vk_toggle_link(request):
    """Привязка/отвязка VK в профиле (пользователь уже залогинен)"""
    try:
        data = json.loads(request.body) if request.body else {}
    except (json.JSONDecodeError, ValueError):
        data = {}
    
    action = data.get('action', 'unlink')
    
    if action == 'unlink':
        if not request.user.phone:
            return JsonResponse({'success': False, 'error': 'Укажите номер телефона в профиле перед отвязкой VK.'}, status=400)
        request.user.vk_user_id = None
        request.user.vk_access_token = ''
        request.user.save()
        return JsonResponse({'success': True, 'message': 'VK ID отвязан.'})
    
    return JsonResponse({'success': False, 'error': 'Неизвестное действие.'}, status=400)


@require_http_methods(["POST"])
@csrf_exempt
def vk_auth_test(request):
    """
    Тестовый обработчик VK-авторизации.
    Дублирует логику vk_auth, но БЕЗ вызовов VK API.
    Доступен ТОЛЬКО при DEBUG=True.
    """
    if not settings.DEBUG:
        return JsonResponse({'success': False, 'error': 'Not available'}, status=403)

    try:
        data = json.loads(request.body)
        user_id = data.get('user_id')
        first_name = data.get('first_name', '')
        last_name = data.get('last_name', '')
        phone = data.get('phone', '')
        access_token = data.get('access_token', 'test_token')
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'Неверный формат данных'}, status=400)

    if not user_id:
        return JsonResponse({'success': False, 'error': 'user_id обязателен'}, status=400)

    vk_id = str(user_id)
    validated_data = {'vk_id': vk_id, 'first_name': first_name, 'last_name': last_name}

    if request.user.is_authenticated:
        if User.objects.filter(vk_user_id=vk_id).exclude(id=request.user.id).exists():
            return JsonResponse({'success': False, 'error': 'Этот VK ID уже привязан к другому аккаунту.'}, status=409)
        request.user.vk_user_id = vk_id
        request.user.vk_access_token = access_token
        if first_name:
            request.user.first_name = first_name
        if last_name:
            request.user.last_name = last_name
        request.user.save()
        return JsonResponse({'success': True, 'status': 'linked', 'redirect_url': '/profile/'})

    try:
        with transaction.atomic():
            user = User.objects.filter(vk_user_id=vk_id).first()
            if user:
                if first_name:
                    user.first_name = first_name
                if last_name:
                    user.last_name = last_name
                user.vk_access_token = access_token
                user.save()
                user.backend = 'core.auth_backend.PhoneAuthBackend'
                login(request, user)
                return JsonResponse({
                    'success': True, 'status': 'linked', 'created': False,
                    'redirect_url': '/dashboard/',
                })

            vk_phone = normalize_phone(phone) if phone else ''

            if vk_phone:
                phone_user = User.objects.filter(phone=vk_phone).first()
                if phone_user:
                    if phone_user.vk_user_id:
                        return JsonResponse({
                            'success': False, 'status': 'phone_conflict',
                            'error': 'Этот номер телефона уже привязан к другому аккаунту VK.'
                        }, status=409)

                    phone_user.vk_user_id = vk_id
                    phone_user.vk_access_token = access_token
                    if first_name:
                        phone_user.first_name = first_name
                    if last_name:
                        phone_user.last_name = last_name
                    phone_user.save()
                    phone_user.backend = 'core.auth_backend.PhoneAuthBackend'
                    login(request, phone_user)
                    return JsonResponse({
                        'success': True, 'status': 'phone_linked', 'created': False,
                        'redirect_url': '/dashboard/',
                    })

            return JsonResponse({
                'success': False, 'status': 'ambiguous',
                'vk_user_id': vk_id,
                'vk_phone': vk_phone,
                'first_name': first_name,
                'last_name': last_name,
            })

    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Ошибка: {str(e)}'}, status=500)


@csrf_exempt
def test_user_info(request):
    """Тестовый эндпоинт — информация о пользователе по телефону. Только DEBUG."""
    if not settings.DEBUG:
        return JsonResponse({'error': 'Not available'}, status=403)

    try:
        data = json.loads(request.body)
        phone = data.get('phone', '')
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Неверный формат данных'}, status=400)

    if not phone:
        return JsonResponse({'error': 'phone обязателен'}, status=400)

    vk_phone = normalize_phone(phone) if phone else ''
    user = User.objects.filter(phone=vk_phone).first() if vk_phone else None

    if not user:
        return JsonResponse({'exists': False})

    booking_count = Booking.objects.filter(client=user).count()
    subscription_count = Subscription.objects.filter(client=user).count()

    return JsonResponse({
        'exists': True,
        'id': user.id,
        'username': user.username,
        'first_name': user.first_name,
        'last_name': user.last_name,
        'balance': str(user.balance),
        'vk_user_id': user.vk_user_id or '',
        'booking_count': booking_count,
        'subscription_count': subscription_count,
    })


@csrf_exempt
def test_delete_user(request):
    """Тестовый эндпоинт — удаление пользователя по телефону. Только DEBUG."""
    if not settings.DEBUG:
        return JsonResponse({'error': 'Not available'}, status=403)

    try:
        data = json.loads(request.body)
        phone = data.get('phone', '')
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Неверный формат данных'}, status=400)

    if not phone:
        return JsonResponse({'error': 'phone обязателен'}, status=400)

    vk_phone = normalize_phone(phone) if phone else ''
    deleted, _ = User.objects.filter(phone=vk_phone).delete() if vk_phone else (0, {})

    return JsonResponse({'deleted': deleted})


@csrf_exempt
def test_create_notifications(request):
    """Тестовый эндпоинт — создание непрочитанных уведомлений по телефону. Только DEBUG."""
    if not settings.DEBUG:
        return JsonResponse({'error': 'Not available'}, status=403)

    try:
        data = json.loads(request.body)
        phone = data.get('phone', '')
        count = int(data.get('count', 1))
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Неверный формат данных'}, status=400)

    if not phone:
        return JsonResponse({'error': 'phone обязателен'}, status=400)

    vk_phone = normalize_phone(phone) if phone else ''
    user = User.objects.filter(phone=vk_phone).first() if vk_phone else None
    if not user:
        return JsonResponse({'error': 'Пользователь не найден'}, status=404)

    count = max(0, min(count, 50))
    InAppNotification.objects.bulk_create([
        InAppNotification(
            user=user,
            notification_type=InAppNotification.TYPE_NEWS,
            title=f'Тест-уведомление №{i}',
            message=f'Сообщение тестового уведомления №{i}',
        ) for i in range(1, count + 1)
    ])

    return JsonResponse({'success': True, 'created': count})


@csrf_exempt
def test_delete_notifications(request):
    """Тестовый эндпоинт — удаление всех уведомлений пользователя по телефону. Только DEBUG."""
    if not settings.DEBUG:
        return JsonResponse({'error': 'Not available'}, status=403)

    try:
        data = json.loads(request.body)
        phone = data.get('phone', '')
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Неверный формат данных'}, status=400)

    if not phone:
        return JsonResponse({'error': 'phone обязателен'}, status=400)

    vk_phone = normalize_phone(phone) if phone else ''
    deleted, _ = InAppNotification.objects.filter(user__phone=vk_phone).delete() if vk_phone else (0, {})

    return JsonResponse({'deleted': deleted})


@require_http_methods(["POST"])
@csrf_exempt
def test_my_info(request):
    """Текущий пользователь: баланс и активный абонемент. Только DEBUG."""
    if not settings.DEBUG:
        return JsonResponse({'error': 'Not available'}, status=403)
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Not authenticated'}, status=401)

    active_sub = Subscription.objects.filter(
        client=request.user, status='active'
    ).first()

    return JsonResponse({
        'balance': str(request.user.balance),
        'subscription': {
            'id': active_sub.id,
            'sessions_total': active_sub.sessions_total,
            'sessions_remaining': active_sub.sessions_remaining,
            'tariff_id': active_sub.tariff_id,
            'tariff_name': active_sub.tariff.name,
            'status': active_sub.status,
            'expires_at': active_sub.expires_at.isoformat() if active_sub.expires_at else None,
        } if active_sub else None,
    })


@require_http_methods(["POST"])
@csrf_exempt
def test_set_allowed_tariffs(request):
    """Установка allowed_tariffs для пользователя. Только DEBUG, staff."""
    if not settings.DEBUG:
        return JsonResponse({'error': 'Not available'}, status=403)
    if not request.user.is_staff:
        return JsonResponse({'error': 'Staff only'}, status=403)

    try:
        data = json.loads(request.body)
        user_id = data.get('user_id')
        tariff_ids = data.get('tariff_ids', [])
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    if not user_id:
        return JsonResponse({'error': 'user_id required'}, status=400)

    user = get_object_or_404(User, id=user_id)
    user.allowed_tariffs.set(tariff_ids)

    return JsonResponse({'success': True})


@require_http_methods(["POST"])
@csrf_exempt
def test_delete_subscriptions(request):
    """Удаление всех подписок пользователя. Только DEBUG, staff."""
    if not settings.DEBUG:
        return JsonResponse({'error': 'Not available'}, status=403)
    if not request.user.is_staff:
        return JsonResponse({'error': 'Staff only'}, status=403)

    try:
        data = json.loads(request.body)
        user_id = data.get('user_id')
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    if not user_id:
        return JsonResponse({'error': 'user_id required'}, status=400)

    deleted, _ = Subscription.objects.filter(client_id=user_id).delete()

    return JsonResponse({'deleted': deleted})


@require_http_methods(["POST"])
@csrf_exempt
def test_set_balance(request):
    """Установка баланса пользователя. Только DEBUG, staff."""
    if not settings.DEBUG:
        return JsonResponse({'error': 'Not available'}, status=403)
    if not request.user.is_staff:
        return JsonResponse({'error': 'Staff only'}, status=403)

    try:
        data = json.loads(request.body)
        user_id = data.get('user_id')
        balance = data.get('balance')
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    if not user_id or balance is None:
        return JsonResponse({'error': 'user_id and balance required'}, status=400)

    user = get_object_or_404(User, id=user_id)
    user.balance = Decimal(str(balance))
    user.save()

    return JsonResponse({'success': True, 'balance': str(user.balance)})


@require_http_methods(["POST"])
@csrf_exempt
def test_authenticate(request):
    """Проверка аутентификации по username/телефону (как Client.login()). Только DEBUG."""
    if not settings.DEBUG:
        return JsonResponse({'error': 'Not available'}, status=403)

    try:
        data = json.loads(request.body)
        username = data.get('username', '')
        password = data.get('password', '')
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    from django.contrib.auth import authenticate

    user = authenticate(username=username, password=password)
    if not user:
        return JsonResponse({'success': False})

    return JsonResponse({'success': True, 'role': user.role, 'username': user.username})


@require_http_methods(["POST"])
@csrf_exempt
def test_move_session_to_past(request):
    """Перенос занятия в прошлое (для проверки дедлайнов). Только DEBUG, staff."""
    if not settings.DEBUG:
        return JsonResponse({'error': 'Not available'}, status=403)
    if not request.user.is_staff:
        return JsonResponse({'error': 'Staff only'}, status=403)

    try:
        data = json.loads(request.body)
        session_id = data.get('session_id')
        minutes = int(data.get('minutes', 60))
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    if not session_id:
        return JsonResponse({'error': 'session_id required'}, status=400)

    session = get_object_or_404(ClassSession, id=session_id)
    session.date_time = datetime.now() - timedelta(minutes=minutes)
    session.save()

    return JsonResponse({'success': True, 'date_time': session.date_time.isoformat()})


@require_http_methods(["POST"])
@csrf_exempt
def test_expire_subscription(request):
    """Протухание абонемента (expires_at в прошлом). Только DEBUG, staff."""
    if not settings.DEBUG:
        return JsonResponse({'error': 'Not available'}, status=403)
    if not request.user.is_staff:
        return JsonResponse({'error': 'Staff only'}, status=403)

    try:
        data = json.loads(request.body)
        subscription_id = data.get('subscription_id')
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    if not subscription_id:
        return JsonResponse({'error': 'subscription_id required'}, status=400)

    subscription = get_object_or_404(Subscription, id=subscription_id)
    validity_days = subscription.tariff.subscription_validity_days or 30
    now = datetime.now()
    subscription.activated_at = now - timedelta(days=validity_days + 1)
    subscription.expires_at = now - timedelta(days=1)
    subscription.save()

    return JsonResponse({
        'success': True,
        'activated_at': subscription.activated_at.isoformat() if subscription.activated_at else None,
        'expires_at': subscription.expires_at.isoformat() if subscription.expires_at else None,
    })


@require_http_methods(["POST"])
@csrf_exempt
def test_set_attendance(request):
    """Создание прошедшего занятия с посещаемостью (история/тепловая карта). Только DEBUG, staff."""
    if not settings.DEBUG:
        return JsonResponse({'error': 'Not available'}, status=403)
    if not request.user.is_staff:
        return JsonResponse({'error': 'Staff only'}, status=403)

    try:
        data = json.loads(request.body)
        user_id = data.get('user_id')
        session_id = data.get('session_id')
        minutes = int(data.get('minutes', 1440))  # сутки назад по умолчанию
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    if not user_id or not session_id:
        return JsonResponse({'error': 'user_id and session_id required'}, status=400)

    client = get_object_or_404(User, id=user_id)
    session = get_object_or_404(ClassSession, id=session_id)

    # Занятие в прошлом, чтобы попасть в "историю посещений"
    session.date_time = datetime.now() - timedelta(minutes=minutes)
    session.save()

    attendance, created = Attendance.objects.update_or_create(
        session=session,
        client=client,
        defaults={'status': 'attended', 'visited_at': session.date_time},
    )

    return JsonResponse({
        'success': True,
        'attendance_id': attendance.id,
        'created': created,
        'session_date_time': session.date_time.isoformat(),
    })


@require_http_methods(["POST"])
@csrf_exempt
def test_set_hall_colors(request):
    """Установка цвета фона/текста зала. Только DEBUG, staff."""
    if not settings.DEBUG:
        return JsonResponse({'error': 'Not available'}, status=403)
    if not request.user.is_staff:
        return JsonResponse({'error': 'Staff only'}, status=403)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    hall_id = data.get('hall_id')
    if not hall_id:
        return JsonResponse({'error': 'hall_id required'}, status=400)

    hall = get_object_or_404(Hall, id=hall_id)

    if 'color' in data:
        hall.color = data['color'] or ''
    if 'text_color' in data:
        hall.text_color = data['text_color'] or ''
    if 'color' in data or 'text_color' in data:
        hall.save()

    return JsonResponse({'success': True, 'hall': {
        'id': hall.id,
        'color': hall.color,
        'text_color': hall.text_color,
        'effective_text_color': hall.get_effective_text_color(),
    }})


@csrf_exempt
def test_tariffs(request):
    """Каталог тарифов (для стабильных тестов — без хардкода id). Только DEBUG."""
    if not settings.DEBUG:
        return JsonResponse({'error': 'Not available'}, status=403)

    tariffs = []
    for t in Tariff.objects.all().order_by('id'):
        tariffs.append({
            'id': t.id,
            'name': t.name,
            'tariff_type': t.tariff_type,
            'price_per_person': float(t.price_per_person),
            'split_total_price': float(t.split_total_price),
            'is_active': t.is_active,
            'is_subscription_available': t.is_subscription_available,
            'subscription_price': float(t.subscription_price),
            'subscription_sessions_count': t.subscription_sessions_count,
            'subscription_validity_days': t.subscription_validity_days,
            'group_id': t.group_id,
        })
    return JsonResponse({'tariffs': tariffs})


@login_required
def shop_view(request):
    """Магазин — пополнение баланса и покупка абонементов"""
    client = request.user

    active_subscriptions = Subscription.objects.filter(
        client=client,
        status='active'
    ).select_related('tariff').order_by('-purchased_at')

    subscription_remaining = sum(sub.sessions_remaining for sub in active_subscriptions)

    # Показываем все тарифы с абонементами; недоступные — серыми (allowed_tariff_ids управляет доступом)
    available_tariffs_with_subscriptions = Tariff.objects.filter(
        is_subscription_available=True,
        is_active=True
    )
    if client.is_moderator:
        allowed_tariff_ids = list(available_tariffs_with_subscriptions.values_list('id', flat=True))
    else:
        allowed_tariff_ids = list(client.allowed_tariffs.values_list('id', flat=True))

    context = {
        'client': client,
        'active_subscriptions': active_subscriptions,
        'subscription_remaining': subscription_remaining,
        'available_tariffs_with_subscriptions': available_tariffs_with_subscriptions,
        'allowed_tariff_ids': allowed_tariff_ids,
    }
    return render(request, 'core/shop.html', context)


@login_required
def about_view(request):
    """Страница с реквизитами студии и пользовательским соглашением"""
    return render(request, 'core/about.html')


@login_required
@require_http_methods(["POST"])
def top_up_balance_view(request):
    """Пополнение баланса через ЮKassa"""
    client = request.user

    try:
        data = json.loads(request.body)
        amount = float(data.get('amount', 0))

        if amount <= 0:
            return JsonResponse({'error': 'Сумма должна быть больше 0'}, status=400)
        if amount > 100000:
            return JsonResponse({'error': 'Сумма не может превышать 100 000 ₽'}, status=400)

        result = create_payment(
            amount=Decimal(str(amount)),
            description=f'Пополнение баланса — {client.first_name or client.username}',
            return_url=f'{settings.SITE_URL}/shop/',
            metadata={'action': 'topup', 'user_id': str(client.id), 'amount': str(amount)},
        )

        return JsonResponse({
            'success': True,
            'confirmation_token': result['confirmation_token'],
            'payment_id': result['payment_id'],
        })
    except ValueError as e:
        return JsonResponse({'error': str(e)}, status=400)
    except Exception as e:
        return JsonResponse({'error': f'Ошибка создания платежа: {str(e)}'}, status=500)


@login_required
@require_http_methods(["POST"])
def purchase_subscription_view(request):
    """Покупка абонемента (с баланса или через пополнение)"""
    client = request.user
    
    try:
        data = json.loads(request.body)
        tariff_id = data.get('tariff_id')
        
        if not tariff_id:
            return JsonResponse({'error': 'ID тарифа обязателен'}, status=400)
        
        tariff = get_object_or_404(Tariff, id=tariff_id)
        
        if not tariff.is_subscription_available:
            return JsonResponse({'error': 'Для этого тарифа недоступны абонементы'}, status=400)
        
        # Проверка доступа: тариф (или его группа) должен быть доступен клиенту
        allowed_ids = set(client.allowed_tariffs.values_list('id', flat=True))
        if not (set(PaymentService.effective_tariff_ids(tariff)) & allowed_ids):
            return JsonResponse({'error': 'У вас нет доступа к этому тарифу'}, status=403)
        
        if Subscription.objects.filter(client=client, status='active', sessions_remaining__gt=0).exists():
            return JsonResponse({'error': 'У вас уже есть активный абонемент. Дождитесь его окончания, чтобы купить новый.'}, status=400)
        
        if client.balance >= tariff.subscription_price:
            PaymentService.purchase_subscription(client, tariff)
            return JsonResponse({'success': True, 'balance_used': True})
        else:
            return JsonResponse({
                'error': 'Недостаточно средств. Пополните баланс.',
                'need_top_up': True,
                'price': float(tariff.subscription_price),
                'balance': float(client.balance),
            }, status=400)
            
    except ValueError as e:
        return JsonResponse({'error': str(e)}, status=400)
    except Exception as e:
        return JsonResponse({'error': f'Ошибка: {str(e)}'}, status=500)


@login_required
@require_http_methods(["POST"])
def request_tariff_access_view(request):
    """Отправка администратору в VK запроса на доступ к тарифу (кнопка на недоступной карточке)"""
    client = request.user

    try:
        data = json.loads(request.body)
        tariff_id = data.get('tariff_id')
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Неверный формат данных'}, status=400)

    if not tariff_id:
        return JsonResponse({'error': 'ID тарифа обязателен'}, status=400)

    tariff = get_object_or_404(Tariff, id=tariff_id)
    if not tariff.is_subscription_available:
        return JsonResponse({'error': 'Для этого тарифа недоступны абонементы'}, status=400)
    allowed_ids = set(client.allowed_tariffs.values_list('id', flat=True))
    if set(PaymentService.effective_tariff_ids(tariff)) & allowed_ids:
        return JsonResponse({'error': 'Тариф уже доступен вам'}, status=400)

    # Антиспам: не чаще одного запроса в минуту по этому тарифу
    last_requests = request.session.get('tariff_access_requests', {})
    now = timezone.now().timestamp()
    if last_requests.get(str(tariff_id), 0) > now - 60:
        return JsonResponse({'success': False, 'error': 'Запрос уже отправлен. Попробуйте чуть позже.'}, status=400)

    admins = User.objects.filter(role='admin', vk_user_id__isnull=False).exclude(vk_user_id='')
    if not admins.exists():
        return JsonResponse({'success': False, 'error': 'Не удалось отправить запрос: администратор не подключён к VK.'}, status=200)

    client_name = client.get_full_name() or client.phone or client.username
    admin_link = request.build_absolute_uri(f'/admin/core/user/{client.id}/change/')
    msg = (
        f"Студент {client_name} ({client.phone}) запрашивает доступ к тарифу «{tariff.name}» "
        f"({tariff.subscription_price} ₽, {tariff.subscription_sessions_count} занятий).\n"
        f"Выдать доступ: {admin_link}"
    )

    for admin in admins:
        send_vk_message(admin.vk_user_id, msg)

    last_requests[str(tariff_id)] = now
    request.session['tariff_access_requests'] = last_requests

    return JsonResponse({'success': True, 'message': 'Запрос отправлен администратору'})


@login_required
@require_http_methods(["POST"])
def renew_subscription_view(request):
    """Продление абонемента (с баланса или через пополнение)"""
    client = request.user

    try:
        data = json.loads(request.body)
        subscription_id = data.get('subscription_id')

        if not subscription_id:
            return JsonResponse({'error': 'ID абонемента обязателен'}, status=400)

        subscription = get_object_or_404(Subscription, id=subscription_id, client=client)

        if not PaymentService.can_renew_subscription(subscription):
            return JsonResponse({'error': 'Абонемент нельзя продлить'}, status=400)

        price = subscription.tariff.subscription_price
        if client.balance >= price:
            PaymentService.renew_subscription(subscription)
            return JsonResponse({'success': True, 'balance_used': True})
        else:
            return JsonResponse({
                'error': 'Недостаточно средств. Пополните баланс.',
                'need_top_up': True,
                'price': float(price),
                'balance': float(client.balance),
            }, status=400)
            
    except ValueError as e:
        return JsonResponse({'error': str(e)}, status=400)
    except Exception as e:
        return JsonResponse({'error': f'Ошибка: {str(e)}'}, status=500)


@login_required
def news_list(request):
    if not request.user.is_moderator:
        return redirect('/')
    all_news = News.objects.all()
    return render(request, 'core/news_list.html', {'news_list': all_news})


@login_required
def news_create(request):
    if not request.user.is_moderator:
        return redirect('/')
    form = NewsForm(request.POST or None, request.FILES or None)
    if request.method == 'POST' and form.is_valid():
        news = form.save(commit=False)
        news.created_by = request.user
        news.save()
        form.save_m2m()
        if news.is_published:
            from .vk_bot import send_notification_to_all_allowed
            msg = f'🆕 {news.title}\n\n{news.content[:300]}'
            if news.news_type == 'tour':
                msg += '\n\nЗапись на тур в магазине студии.'
            send_notification_to_all_allowed(msg)
            # Создаём уведомления в приложении для всех активных пользователей
            active_users = User.objects.filter(is_active=True)
            InAppNotification.objects.bulk_create([
                InAppNotification(
                    user=user,
                    notification_type=InAppNotification.TYPE_NEWS,
                    title=news.title,
                    message=news.content[:200] if news.content else '',
                    link='/news/',
                ) for user in active_users
            ])
        return redirect('news_list')
    return render(request, 'core/news_form.html', {'form': form})


@login_required
def news_edit(request, pk):
    if not request.user.is_moderator:
        return redirect('/')
    news = get_object_or_404(News, pk=pk)
    form = NewsForm(request.POST or None, request.FILES or None, instance=news)
    if request.method == 'POST' and form.is_valid():
        form.save()
        return redirect('news_list')
    return render(request, 'core/news_form.html', {'form': form, 'object': news})


@login_required
def news_delete(request, pk):
    if not request.user.is_moderator:
        return redirect('/')
    news = get_object_or_404(News, pk=pk)
    if request.method == 'POST':
        news.delete()
        return redirect('news_list')
    return render(request, 'core/news_confirm_delete.html', {'object': news})


@login_required
@require_http_methods(["POST"])
def vk_test_message(request):
    """Отправляет тестовое сообщение в VK текущему пользователю"""
    vk_user_id = request.user.vk_user_id
    if not vk_user_id:
        return JsonResponse({'success': False, 'error': 'VK не привязан'}, status=400)
    sent = send_vk_message(vk_user_id, 'Тестовое сообщение! Ваш профиль CRM работает корректно.')
    if sent:
        return JsonResponse({'success': True})
    return JsonResponse({'success': False, 'error': 'Не удалось отправить сообщение'}, status=500)


@csrf_exempt
def vk_callback(request):
    if request.method != 'POST':
        return HttpResponse('Method not allowed', status=405)
    try:
        event = json.loads(request.body)
    except json.JSONDecodeError:
        return HttpResponse('Bad request', status=400)
    result = handle_callback(event)
    return HttpResponse(str(result), content_type='text/plain')


def index(request):
    if request.user.is_authenticated:
        return redirect('home')
    tariffs = Tariff.objects.filter(is_active=True, show_on_homepage=True).order_by('subscription_price')
    class_types = ClassType.objects.all()
    news_list = News.objects.filter(is_published=True).order_by('-published_at')[:3]
    return render(request, 'core/landing.html', {
        'tariffs': tariffs,
        'class_types': class_types,
        'news_list': news_list,
    })


@csrf_exempt
@require_http_methods(["POST"])
def yookassa_callback(request):
    """Webhook от ЮKassa — подтверждение оплаты"""
    try:
        metadata = yookassa_handle_callback(request.body)
        if not metadata:
            return HttpResponse('ignored', content_type='text/plain')

        action = metadata.get('action')
        user_id = metadata.get('user_id')
        if not action or not user_id:
            log_msg(f'Callback view: invalid metadata — action={action}, user_id={user_id}, metadata={metadata}')
            return HttpResponse('invalid metadata', status=400)

        user = User.objects.get(id=user_id)

        payment_id = metadata.get('payment_id', '')
        if payment_id and PaymentTransaction.objects.filter(comment__contains=payment_id).exists():
            log_msg(f'Callback view: duplicate payment_id={payment_id}')
            return HttpResponse('duplicate', content_type='text/plain')

        if action == 'topup':
            amount = Decimal(metadata.get('amount', '0'))
            PaymentService.deposit_balance(user, amount, f'Пополнение через ЮKassa #{payment_id}')
            log_msg(f'Callback view: topup user_id={user_id} amount={amount} payment_id={payment_id}')

        elif action == 'purchase_subscription':
            tariff_id = metadata.get('tariff_id')
            tariff = Tariff.objects.get(id=tariff_id)
            PaymentService.purchase_subscription(user, tariff, comment=f'Оплата через ЮKassa #{payment_id}')
            log_msg(f'Callback view: purchase user_id={user_id} tariff_id={tariff_id} payment_id={payment_id}')

        elif action == 'renew_subscription':
            sub_id = metadata.get('subscription_id')
            sub = Subscription.objects.get(id=sub_id, client=user)
            PaymentService.renew_subscription(sub, comment=f'Продление через ЮKassa #{payment_id}')
            log_msg(f'Callback view: renew user_id={user_id} sub_id={sub_id} payment_id={payment_id}')

        else:
            log_msg(f'Callback view: unknown action={action}')
            return HttpResponse(f'unknown action: {action}', status=400)

        if payment_id:
            last_txn = PaymentTransaction.objects.filter(client=user).last()
            if last_txn:
                last_txn.comment = (last_txn.comment or '') + f' [yk:{payment_id}]'
                last_txn.save(update_fields=['comment'])

        return HttpResponse('200 OK', content_type='text/plain')

    except User.DoesNotExist:
        log_msg(f'Callback view: user not found')
        return HttpResponse('user not found', status=404)
    except Exception as e:
        log_msg(f'Callback view: ERROR {e}')
        return HttpResponse(f'error: {str(e)}', status=500)


@login_required
def get_notifications(request):
    limit = int(request.GET.get('limit', 20))
    notifications = InAppNotification.objects.filter(user=request.user)[:limit]
    data = [{
        'id': n.id,
        'type': n.notification_type,
        'title': n.title,
        'message': n.message,
        'link': n.link,
        'is_read': n.is_read,
        'created_at': n.created_at.strftime('%d.%m.%Y %H:%M'),
    } for n in notifications]
    return JsonResponse({'notifications': data})


@login_required
@require_http_methods(["POST"])
def mark_notification_read(request, pk):
    notification = get_object_or_404(InAppNotification, pk=pk, user=request.user)
    notification.is_read = True
    notification.save(update_fields=['is_read'])
    return JsonResponse({'success': True})


@login_required
@require_http_methods(["POST"])
def mark_all_notifications_read(request):
    InAppNotification.objects.filter(user=request.user, is_read=False).update(is_read=True)
    return JsonResponse({'success': True})


@login_required
def unread_notification_count(request):
    count = InAppNotification.objects.filter(user=request.user, is_read=False).count()
    return JsonResponse({'count': count})
