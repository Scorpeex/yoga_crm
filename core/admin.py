from django.contrib import admin
from django.utils.html import format_html
from django.urls import reverse
from django.contrib.auth.models import Group
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import Tariff, ClassType, User, Hall, ClassSession, Booking, PaymentTransaction, Attendance, Payment, RentPayment, Subscription


class TariffAdmin(admin.ModelAdmin):
    list_display = ['name', 'tariff_type', 'price_per_person', 'price_full_split', 'max_participants', 'is_active', 'is_subscription_available']
    list_filter = ['tariff_type', 'is_active', 'is_subscription_available']
    search_fields = ['name']
    ordering = ['name']
    fieldsets = (
        ('Основное', {
            'fields': ('name', 'tariff_type', 'description', 'is_active')
        }),
        ('Ценообразование', {
            'fields': ('price_per_person', 'price_full_split', 'max_participants'),
            'description': 'Для тарифа "Сплит": price_full_split устанавливается автоматически (price_per_person * 2), если не задан явно.'
        }),
        ('Абонемент', {
            'fields': ('is_subscription_available', 'subscription_sessions_count', 'subscription_price', 'subscription_validity_days'),
            'description': 'Настройки абонемента: если отмечено "Доступен абонемент", можно приобрести абонемент на указанное количество занятий. Стоимость рассчитывается автоматически, если не задана явно.'
        }),
    )


class ClassTypeAdmin(admin.ModelAdmin):
    list_display = ['name', 'duration_minutes', 'default_tariff', 'description']
    search_fields = ['name']
    ordering = ['name']


# Кастомный админ для модели User с добавлением полей клиента
class UserAdmin(BaseUserAdmin):
    list_display = ['username', 'email', 'first_name', 'last_name', 'phone', 'role', 'is_active', 'balance', 'is_staff']
    list_filter = ['is_staff', 'is_superuser', 'is_active', 'role']
    search_fields = ['username', 'first_name', 'last_name', 'email', 'phone']
    ordering = ['last_name', 'first_name']
    filter_horizontal = ['allowed_tariffs']
    
    fieldsets = (
        (None, {'fields': ('username', 'password')}),
        ('Персональная информация', {'fields': ('first_name', 'last_name', 'email', 'phone', 'role')}),
        ('Финансы', {'fields': ('balance',)}),
        ('Доступные тарифы', {'fields': ('allowed_tariffs',)}),
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
    list_display = ['class_type', 'tariff', 'date_time', 'duration', 'hall', 'get_current_price_display']
    list_filter = ['date_time', 'hall', 'class_type', 'tariff']
    search_fields = ['class_type__name', 'tariff__name']
    ordering = ['-date_time']
    date_hierarchy = 'date_time'
    
    def get_current_price_display(self, obj):
        return f"{obj.get_current_price()} руб."
    get_current_price_display.short_description = 'Текущая цена'


class BookingAdmin(admin.ModelAdmin):
    list_display = ['client', 'session', 'status', 'amount_paid', 'is_subscription_used', 'booked_at', 'payment_deadline', 'paid_at']
    list_filter = ['status', 'is_subscription_used', 'session__date_time', 'session__tariff']
    search_fields = ['client__first_name', 'client__last_name', 'session__class_type__name']
    ordering = ['-booked_at']
    readonly_fields = ['booked_at', 'payment_deadline']
    fieldsets = (
        ('Основное', {
            'fields': ('session', 'client', 'status')
        }),
        ('Финансы', {
            'fields': ('amount_paid', 'paid_at', 'is_subscription_used', 'subscription')
        }),
        ('Даты и информация', {
            'fields': ('booked_at', 'payment_deadline', 'comment'),
            'classes': ('collapse',)
        }),
    )


class PaymentTransactionAdmin(admin.ModelAdmin):
    list_display = ['client', 'transaction_type', 'amount', 'balance_before', 'balance_after', 'booking', 'subscription', 'created_at']
    list_filter = ['transaction_type', 'created_at']
    search_fields = ['client__first_name', 'client__last_name', 'comment']
    ordering = ['-created_at']
    readonly_fields = ['balance_before', 'balance_after', 'created_at']


class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ['client', 'tariff', 'sessions_remaining', 'sessions_total', 'status', 'purchased_at', 'activated_at', 'expires_at']
    list_filter = ['status', 'tariff', 'purchased_at']
    search_fields = ['client__first_name', 'client__last_name', 'tariff__name']
    ordering = ['-purchased_at']
    readonly_fields = ['purchased_at', 'activated_at', 'expires_at']
    fieldsets = (
        ('Основное', {
            'fields': ('client', 'tariff', 'status')
        }),
        ('Занятия', {
            'fields': ('sessions_total', 'sessions_remaining')
        }),
        ('Даты и стоимость', {
            'fields': ('purchased_at', 'activated_at', 'expires_at', 'total_price')
        }),
        ('Информация', {
            'fields': ('comment',),
            'classes': ('collapse',)
        }),
    )


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
admin.site.register(Tariff, TariffAdmin)
admin.site.register(ClassType, ClassTypeAdmin)
admin.site.register(User, UserAdmin)
admin.site.register(Hall, HallAdmin)
admin.site.register(ClassSession, ClassSessionAdmin)
admin.site.register(Booking, BookingAdmin)
admin.site.register(PaymentTransaction, PaymentTransactionAdmin)
admin.site.register(Subscription, SubscriptionAdmin)
admin.site.register(Attendance, AttendanceAdmin)
admin.site.register(Payment, PaymentAdmin)
admin.site.register(RentPayment, RentPaymentAdmin)
admin.site.register(Group)
