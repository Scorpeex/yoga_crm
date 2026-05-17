import json
from django.shortcuts import render, get_object_or_404, redirect
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.contrib.auth import login, logout, authenticate
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.db import transaction
from datetime import datetime, timedelta
from django.utils import timezone
import pytz
from django.conf import settings
from .models import ClassSession, Hall, ClassType, User, Attendance
from .forms import RegistrationForm, LoginForm
from .telegram_auth import validate_telegram_auth_data
from .vk_auth import validate_vk_auth_data
from django.db.models import Q


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


def calendar_view(request):
    """Отображение календаря занятий"""
    halls = Hall.objects.all()
    class_types = ClassType.objects.all()
    
    # Проверяем права пользователя
    is_moderator = False
    is_admin = False
    
    if request.user.is_authenticated:
        # Проверяем суперадмина Django
        if request.user.is_superuser:
            is_admin = True
        # Проверяем профиль клиента
        elif hasattr(request.user, 'client_profile'):
            client = request.user.client_profile
            is_moderator = client.is_moderator
            is_admin = client.is_admin
    
    return render(request, 'core/calendar.html', {
        'halls': halls,
        'class_types': class_types,
        'is_moderator': is_moderator,
        'is_admin': is_admin,
        'user_role': 'admin' if is_admin else ('moderator' if is_moderator else 'student'),
    })


def get_events(request):
    """Получение событий для календаря (JSON)"""
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
    
    # Фильтрация по доступным тарифам для обычных пользователей
    if request.user.is_authenticated:
        # Админы и модераторы видят все занятия
        if not request.user.is_moderator:
            # Получаем IDs доступных тарифов пользователя
            allowed_tariff_ids = list(request.user.allowed_tariffs.values_list('id', flat=True))
            if allowed_tariff_ids:
                sessions = sessions.filter(tariff_id__in=allowed_tariff_ids)
            else:
                # Если у пользователя нет доступных тарифов, показываем пустой список
                sessions = ClassSession.objects.none()
    
    events = []
    
    for session in sessions:
        # Время хранится как локальное (без timezone info), используем его напрямую
        local_dt = session.date_time
        
        # Получаем max_participants из тарифа или устанавливаем по умолчанию
        max_participants = session.tariff.max_participants if session.tariff else 10
        
        events.append({
            'id': str(session.id),
            'title': f"{session.class_type.name}",
            'start': local_dt.strftime('%Y-%m-%dT%H:%M:%S'),
            'end': (local_dt + timedelta(minutes=session.duration)).strftime('%Y-%m-%dT%H:%M:%S'),
            'allDay': False,
            'backgroundColor': session.hall.color if session.hall else '#4ECDC4',
            'borderColor': session.hall.color if session.hall else '#4ECDC4',
            'extendedProps': {
                'hall_id': session.hall.id if session.hall else None,
                'hall_name': session.hall.name if session.hall else '',
                'duration': session.duration,
                'max_participants': max_participants,
                'description': session.class_type.description if session.class_type.description else '',
                'is_recurring': session.is_recurring,
                'recurrence_id': session.recurrence_id or ''
            }
        })
    
    return JsonResponse(events, safe=False)


@require_http_methods(["POST"])
def create_event(request):
    """Создание нового занятия (только для модераторов и админов)"""
    # Проверка прав доступа
    if not request.user.is_authenticated or not hasattr(request.user, 'client_profile'):
        return JsonResponse({'error': 'Доступ запрещен'}, status=403)
    
    client = request.user.client_profile
    if not client.is_moderator:
        return JsonResponse({'error': 'Доступ запрещен. Только модераторы и администраторы могут создавать занятия'}, status=403)
    
    try:
        data = json.loads(request.body)
        class_type_id = data.get('class_type_id')
        start = data.get('start')
        hall_id = data.get('hall_id')
        duration = data.get('duration')
        max_participants = data.get('max_participants', 20)
        is_recurring = data.get('is_recurring', False)
        
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
        
        session = ClassSession.objects.create(
            class_type=class_type,
            date_time=date_time,
            duration=duration,
            hall=hall,
            max_participants=max_participants,
            is_recurring=is_recurring,
        )
        
        # Если занятие повторяющееся, создаем события на 4 недели вперед
        created_events = [{'id': session.id, 'title': session.class_type.name, 
                          'start': session.date_time.strftime('%Y-%m-%dT%H:%M:%S'),
                          'end': (session.date_time + timedelta(minutes=session.duration)).strftime('%Y-%m-%dT%H:%M:%S')}]
        
        if is_recurring:
            for week in range(1, 5):  # Создаем 4 повторения (итого 5 занятий включая первое)
                new_date = date_time + timedelta(weeks=week)
                recurring_session = ClassSession.objects.create(
                    class_type=class_type,
                    date_time=new_date,
                    duration=duration,
                    hall=hall,
                    max_participants=max_participants,
                    is_recurring=True,
                    recurrence_id=session.recurrence_id,
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
    if not request.user.is_authenticated or not hasattr(request.user, 'client_profile'):
        return JsonResponse({'error': 'Доступ запрещен'}, status=403)
    
    client = request.user.client_profile
    if not client.is_moderator:
        return JsonResponse({'error': 'Доступ запрещен. Только модераторы и администраторы могут редактировать занятия'}, status=403)
    
    try:
        session = get_object_or_404(ClassSession, id=event_id)
        
        if request.method == "POST":
            data = json.loads(request.body)
        else:
            data = json.loads(request.body)
        
        if 'class_type_id' in data and data['class_type_id']:
            session.class_type = get_object_or_404(ClassType, id=data['class_type_id'])
        if 'start' in data:
            parsed_dt = parse_datetime_to_local(data['start'])
            if parsed_dt:
                session.date_time = parsed_dt
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
        if 'max_participants' in data:
            session.max_participants = data['max_participants']
        
        session.save()
        
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
    if not request.user.is_authenticated or not hasattr(request.user, 'client_profile'):
        return JsonResponse({'error': 'Доступ запрещен'}, status=403)
    
    client = request.user.client_profile
    if not client.is_moderator:
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
        
        if is_recurring and recurrence_id and not delete_single:
            # Если это повторяющееся занятие и не выбрано удаление одного события,
            # удаляем все последующие события этой серии
            ClassSession.objects.filter(
                recurrence_id=recurrence_id,
                date_time__gte=session.date_time
            ).delete()
        else:
            # Удаляем только одно событие
            session.delete()
            
        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


@require_http_methods(["GET"])
def get_attendance(request, session_id):
    """Получение списка посещаемости для занятия"""
    try:
        session = get_object_or_404(ClassSession, id=session_id)
        
        # Проверка прав доступа
        is_moderator = False
        current_user_client_id = None
        if request.user.is_authenticated and hasattr(request.user, 'client_profile'):
            client = request.user.client_profile
            is_moderator = client.is_moderator
            current_user_client_id = client.id
        
        # Получаем всех клиентов, записанных на это занятие
        attendances = Attendance.objects.filter(session=session).select_related('client')
        
        attendance_list = []
        for attendance in attendances:
            client_user = attendance.client.user
            attendance_data = {
                'id': attendance.id,
                'client_id': attendance.client.id,
                'client_name': f"{client_user.last_name if client_user else ''} {client_user.first_name if client_user else ''}".strip(),
                'client_phone': attendance.client.phone or '',
                'attended': attendance.status == 'attended',
                'is_current_user': attendance.client_id == current_user_client_id,
                'max_participants': session.max_participants,
                'role': attendance.client.role
            }
            attendance_list.append(attendance_data)
        
        return JsonResponse({
            'success': True,
            'attendances': attendance_list,
            'registered_count': len(attendance_list),
            'can_view_details': True
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


@require_http_methods(["POST"])
def update_attendance(request, session_id):
    """Обновление посещаемости для занятия (только для модераторов и админов)"""
    # Проверка прав доступа
    if not request.user.is_authenticated or not hasattr(request.user, 'client_profile'):
        return JsonResponse({'error': 'Доступ запрещен'}, status=403)
    
    client = request.user.client_profile
    if not client.is_moderator:
        return JsonResponse({'error': 'Доступ запрещен. Только модераторы и администраторы могут управлять посещаемостью'}, status=403)
    
    try:
        session = get_object_or_404(ClassSession, id=session_id)
        data = json.loads(request.body)
        
        # attended_client_ids - список ID клиентов, которые посетили занятие
        attended_client_ids = data.get('attended_clients', [])
        
        # Обновляем или создаем записи о посещении
        for client_id in attended_client_ids:
            client = get_object_or_404(User, id=client_id)
            attendance, created = Attendance.objects.get_or_create(
                session=session,
                client=client,
                defaults={'status': 'attended'}
            )
            if not created:
                attendance.status = 'attended'
                attendance.save()
        
        # Для клиентов, которые были записаны, но не отмечены - ставим статус no_show
        all_attendances = Attendance.objects.filter(session=session)
        for attendance in all_attendances:
            if attendance.client_id not in attended_client_ids:
                attendance.status = 'no_show'
                attendance.save()
        
        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


@require_http_methods(["POST"])
def enroll_to_class(request, session_id):
    """Запись пользователя на занятие"""
    # Проверка прав доступа
    if not request.user.is_authenticated or not hasattr(request.user, 'client_profile'):
        return JsonResponse({'error': 'Доступ запрещен. Требуется авторизация'}, status=403)
    
    client = request.user.client_profile
    
    try:
        session = get_object_or_404(ClassSession, id=session_id)
        
        # Проверяем время до занятия (не менее 4 часов)
        # При USE_TZ = False используем naive datetime для сравнения
        now = datetime.now()
        session_time = session.date_time
        time_until_class = session_time - now
        if time_until_class.total_seconds() < 4 * 3600:  # 4 часа в секундах
            return JsonResponse({'error': 'Запись возможна не позднее чем за 4 часа до начала занятия'}, status=400)
        
        # Проверяем, не записан ли уже клиент
        existing = Attendance.objects.filter(session=session, client=client).first()
        if existing:
            return JsonResponse({'error': 'Вы уже записаны на это занятие'}, status=400)
        
        # Проверяем наличие свободных мест
        current_count = Attendance.objects.filter(session=session).count()
        if current_count >= session.max_participants:
            return JsonResponse({'error': 'Нет свободных мест'}, status=400)
        
        # Создаем запись о посещении
        Attendance.objects.create(
            session=session,
            client=client,
            status='attended'
        )
        
        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


@require_http_methods(["POST"])
def cancel_enrollment(request, session_id):
    """Отмена записи пользователя на занятие"""
    # Проверка прав доступа
    if not request.user.is_authenticated or not hasattr(request.user, 'client_profile'):
        return JsonResponse({'error': 'Доступ запрещен. Требуется авторизация'}, status=403)
    
    client = request.user.client_profile
    
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
        attendance = Attendance.objects.filter(session=session, client=client).first()
        if not attendance:
            return JsonResponse({'error': 'Вы не записаны на это занятие'}, status=400)
        
        # Удаляем запись
        attendance.delete()
        
        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


@require_http_methods(["POST"])
def add_client_to_session(request, session_id):
    """Добавление клиента на занятие вручную (только для модераторов и админов)"""
    # Проверка прав доступа
    if not request.user.is_authenticated or not hasattr(request.user, 'client_profile'):
        return JsonResponse({'error': 'Доступ запрещен'}, status=403)
    
    client = request.user.client_profile
    if not client.is_moderator:
        return JsonResponse({'error': 'Доступ запрещен. Только модераторы и администраторы могут добавлять клиентов на занятия'}, status=403)
    
    try:
        session = get_object_or_404(ClassSession, id=session_id)
        data = json.loads(request.body)
        client_id = data.get('client_id')
        
        if not client_id:
            return JsonResponse({'error': 'ID клиента обязателен'}, status=400)
        
        client = get_object_or_404(User, id=client_id)
        
        # Проверяем, не записан ли уже клиент
        existing = Attendance.objects.filter(session=session, client=client).first()
        if existing:
            return JsonResponse({'error': 'Клиент уже записан на это занятие'}, status=400)
        
        # Создаем запись о посещении
        Attendance.objects.create(
            session=session,
            client=client,
            status='attended'
        )
        
        user = client.user
        return JsonResponse({
            'success': True,
            'client': {
                'id': client.id,
                'name': f"{user.last_name if user else ''} {user.first_name if user else ''}".strip(),
                'phone': client.phone or '',
                'role': client.role
            }
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


@require_http_methods(["GET"])
def search_clients(request):
    """Поиск клиентов по имени/фамилии/телефону (только для модераторов и админов)"""
    # Проверка прав доступа
    if not request.user.is_authenticated or not hasattr(request.user, 'client_profile'):
        return JsonResponse({'error': 'Доступ запрещен'}, status=403)
    
    client = request.user.client_profile
    if not client.is_moderator:
        return JsonResponse({'error': 'Доступ запрещен. Только модераторы и администраторы могут искать клиентов'}, status=403)
    
    try:
        query = request.GET.get('q', '')
        
        if not query:
            return JsonResponse({'clients': []})
        
        # Ищем по фамилии, имени или телефону
        clients = User.objects.filter(
            Q(user__first_name__icontains=query) |
            Q(user__last_name__icontains=query) |
            Q(phone__icontains=query)
        ).filter(is_active=True)[:10]  # Ограничиваем до 10 результатов
        
        client_list = []
        for client in clients:
            user = client.user
            client_list.append({
                'id': client.id,
                'name': f"{user.last_name if user else ''} {user.first_name if user else ''}".strip(),
                'phone': client.phone or '',
                'role': client.role
            })
        
        return JsonResponse({'clients': client_list})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


def register_view(request):
    """Страница регистрации нового пользователя"""
    if request.user.is_authenticated:
        return redirect('profile')
    
    if request.method == 'POST':
        form = RegistrationForm(request.POST)
        if form.is_valid():
            with transaction.atomic():
                user = form.save(commit=False)
                # Используем номер телефона как username (логин)
                user.username = form.cleaned_data.get('phone')
                user.first_name = form.cleaned_data.get('first_name')
                user.last_name = form.cleaned_data.get('last_name')
                user.save()
                
                # Сохраняем телефон в профиль клиента
                if hasattr(user, 'client_profile'):
                    user.client_profile.phone = user.username
                    user.client_profile.save()
                
                login(request, user)
                return redirect('profile')
    else:
        form = RegistrationForm()
    
    return render(request, 'core/register.html', {'form': form})


def login_view(request):
    """Страница входа для существующих пользователей"""
    if request.user.is_authenticated:
        return redirect('profile')
    
    if request.method == 'POST':
        form = LoginForm(request, data=request.POST)
        if form.is_valid():
            # Номер телефона уже очищен в форме через clean_username
            cleaned_phone = form.cleaned_data.get('username')
            password = form.cleaned_data.get('password')
            
            user = authenticate(request, username=cleaned_phone, password=password)
            if user is not None:
                login(request, user)
                next_url = request.GET.get('next', 'profile')
                return redirect(next_url)
    else:
        form = LoginForm()
    
    return render(request, 'core/login.html', {'form': form})


@login_required
def logout_view(request):
    """Выход из системы"""
    logout(request)
    return redirect('login')


@login_required
def profile_view(request):
    """Личный кабинет пользователя"""
    client = request.user
    
    # Определяем время суток для приветствия
    current_hour = timezone.now().hour
    if 5 <= current_hour < 12:
        greeting = "Доброе утро"
    elif 12 <= current_hour < 18:
        greeting = "Добрый день"
    else:
        greeting = "Добрый вечер"
    
    # Получаем будущие занятия, на которые записан клиент
    upcoming_sessions = ClassSession.objects.filter(
        attendance__client=client,
        date_time__gte=timezone.now(),
        attendance__status='attended'
    ).select_related('class_type', 'hall').order_by('date_time')[:10]
    
    # Получаем историю посещений
    past_sessions = ClassSession.objects.filter(
        attendance__client=client,
        date_time__lt=timezone.now(),
        attendance__status='attended'
    ).select_related('class_type', 'hall').order_by('-date_time')[:20]
    
    context = {
        'client': client,
        'greeting': greeting,
        'upcoming_sessions': upcoming_sessions,
        'past_sessions': past_sessions,
        'is_moderator': client.is_moderator,
        'is_admin': client.is_admin,
        'is_staff': client.is_staff,
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


@require_http_methods(["POST"])
def vk_auth(request):
    """
    Обработчик авторизации через ВКонтакте
    
    Получает данные от VK ID Widget, проверяет подпись,
    находит или создаёт пользователя, выполняет вход.
    """
    if not hasattr(settings, 'VK_CLIENT_SECRET') or not settings.VK_CLIENT_SECRET:
        return JsonResponse({
            'success': False,
            'error': 'VK авторизация не настроена. Обратитесь к администратору.'
        }, status=500)
    
    # Получаем данные из POST запроса
    vk_data = {}
    for key in ['id', 'first_name', 'last_name', 'photo_url', 'auth_date', 'hash']:
        if key in request.POST:
            vk_data[key] = request.POST[key]
    
    # Проверяем данные через модуль VK аутентификации
    validated_data = validate_vk_auth_data(vk_data, settings.VK_CLIENT_SECRET)
    
    if not validated_data:
        return JsonResponse({
            'success': False,
            'error': 'Неверные данные авторизации. Попробуйте ещё раз.'
        }, status=400)
    
    vk_id = validated_data['vk_id']
    
    try:
        with transaction.atomic():
            # Ищем пользователя по vk_id
            user = User.objects.filter(vk_id=vk_id).first()
            
            if user:
                # Пользователь найден - просто выполняем вход
                created = False
            else:
                # Пользователь не найден - создаём нового
                # Генерируем уникальный username на основе vk_id
                username = f"vk_{vk_id}"
                
                user = User.objects.create_user(
                    username=username,
                    first_name=validated_data['first_name'],
                    last_name=validated_data['last_name'],
                    vk_id=vk_id,
                )
                
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
                    'vk_id': user.vk_id,
                }
            })
            
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': f'Ошибка при авторизации: {str(e)}'
        }, status=500)


