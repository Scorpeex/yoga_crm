from django.shortcuts import render, get_object_or_404, redirect
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
import json
from datetime import datetime, timedelta
from .models import ClassSession, Hall, ClassType
from django.utils import timezone


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
        events.append({
            'id': str(session.id),
            'title': f"{session.class_type.name}",
            'start': session.date_time.strftime('%Y-%m-%dT%H:%M:%S'),
            'end': (session.date_time + timedelta(minutes=session.duration)).strftime('%Y-%m-%dT%H:%M:%S'),
            'allDay': False,
            'extendedProps': {
                'hall_id': session.hall.id if session.hall else None,
                'hall_name': session.hall.name if session.hall else '',
                'duration': session.duration,
                'max_participants': session.max_participants,
                'description': session.class_type.description if session.class_type.description else ''
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
        session.delete()
        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)

