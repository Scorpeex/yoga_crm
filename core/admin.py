from django.contrib import admin
from django.utils.html import format_html
from django.urls import reverse
from django.contrib.auth.models import User, Group
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import ClassType, Client, Hall, ClassSession, Attendance, Payment, RentPayment


class ClassTypeAdmin(admin.ModelAdmin):
    list_display = ['name', 'duration_minutes', 'description']
    search_fields = ['name']
    ordering = ['name']


# Кастомный админ для модели User с добавлением поля role из Client
class ClientInline(admin.StackedInline):
    model = Client
    can_delete = False
    verbose_name_plural = 'Профиль клиента'
    fields = ('phone', 'role', 'is_active')
    readonly_fields = ('created_at',)
    
    def has_add_permission(self, request, obj=None):
        return False


class UserAdmin(BaseUserAdmin):
    inlines = (ClientInline,)
    list_display = ['username', 'email', 'first_name', 'last_name', 'get_role', 'is_staff', 'is_superuser', 'is_active']
    list_filter = ['is_staff', 'is_superuser', 'is_active', 'client_profile__role']
    search_fields = ['username', 'first_name', 'last_name', 'email']
    ordering = ['username']
    
    def get_role(self, obj):
        if hasattr(obj, 'client_profile'):
            return obj.client_profile.get_role_display()
        return '-'
    get_role.short_description = 'Роль'
    
    def has_change_permission(self, request, obj=None):
        # Разрешить редактирование только админам
        if request.user.is_superuser:
            return True
        if hasattr(request.user, 'client_profile'):
            return request.user.client_profile.is_admin
        return False


class ClientAdmin(admin.ModelAdmin):
    list_display = ['get_last_name', 'get_first_name', 'phone', 'role', 'is_active', 'created_at']
    list_filter = ['role', 'is_active', 'created_at']
    search_fields = ['user__first_name', 'user__last_name', 'user__email', 'phone']
    ordering = ['user__last_name', 'user__first_name']
    list_editable = ['role']
    
    def get_last_name(self, obj):
        return obj.user.last_name if obj.user else '-'
    get_last_name.short_description = 'Фамилия'
    
    def get_first_name(self, obj):
        return obj.user.first_name if obj.user else '-'
    get_first_name.short_description = 'Имя'


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


# Снимаем стандартную регистрацию User и Group
admin.site.unregister(User)
admin.site.unregister(Group)

# Регистрируем все модели в стандартном сайте админа
admin.site.register(ClassType, ClassTypeAdmin)
admin.site.register(Client, ClientAdmin)
admin.site.register(Hall, HallAdmin)
admin.site.register(ClassSession, ClassSessionAdmin)
admin.site.register(Attendance, AttendanceAdmin)
admin.site.register(Payment, PaymentAdmin)
admin.site.register(RentPayment, RentPaymentAdmin)
admin.site.register(User, UserAdmin)
admin.site.register(Group)
