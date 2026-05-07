from django.contrib import admin
from django.utils.html import format_html
from django.urls import reverse
from .models import ClassType, Client, Hall, ClassSession, Attendance, Payment, RentPayment


@admin.register(ClassType)
class ClassTypeAdmin(admin.ModelAdmin):
    list_display = ['name', 'duration_minutes', 'description']
    search_fields = ['name']
    ordering = ['name']


@admin.register(Client)
class ClientAdmin(admin.ModelAdmin):
    list_display = ['last_name', 'first_name', 'phone', 'email', 'is_active', 'created_at']
    list_filter = ['is_active', 'created_at']
    search_fields = ['first_name', 'last_name', 'phone', 'email']
    ordering = ['last_name', 'first_name']


@admin.register(Hall)
class HallAdmin(admin.ModelAdmin):
    list_display = ['name', 'address', 'price_per_hour', 'color_preview']
    search_fields = ['name', 'address']
    
    def color_preview(self, obj):
        if obj.color:
            return format_html(
                '<div style="width: 30px; height: 20px; background-color: {}; border: 1px solid #ccc; display: inline-block;"></div> {}',
                obj.color,
                obj.color
            )
        return '-'
    color_preview.short_description = 'Цвет'


@admin.register(ClassSession)
class ClassSessionAdmin(admin.ModelAdmin):
    list_display = ['class_type', 'date_time', 'duration', 'hall', 'max_participants']
    list_filter = ['date_time', 'hall', 'class_type']
    search_fields = ['class_type__name']
    ordering = ['-date_time']
    date_hierarchy = 'date_time'


@admin.register(Attendance)
class AttendanceAdmin(admin.ModelAdmin):
    list_display = ['client', 'session', 'status', 'visited_at']
    list_filter = ['status', 'session__date_time']
    search_fields = ['client__first_name', 'client__last_name', 'session__class_type__name']
    ordering = ['-visited_at']


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ['client', 'amount', 'payment_type', 'status', 'paid_at', 'sessions_count']
    list_filter = ['payment_type', 'status', 'paid_at']
    search_fields = ['client__first_name', 'client__last_name']
    ordering = ['-paid_at']


@admin.register(RentPayment)
class RentPaymentAdmin(admin.ModelAdmin):
    list_display = ['hall', 'rent_date', 'hours_rented', 'amount', 'status', 'paid_at']
    list_filter = ['status', 'rent_date', 'hall']
    search_fields = ['hall__name']
    ordering = ['-rent_date']


class YogaCRMAdminSite(admin.AdminSite):
    site_header = 'Yoga CRM - Администрирование'
    site_title = 'Yoga CRM'
    index_title = 'Панель управления'
    
    def index(self, request, extra_context=None):
        extra_context = extra_context or {}
        extra_context['calendar_url'] = reverse('calendar')
        return super().index(request, extra_context)


# Создаем пользовательский сайт админа
admin_site = YogaCRMAdminSite(name='yoga_admin')

# Регистрируем все модели в новом сайте
admin_site.register(ClassType, ClassTypeAdmin)
admin_site.register(Client, ClientAdmin)
admin_site.register(Hall, HallAdmin)
admin_site.register(ClassSession, ClassSessionAdmin)
admin_site.register(Attendance, AttendanceAdmin)
admin_site.register(Payment, PaymentAdmin)
admin_site.register(RentPayment, RentPaymentAdmin)
