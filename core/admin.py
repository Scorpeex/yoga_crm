from django.contrib import admin
from django.utils.html import format_html
from django.urls import reverse
from django.contrib.auth.models import Group
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import ClassType, User, Hall, ClassSession, Attendance, Payment, RentPayment


class ClassTypeAdmin(admin.ModelAdmin):
    list_display = ['name', 'duration_minutes', 'description']
    search_fields = ['name']
    ordering = ['name']


# Кастомный админ для модели User с добавлением полей клиента
class UserAdmin(BaseUserAdmin):
    list_display = ['username', 'email', 'first_name', 'last_name', 'phone', 'role', 'is_active', 'balance', 'subscription_remaining', 'is_staff']
    list_filter = ['is_staff', 'is_superuser', 'is_active', 'role']
    search_fields = ['username', 'first_name', 'last_name', 'email', 'phone']
    ordering = ['last_name', 'first_name']
    
    fieldsets = (
        (None, {'fields': ('username', 'password')}),
        ('Персональная информация', {'fields': ('first_name', 'last_name', 'email', 'phone', 'role')}),
        ('Финансы', {'fields': ('balance', 'subscription_remaining')}),
        ('Права доступа', {'fields': ('is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions')}),
        ('Даты', {'fields': ('created_at', 'last_login')}),
    )
    
    readonly_fields = ('created_at', 'last_login')
    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('username', 'password1', 'password2', 'email', 'first_name', 'last_name', 'phone', 'role'),
        }),
    )


class HallAdmin(admin.ModelAdmin):
    list_display = ['name', 'address', 'price_per_hour', 'color_sample']
    search_fields = ['name', 'address']
    
    def color_sample(self, obj):
        if obj.color:
            return format_html(
                '<span style="display: inline-block; width: 20px; height: 20px; background-color: {}; border: 1px solid #ccc; border-radius: 3px;"></span> {}',
                obj.color,
                obj.get_color_display()
            )
        return '-'
    color_sample.short_description = 'Цвет'


class ClassSessionAdmin(admin.ModelAdmin):
    list_display = ['class_type', 'date_time', 'duration', 'hall', 'max_participants']
    list_filter = ['date_time', 'hall', 'class_type']
    search_fields = ['class_type__name']
    ordering = ['-date_time']
    date_hierarchy = 'date_time'


class AttendanceAdmin(admin.ModelAdmin):
    list_display = ['client', 'session', 'status', 'visited_at']
    list_filter = ['status', 'session__date_time']
    search_fields = ['client__first_name', 'client__last_name', 'session__class_type__name']
    ordering = ['-visited_at']


class PaymentAdmin(admin.ModelAdmin):
    list_display = ['client', 'amount', 'payment_type', 'status', 'paid_at', 'sessions_count']
    list_filter = ['payment_type', 'status', 'paid_at']
    search_fields = ['client__first_name', 'client__last_name']
    ordering = ['-paid_at']


class RentPaymentAdmin(admin.ModelAdmin):
    list_display = ['hall', 'rent_date', 'hours_rented', 'amount', 'status', 'paid_at']
    list_filter = ['status', 'rent_date', 'hall']
    search_fields = ['hall__name']
    ordering = ['-rent_date']


# Снимаем стандартную регистрацию Group
admin.site.unregister(Group)

# Регистрируем все модели в стандартном сайте админа
admin.site.register(ClassType, ClassTypeAdmin)
admin.site.register(User, UserAdmin)
admin.site.register(Hall, HallAdmin)
admin.site.register(ClassSession, ClassSessionAdmin)
admin.site.register(Attendance, AttendanceAdmin)
admin.site.register(Payment, PaymentAdmin)
admin.site.register(RentPayment, RentPaymentAdmin)
admin.site.register(Group)
