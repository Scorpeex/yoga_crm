"""
URL configuration for yoga_crm project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path
from core.admin import admin_site
from core import views

urlpatterns = [
    path('admin/', admin_site.urls),
    path('calendar/', views.calendar_view, name='calendar'),
    path('api/calendar/events/', views.get_events, name='get_events'),
    path('api/calendar/events/create/', views.create_event, name='create_event'),
    path('api/calendar/events/<int:event_id>/', views.update_event, name='update_event'),
    path('api/calendar/events/<int:event_id>/delete/', views.delete_event, name='delete_event'),
    path('api/calendar/events/<int:session_id>/attendance/', views.get_attendance, name='get_attendance'),
    path('api/calendar/events/<int:session_id>/attendance/update/', views.update_attendance, name='update_attendance'),
    path('api/calendar/events/<int:session_id>/attendance/add/', views.add_client_to_session, name='add_client_to_session'),
    path('api/clients/search/', views.search_clients, name='search_clients'),
    
    # Аутентификация и личный кабинет
    path('register/', views.register_view, name='register'),
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),
    path('profile/', views.profile_view, name='profile'),
]
