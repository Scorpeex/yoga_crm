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
from django.urls import path, re_path
from django.conf import settings
from django.conf.urls.static import static
from django.views.static import serve
from core import views

urlpatterns = [
    path('', views.index, name='landing'),
    path('dashboard/', views.home_view, name='home'),
    path('admin/', admin.site.urls),
    path('calendar/', views.calendar_view, name='calendar'),
    path('api/calendar/events/', views.get_events, name='get_events'),
    path('api/calendar/events/create/', views.create_event, name='create_event'),
    path('api/calendar/events/<int:event_id>/', views.update_event, name='update_event'),
    path('api/calendar/events/<int:event_id>/delete/', views.delete_event, name='delete_event'),
    path('api/calendar/events/<int:session_id>/attendance/', views.get_attendance, name='get_attendance'),
    path('api/calendar/events/<int:session_id>/attendance/update/', views.update_attendance, name='update_attendance'),
    path('api/calendar/events/<int:session_id>/attendance/add/', views.add_client_to_session, name='add_client_to_session'),
    path('api/calendar/events/<int:session_id>/attendance/remove/', views.remove_client_from_session, name='remove_client_from_session'),
    path('api/calendar/events/<int:session_id>/enroll/', views.enroll_to_class, name='enroll_to_class'),
    path('api/calendar/events/<int:session_id>/cancel-enrollment/', views.cancel_enrollment, name='cancel_enrollment'),
    path('api/clients/search/', views.search_clients, name='search_clients'),
    path('shop/', views.shop_view, name='shop'),
    path('about/', views.about_view, name='about'),
    path('api/balance/top-up/', views.top_up_balance_view, name='top_up_balance'),
    path('api/purchase-subscription/', views.purchase_subscription_view, name='purchase_subscription'),
    path('api/renew-subscription/', views.renew_subscription_view, name='renew_subscription'),
    path('api/tariff/request-access/', views.request_tariff_access_view, name='request_tariff_access'),
    
    # Аутентификация и личный кабинет
    path('register/', views.register_view, name='register'),
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),
    path('profile/', views.profile_detail_view, name='profile_detail'),
    
    # Новости
    path('news/', views.news_list, name='news_list'),
    path('news/create/', views.news_create, name='news_create'),
    path('news/<int:pk>/edit/', views.news_edit, name='news_edit'),
    path('news/<int:pk>/delete/', views.news_delete, name='news_delete'),
    
    # Telegram авторизация
    path('api/auth/telegram/', views.telegram_auth, name='telegram_auth'),
    # VK авторизация
    path('api/auth/vk/', views.vk_auth, name='vk_auth'),
    path('api/auth/vk/create/', views.vk_create_user, name='vk_create_user'),
    path('api/auth/vk/link/', views.vk_link_existing, name='vk_link_existing'),
    path('api/auth/vk/toggle/', views.vk_toggle_link, name='vk_toggle_link'),
    path('api/auth/vk/test/', views.vk_auth_test, name='vk_auth_test'),
    path('api/auth/test/user-info/', views.test_user_info, name='test_user_info'),
    path('api/auth/test/delete-user/', views.test_delete_user, name='test_delete_user'),
    path('api/auth/test/my-info/', views.test_my_info, name='test_my_info'),
    path('api/auth/test/set-allowed-tariffs/', views.test_set_allowed_tariffs, name='test_set_allowed_tariffs'),
    path('api/auth/test/delete-subscriptions/', views.test_delete_subscriptions, name='test_delete_subscriptions'),
    path('api/auth/test/set-balance/', views.test_set_balance, name='test_set_balance'),
    path('api/auth/test/create-notifications/', views.test_create_notifications, name='test_create_notifications'),
    path('api/auth/test/delete-notifications/', views.test_delete_notifications, name='test_delete_notifications'),
    path('api/auth/test/authenticate/', views.test_authenticate, name='test_authenticate'),
    path('api/auth/test/move-session-to-past/', views.test_move_session_to_past, name='test_move_session_to_past'),
    path('api/auth/test/expire-subscription/', views.test_expire_subscription, name='test_expire_subscription'),
    path('api/auth/test/set-attendance/', views.test_set_attendance, name='test_set_attendance'),
    path('api/auth/test/set-hall-colors/', views.test_set_hall_colors, name='test_set_hall_colors'),
    path('api/auth/test/tariffs/', views.test_tariffs, name='test_tariffs'),
    # VK Callback API (для бота сообщества)
    path('api/vk/callback/', views.vk_callback, name='vk_callback'),
    # VK тестовое сообщение
    path('api/vk/test-message/', views.vk_test_message, name='vk_test_message'),
    # Внутриприложные уведомления
    path('api/notifications/', views.get_notifications, name='get_notifications'),
    path('api/notifications/unread-count/', views.unread_notification_count, name='unread_notification_count'),
    path('api/notifications/<int:pk>/read/', views.mark_notification_read, name='mark_notification_read'),
    path('api/notifications/read-all/', views.mark_all_notifications_read, name='mark_all_notifications_read'),
    # ЮKassa (онлайн-оплата)
    path('api/yookassa/callback/', views.yookassa_callback, name='yookassa_callback'),
]

urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)

if not settings.DEBUG:
    urlpatterns += [
        re_path(r'^static/(?P<path>.*)$', serve, {'document_root': settings.STATIC_ROOT}),
        re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
    ]
