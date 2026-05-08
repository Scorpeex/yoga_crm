import json
from django.shortcuts import render, get_object_or_404, redirect
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
import json
from datetime import datetime, timedelta
from .models import ClassSession, Hall, ClassType
from django.utils import timezone
from django.utils.dateparse import parse_datetime
import pytz


def calendar_view(request):
    """Отображение календаря занятий"""
    halls = Hall.objects.all()
    class_types = ClassType.objects.all()
    return render(request, 'core/calendar.html', {'halls': halls, 'class_types': class_types})


def get_events(request):
    """Получение событий для календаря (JSON)"""
    year = request.GET.get('year', timezone.now().year)
    month = request.GET.get('month', timezone.now().month)
    
    try:
        year = int(year)
        month = int(month)
    except (ValueError, TypeError):
        year = timezone.now().year
        month = timezone.now().month
    
    # Первый и последний день месяца
    start_date = datetime(year, month, 1)
    if month == 12:
        end_date = datetime(year + 1, 1, 1) - timedelta(days=1)
    else:
        end_date = datetime(year, month + 1, 1) - timedelta(days=1)
    
    sessions = ClassSession.objects.filter(
        date_time__gte=start_date,
        date_time__lte=end_date.replace(hour=23, minute=59, second=59)
    ).select_related('hall', 'class_type')
    
    events = []
    
    for session in sessions:
        # Время хранится как локальное (без timezone info), используем его напрямую
        local_dt = session.date_time
        
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
                'max_participants': session.max_participants,
                'description': session.class_type.description if session.class_type.description else '',
                'is_recurring': session.is_recurring,
                'recurrence_id': session.recurrence_id or ''
            }
        })
    
    return JsonResponse(events, safe=False)


@require_http_methods(["POST"])
def create_event(request):
    """Создание нового занятия"""
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
        
        # Парсим дату без конвертации в UTC (локальное время)
        date_time = datetime.fromisoformat(start.replace('Z', ''))
        
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
    """Обновление существующего занятия"""
    try:
        session = get_object_or_404(ClassSession, id=event_id)
        
        if request.method == "POST":
            data = json.loads(request.body)
        else:
            data = json.loads(request.body)
        
        if 'class_type_id' in data and data['class_type_id']:
            session.class_type = get_object_or_404(ClassType, id=data['class_type_id'])
        if 'start' in data:
            session.date_time = datetime.fromisoformat(data['start'].replace('Z', ''))
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
    """Удаление занятия"""
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

