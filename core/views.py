from django.shortcuts import render, get_object_or_404, redirect
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
import json
from datetime import datetime, timedelta
from .models import ClassSession, Hall
from django.utils import timezone


def calendar_view(request):
    """Отображение календаря занятий"""
    halls = Hall.objects.all()
    return render(request, 'core/calendar.html', {'halls': halls})


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
    ).select_related('hall')
    
    events = []
    for session in sessions:
        events.append({
            'id': session.id,
            'title': f"{session.title} ({session.instructor})",
            'start': session.date_time.isoformat(),
            'end': (session.date_time + timedelta(minutes=session.duration)).isoformat(),
            'hall': session.hall.name if session.hall else '',
            'editable': True,
        })
    
    return JsonResponse({'events': events})


@require_http_methods(["POST"])
def create_event(request):
    """Создание нового занятия"""
    try:
        data = json.loads(request.body)
        title = data.get('title', 'Новое занятие')
        start = data.get('start')
        hall_id = data.get('hall_id')
        duration = data.get('duration', 60)
        instructor = data.get('instructor', '')
        max_participants = data.get('max_participants', 20)
        
        if not start:
            return JsonResponse({'error': 'Дата начала обязательна'}, status=400)
        
        date_time = datetime.fromisoformat(start.replace('Z', '+00:00'))
        
        hall = None
        if hall_id:
            hall = get_object_or_404(Hall, id=hall_id)
        
        session = ClassSession.objects.create(
            title=title,
            date_time=date_time,
            duration=duration,
            hall=hall,
            instructor=instructor,
            max_participants=max_participants,
        )
        
        return JsonResponse({
            'success': True,
            'event': {
                'id': session.id,
                'title': session.title,
                'start': session.date_time.isoformat(),
                'end': (session.date_time + timedelta(minutes=session.duration)).isoformat(),
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
        
        if 'title' in data:
            session.title = data['title']
        if 'start' in data:
            session.date_time = datetime.fromisoformat(data['start'].replace('Z', '+00:00'))
        if 'duration' in data:
            session.duration = data['duration']
        if 'hall_id' in data:
            if data['hall_id']:
                session.hall = get_object_or_404(Hall, id=data['hall_id'])
            else:
                session.hall = None
        if 'instructor' in data:
            session.instructor = data['instructor']
        if 'max_participants' in data:
            session.max_participants = data['max_participants']
        
        session.save()
        
        return JsonResponse({
            'success': True,
            'event': {
                'id': session.id,
                'title': session.title,
                'start': session.date_time.isoformat(),
                'end': (session.date_time + timedelta(minutes=session.duration)).isoformat(),
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

